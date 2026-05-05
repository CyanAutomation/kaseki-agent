import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { Job, RunRequest, WebhookEventType, WebhookPayload } from './kaseki-api-types';
import { KasekiApiConfig } from './kaseki-api-config';
import { createEventLogger, EventLogger } from './logger';
import { WebhookManager } from './webhook-manager';

type PersistedJob = Omit<Job, 'createdAt' | 'startedAt' | 'completedAt' | 'timeout'> & {
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

type CleanupResult = {
  attempted: boolean;
  ok?: boolean;
  detail?: string;
};

/**
 * Job scheduler manages a FIFO queue of kaseki runs with concurrency control.
 */
export class JobScheduler {
  private static readonly STREAM_TAIL_LIMIT_BYTES = 64 * 1024;
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = new Set<string>();
  private processes = new Map<string, ChildProcess>();
  private processExited = new Map<string, boolean>();
  private shutdownKillTimers = new Map<string, NodeJS.Timeout>();
  private timeoutKillTimers = new Map<string, NodeJS.Timeout>();
  private config: KasekiApiConfig;
  private indexPath: string;
  private nextIdPath: string;
  private idLockPath: string;
  private indexLockPath: string;
  private logger: EventLogger;
  private webhookManager: WebhookManager;
  private static readonly SHUTDOWN_GRACE_MS = 5000;

  constructor(config: KasekiApiConfig, webhookManager: WebhookManager) {
    this.config = config;
    this.indexPath = path.join(config.resultsDir, '.kaseki-api-jobs.json');
    this.nextIdPath = path.join(config.resultsDir, '.kaseki-api-next-id');
    this.idLockPath = path.join(config.resultsDir, '.kaseki-api-id.lock');
    this.indexLockPath = path.join(config.resultsDir, '.kaseki-api-jobs.lock');
    this.logger = createEventLogger('job-scheduler');
    this.webhookManager = webhookManager;
    this.loadPersistedJobs();
    this.persistJobs();
    this.processQueue();
  }

  /**
   * Submit a new job to the queue.
   */
  async submitJob(request: RunRequest): Promise<Job> {
    const instanceId = await this.generateInstanceId();

    // Generate tracing IDs if not provided
    const correlationId = request.tracing?.correlationId || randomUUID();
    const requestId = request.tracing?.requestId || randomUUID();

    const job: Job = {
      id: instanceId,
      status: 'queued',
      request,
      createdAt: new Date(),
      resultDir: this.getResultDir(instanceId),
      webhookConfig: request.webhookConfig,
      correlationId,
      requestId,
    };

    this.jobs.set(instanceId, job);
    this.queue.push(job);
    this.persistJobs();

    // Emit webhook event for job submission
    if (job.webhookConfig) {
      const payload: WebhookPayload = {
        eventType: WebhookEventType.JOB_SUBMITTED,
        jobId: instanceId,
        timestamp: new Date().toISOString(),
        data: {
          status: 'queued',
        },
      };
      this.webhookManager.enqueueWebhook(instanceId, payload, job.webhookConfig);
    }

    this.processQueue();

    // Log job submission
    this.logger.event('job_submitted', {
      jobId: instanceId,
      correlationId,
      requestId,
      repoUrl: request.repoUrl,
      ref: request.ref,
      queueDepth: this.queue.length,
      runningCount: this.running.size,
    });

    return job;
  }

  /**
   * Get a job by ID.
   */
  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * List all jobs.
   */
  listJobs(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Cancel a queued or running job.
   */
  cancelJob(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job || job.status === 'completed' || job.status === 'failed') {
      return job;
    }

    const completedAt = new Date();
    if (job.status === 'queued') {
      this.queue = this.queue.filter((queued) => queued.id !== id);
      job.status = 'failed';
      job.exitCode = 143;
      job.failureClass = 'cancelled';
      job.error = 'Job cancelled before execution';
      job.completedAt = completedAt;
      job.finalized = true;
      this.writeApiFailureArtifacts(job, {
        attempted: false,
        detail: 'Job never started; no worker container was created.',
      });
      this.persistJobs();

      // Emit webhook event for cancellation
      if (job.webhookConfig) {
        const payload: WebhookPayload = {
          eventType: WebhookEventType.JOB_CANCELLED,
          jobId: id,
          timestamp: new Date().toISOString(),
          data: {
            status: 'failed',
            failureClass: 'cancelled',
            error: job.error,
          },
        };
        this.webhookManager.enqueueWebhook(id, payload, job.webhookConfig);
      }

      this.logger.event('job_cancelled', {
        jobId: id,
        reason: 'cancelled_before_execution',
      });

      return job;
    }

    const proc = this.processes.get(id);
    if (proc) {
      proc.kill('SIGTERM');
    }
    const cleanup = this.cleanupContainer(id);
    const updates: Partial<Job> = {
      status: 'failed',
      exitCode: 143,
      failureClass: 'cancelled',
      error: 'Job cancelled by API request',
      completedAt,
    };
    this.finalizeJobIfNeeded(job, updates);
    this.writeApiFailureArtifacts(job, cleanup);

    this.logger.event('job_cancelled', {
      jobId: id,
      reason: 'cancelled_by_request',
      processId: job.processId,
    });

    return job;
  }

  /**
   * Process the queue, respecting max concurrent limit.
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.running.size < this.config.maxConcurrentRuns) {
      const job = this.queue.shift();
      if (job) {
        this.executeJob(job);
      }
    }
  }

  /**
   * Execute a single job.
   */
  private executeJob(job: Job): void {
    job.status = 'running';
    job.startedAt = new Date();
    job.resultDir = this.getResultDir(job.id);
    this.running.add(job.id);

    // Emit webhook event for job start
    if (job.webhookConfig) {
      const payload: WebhookPayload = {
        eventType: WebhookEventType.JOB_STARTED,
        jobId: job.id,
        timestamp: new Date().toISOString(),
        data: {
          status: 'running',
        },
      };
      this.webhookManager.enqueueWebhook(job.id, payload, job.webhookConfig);
    }

    // Log job start
    this.logger.event('job_started', {
      jobId: job.id,
      repoUrl: job.request.repoUrl,
      ref: job.request.ref,
      processId: job.processId,
      runningCount: this.running.size,
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // run-kaseki.sh owns creation of the per-instance result directory and
      // refuses to overwrite it. Keep host log mirroring at the parent results
      // directory so the API does not accidentally reserve the final result path.
      KASEKI_LOG_DIR: this.config.resultsDir,
      KASEKI_TASK_MODE: job.request.taskMode || this.config.defaultTaskMode,
      KASEKI_MAX_DIFF_BYTES: String(job.request.maxDiffBytes || this.config.maxDiffBytes),
      KASEKI_AGENT_TIMEOUT_SECONDS: String(this.config.agentTimeoutSeconds),
    };

    if (job.request.startupCheck) {
      env.KASEKI_DRY_RUN = '1';
      env.KASEKI_TASK_MODE = 'inspect';
      env.KASEKI_VALIDATION_COMMANDS = 'none';
      env.TASK_PROMPT =
        job.request.taskPrompt ||
        'Run Kaseki startup checks only. Verify container boot and dependencies, then exit without agent work.';
    }

    if (job.request.changedFilesAllowlist) {
      env.KASEKI_CHANGED_FILES_ALLOWLIST = job.request.changedFilesAllowlist.join(' ');
    }

    if (job.request.validationCommands) {
      env.KASEKI_VALIDATION_COMMANDS = job.request.validationCommands.join(';');
    }

    if (job.request.taskPrompt) {
      env.TASK_PROMPT = job.request.taskPrompt;
    }

    // Determine kaseki-activate.sh path
    let activateScript = '/agents/kaseki-template/scripts/kaseki-activate.sh';
    if (!fs.existsSync(activateScript)) {
      // Fall back to development path
      activateScript = `${process.env.PWD || '/workspaces/kaseki-agent'}/scripts/kaseki-activate.sh`;
    }

    // Invoke kaseki-activate.sh with --controller flag
    const proc = spawn('bash', [activateScript, '--controller', 'run', job.request.repoUrl, job.request.ref, job.id], {
      env,
      stdio: 'pipe',
    });
    this.processes.set(job.id, proc);
    this.processExited.set(job.id, false);
    let stdoutTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    job.processId = proc.pid;
    let timedOut = false;
    this.persistJobs();

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutTail = this.appendBoundedTail(stdoutTail, incoming, JobScheduler.STREAM_TAIL_LIMIT_BYTES);
    });
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrTail = this.appendBoundedTail(stderrTail, incoming, JobScheduler.STREAM_TAIL_LIMIT_BYTES);
    });

    // Set timeout
    const timeout = setTimeout(() => {
      if (job.finalized) {
        return;
      }
      timedOut = true;
      proc.kill('SIGTERM');
      const timeoutKillTimer = setTimeout(() => {
        if (!this.processExited.get(job.id) && !job.finalized) {
          proc.kill('SIGKILL');
        }
        this.timeoutKillTimers.delete(job.id);
      }, JobScheduler.SHUTDOWN_GRACE_MS);
      this.timeoutKillTimers.set(job.id, timeoutKillTimer);
    }, this.config.agentTimeoutSeconds * 1000);

    job.timeout = timeout;

    // Handle process exit
    proc.on('exit', (code) => {
      this.processExited.set(job.id, true);
      if (job.finalized) {
        return;
      }
      clearTimeout(timeout);
      const timeoutKillTimer = this.timeoutKillTimers.get(job.id);
      if (timeoutKillTimer) {
        clearTimeout(timeoutKillTimer);
        this.timeoutKillTimers.delete(job.id);
      }
      const updates: Partial<Job> = {
        completedAt: new Date(),
        exitCode: code ?? -1,
      };
      if (timedOut) {
        updates.status = 'failed';
        updates.exitCode = 124;
        updates.failureClass = 'timeout';
        updates.error = `Agent timeout after ${this.config.agentTimeoutSeconds} seconds`;
        const cleanup = this.cleanupContainer(job.id);
        this.writeApiFailureArtifacts(job, cleanup);
        this.logger.event('job_failed', {
          jobId: job.id,
          failureClass: 'timeout',
          exitCode: 124,
          durationSeconds: Math.round((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000,
        });

      } else if (code === 0) {
        updates.status = 'completed';
        this.logger.event('job_completed', {
          jobId: job.id,
          exitCode: code,
          durationSeconds: Math.round((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000,
        });

      } else {
        updates.status = 'failed';
        this.parseFailureFromResults(job);
        this.writeControllerBootstrapLogs(job, stdoutTail, stderrTail);
        this.logger.event('job_failed', {
          jobId: job.id,
          exitCode: code,
          failureClass: job.failureClass,
          error: job.error,
          durationSeconds: Math.round((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000,
        });

      }
      this.finalizeJobIfNeeded(job, updates);
    });

    // Handle process error
    proc.on('error', (err) => {
      this.processExited.set(job.id, true);
      if (job.finalized) {
        return;
      }
      clearTimeout(timeout);
      const errorMsg = `Failed to spawn process: ${err.message}`;
      this.logger.event('job_failed', {
        jobId: job.id,
        failureClass: 'spawn_error',
        error: errorMsg,
      });
      this.finalizeJobIfNeeded(job, {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date(),
      });
    });
  }

  private finalizeJobIfNeeded(job: Job, updates: Partial<Job>): void {
    if (job.finalized) {
      return;
    }

    if (updates.status !== undefined) {
      job.status = updates.status;
    }
    if (updates.exitCode !== undefined) {
      job.exitCode = updates.exitCode;
    }
    if (updates.error !== undefined) {
      job.error = updates.error;
    }
    if (updates.failureClass !== undefined) {
      job.failureClass = updates.failureClass;
    }
    if (updates.completedAt !== undefined) {
      job.completedAt = updates.completedAt;
    }
    if (updates.resultDir !== undefined) {
      job.resultDir = updates.resultDir;
    }

    this.emitTerminalWebhook(job);
    this.completeJob(job);
  }

  private emitTerminalWebhook(job: Job): void {
    if (!job.webhookConfig) {
      return;
    }

    const elapsed =
      job.completedAt && job.startedAt ? Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000) : undefined;

    if (job.failureClass === 'cancelled') {
      const payload: WebhookPayload = {
        eventType: WebhookEventType.JOB_CANCELLED,
        jobId: job.id,
        timestamp: new Date().toISOString(),
        data: {
          status: 'failed',
          failureClass: 'cancelled',
          error: job.error,
        },
      };
      this.webhookManager.enqueueWebhook(job.id, payload, job.webhookConfig);
      return;
    }

    if (job.status === 'completed') {
      const payload: WebhookPayload = {
        eventType: WebhookEventType.JOB_COMPLETED,
        jobId: job.id,
        timestamp: new Date().toISOString(),
        data: {
          status: 'completed',
          exitCode: job.exitCode,
          elapsed,
        },
      };
      this.webhookManager.enqueueWebhook(job.id, payload, job.webhookConfig);
      return;
    }

    if (job.status === 'failed') {
      const payload: WebhookPayload = {
        eventType: WebhookEventType.JOB_FAILED,
        jobId: job.id,
        timestamp: new Date().toISOString(),
        data: {
          status: 'failed',
          exitCode: job.exitCode ?? undefined,
          failureClass: job.failureClass,
          error: job.error,
          elapsed,
        },
      };
      this.webhookManager.enqueueWebhook(job.id, payload, job.webhookConfig);
    }
  }

  private appendBoundedTail(
    currentTail: Buffer<ArrayBufferLike>,
    incoming: Buffer<ArrayBufferLike>,
    limitBytes: number
  ): Buffer<ArrayBufferLike> {
    if (incoming.length >= limitBytes) {
      return incoming.subarray(incoming.length - limitBytes);
    }
    const combined = currentTail.length > 0 ? Buffer.concat([currentTail, incoming]) : incoming;
    if (combined.length <= limitBytes) {
      return combined;
    }
    return combined.subarray(combined.length - limitBytes);
  }

  private writeControllerBootstrapLogs(
    job: Job,
    stdoutTail: Buffer<ArrayBufferLike>,
    stderrTail: Buffer<ArrayBufferLike>
  ): void {
    const resultDir = this.getResultDir(job.id);
    const stderrPath = path.join(resultDir, 'stderr.log');
    if (fs.existsSync(stderrPath)) {
      return;
    }

    try {
      fs.mkdirSync(resultDir, { recursive: true });
      const stderrContent = `controller bootstrap stderr (captured by api wrapper)\n${this.decodeUtf8Tail(stderrTail)}`;
      fs.writeFileSync(stderrPath, stderrContent, 'utf-8');

      const stdoutPath = path.join(resultDir, 'stdout.log');
      if (!fs.existsSync(stdoutPath)) {
        const stdoutContent = `controller bootstrap stdout (captured by api wrapper)\n${this.decodeUtf8Tail(stdoutTail)}`;
        fs.writeFileSync(stdoutPath, stdoutContent, 'utf-8');
      }
    } catch {
      // Best effort fallback: avoid masking original run failure.
    }
  }

  private decodeUtf8Tail(tail: Buffer<ArrayBufferLike>): string {
    const decoder = new StringDecoder('utf8');
    return decoder.end(tail);
  }

  /**
   * Parse failure class from results metadata.
   */
  private parseFailureFromResults(job: Job): void {
    try {
      const metadataPath = path.join(this.getResultDir(job.id), 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        if (metadata.failure) {
          job.failureClass = metadata.failure.failureClass;
          job.error = metadata.failure.message;
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  /**
   * Clean up after job completion.
   */
  private completeJob(job: Job): void {
    if (job.finalized) {
      return;
    }
    job.finalized = true;
    if (!job.completedAt) {
      job.completedAt = new Date();
    }
    this.running.delete(job.id);
    this.processes.delete(job.id);
    const shutdownKillTimer = this.shutdownKillTimers.get(job.id);
    if (shutdownKillTimer) {
      clearTimeout(shutdownKillTimer);
      this.shutdownKillTimers.delete(job.id);
    }
    const timeoutKillTimer = this.timeoutKillTimers.get(job.id);
    if (timeoutKillTimer) {
      clearTimeout(timeoutKillTimer);
      this.timeoutKillTimers.delete(job.id);
    }
    this.processExited.delete(job.id);
    this.persistJobs();
    this.processQueue();
  }

  /**
   * Generate a unique, durable instance ID.
   *
   * Format: `kaseki-N`, matching run-kaseki.sh and result directory names.
   */
  private async generateInstanceId(): Promise<string> {
    return this.withIdLock(async () => {
      let nextId = this.readNextId();
      const maxAttempts = 10000;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const id = `kaseki-${nextId}`;
        if (!this.jobs.has(id) && !fs.existsSync(this.getResultDir(id))) {
          fs.writeFileSync(this.nextIdPath, `${nextId + 1}\n`, { mode: 0o600 });
          return id;
        }
        nextId += 1;
      }

      throw new Error(`Failed to allocate unique job ID after ${maxAttempts} attempts`);
    });
  }

  private withIdLock<T>(callback: () => Promise<T>): Promise<T> {
    return this.withLock(this.idLockPath, 'Kaseki instance ID', callback);
  }

  private async withLock<T>(lockPath: string, lockName: string, callback: () => Promise<T>): Promise<T> {
    fs.mkdirSync(this.config.resultsDir, { recursive: true });
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        acquired = true;
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    if (!acquired) {
      throw new Error(`Failed to acquire ${lockName} lock: ${lockPath}`);
    }

    try {
      return await callback();
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }

  private withSyncLock<T>(lockPath: string, lockName: string, callback: () => T): T {
    fs.mkdirSync(this.config.resultsDir, { recursive: true });
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new Error(`Failed to acquire ${lockName} lock: ${lockPath}`);
      }
      throw err;
    }

    try {
      return callback();
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }

  private readNextId(): number {
    const persisted = this.readPositiveIntFile(this.nextIdPath);
    const discovered = this.discoverNextId();
    return Math.max(persisted ?? 1, discovered);
  }

  private readPositiveIntFile(filePath: string): number | undefined {
    try {
      const value = parseInt(fs.readFileSync(filePath, 'utf-8').trim(), 10);
      return Number.isInteger(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private discoverNextId(): number {
    let maxId = 0;
    for (const id of this.jobs.keys()) {
      maxId = Math.max(maxId, this.parseInstanceNumber(id) ?? 0);
    }
    try {
      for (const entry of fs.readdirSync(this.config.resultsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          maxId = Math.max(maxId, this.parseInstanceNumber(entry.name) ?? 0);
        }
      }
    } catch {
      // Missing/unreadable results dir is handled elsewhere; keep allocation best-effort.
    }
    return maxId + 1;
  }

  private writeApiFailureArtifacts(job: Job, cleanup: CleanupResult): void {
    if (job.status !== 'failed') {
      return;
    }

    const resultDir = this.getResultDir(job.id);
    const now = (job.completedAt || new Date()).toISOString();
    try {
      fs.mkdirSync(resultDir, { recursive: true });

      const failurePath = path.join(resultDir, 'failure.json');
      const shouldWriteFailure = !fs.existsSync(failurePath) || fs.statSync(failurePath).size === 0;
      if (shouldWriteFailure) {
        const payload = {
          failureClass: job.failureClass || 'api_finalized',
          error: job.error || 'Job failed before runner failure metadata was written',
          exitCode: job.exitCode,
          cancelledAt: job.failureClass === 'cancelled' ? now : undefined,
          completedAt: now,
          apiFinalized: true,
          cleanup,
        };
        fs.writeFileSync(failurePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
      }

      const summaryPath = path.join(resultDir, 'result-summary.md');
      const shouldWriteSummary = !fs.existsSync(summaryPath) || fs.statSync(summaryPath).size === 0;
      if (shouldWriteSummary) {
        fs.writeFileSync(
          summaryPath,
          [
            `# ${job.id} failed`,
            '',
            `Failure class: ${job.failureClass || 'unknown'}`,
            `Exit code: ${job.exitCode ?? 'unknown'}`,
            `Error: ${job.error || 'unknown'}`,
            `Completed at: ${now}`,
            '',
          ].join('\n'),
          'utf-8'
        );
      }
    } catch {
      // Best effort diagnostics; never mask the primary job failure.
    }
  }

  private cleanupContainer(id: string): CleanupResult {
    if (!/^kaseki-\d+$/.test(id)) {
      return { attempted: false, ok: false, detail: 'Invalid Kaseki container id.' };
    }
    const result = spawnSync('docker', ['rm', '-f', id], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const detail = `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`.trim();
    return {
      attempted: true,
      ok: result.status === 0,
      detail: detail || undefined,
    };
  }

  getLiveDockerLogTail(id: string, lines = 200): string | null {
    if (!/^kaseki-\d+$/.test(id)) {
      return null;
    }
    const result = spawnSync('docker', ['logs', '--tail', String(lines), id], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    return output.trim().length > 0 ? output : null;
  }

  getLiveProgressEvents(id: string, tail = 25): Array<Record<string, unknown>> {
    const output = this.getLiveDockerLogTail(id, Math.max(tail * 8, 80));
    if (!output) {
      return [];
    }
    const events: Array<Record<string, unknown>> = [];
    for (const line of output.split(/\r?\n/)) {
      const match = /^\[progress\]\s+([^:]+):\s*(.*)$/.exec(line);
      if (match) {
        events.push({
          source: 'docker-logs',
          stage: match[1].trim(),
          message: match[2].trim(),
        });
      }
    }
    return tail > 0 ? events.slice(-tail) : [];
  }

  private getResultDir(id: string): string {
    return path.join(this.config.resultsDir, id);
  }

  private serializeJob(job: Job): PersistedJob {
    const serializableJob = { ...job };
    delete serializableJob.timeout;
    return {
      ...serializableJob,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
    };
  }

  private deserializeJob(job: PersistedJob): Job {
    return {
      ...job,
      createdAt: new Date(job.createdAt),
      startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
      completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
      resultDir: job.resultDir || this.getResultDir(job.id),
      finalized: job.status === 'completed' || job.status === 'failed' ? true : job.finalized,
    };
  }

  private loadPersistedJobs(): void {
    try {
      this.withSyncLock(this.indexLockPath, 'Kaseki jobs index', () => {
      if (!fs.existsSync(this.indexPath)) {
        return;
      }

      try {
        const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as { jobs?: PersistedJob[] };
        for (const persisted of parsed.jobs || []) {
          const job = this.deserializeJob(persisted);
          if (job.status === 'running') {
            job.status = 'failed';
            job.exitCode = 143;
            job.failureClass = 'api_restart';
            job.error = 'API service restarted while job was running';
            job.completedAt = job.completedAt || new Date();
            job.finalized = true;
          }
          if (job.status === 'queued') {
            this.queue.push(job);
          }
          this.jobs.set(job.id, job);
        }
      } catch {
        // A corrupt index should not prevent the API from starting; existing
        // artifacts remain available on disk for direct inspection.
      }
      });
    } catch {
      // Lock contention during startup is best-effort; a future persist/load cycle will reconcile state.
    }
  }

  private parseInstanceNumber(id: string): number | null {
    const match = /^kaseki-(\d+)$/.exec(id);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private persistJobs(): void {
    try {
      this.withSyncLock(this.indexLockPath, 'Kaseki jobs index', () => {
        fs.mkdirSync(this.config.resultsDir, { recursive: true });
        const current = this.readPersistedJobsIndex();
        const merged = this.mergePersistedJobs(
          current.jobs || [],
          this.listJobs().map((job) => this.serializeJob(job)),
        );
        const payload = {
          version: 1,
          updatedAt: new Date().toISOString(),
          jobs: merged,
        };
        const tmpPath = `${this.indexPath}.tmp`;
        fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(tmpPath, this.indexPath);
      });
    } catch {
      // Keep scheduler progress alive even if persistence is unavailable.
    }
  }

  private readPersistedJobsIndex(): { jobs?: PersistedJob[] } {
    if (!fs.existsSync(this.indexPath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as { jobs?: PersistedJob[] };
    } catch {
      return {};
    }
  }

  private mergePersistedJobs(existing: PersistedJob[], incoming: PersistedJob[]): PersistedJob[] {
    const byId = new Map<string, PersistedJob>();
    for (const job of existing) {
      byId.set(job.id, job);
    }
    for (const job of incoming) {
      const prev = byId.get(job.id);
      if (!prev) {
        byId.set(job.id, job);
        continue;
      }
      byId.set(job.id, this.selectMostRecentPersistedJob(prev, job));
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  private selectMostRecentPersistedJob(a: PersistedJob, b: PersistedJob): PersistedJob {
    const aUpdated = this.persistedJobUpdatedAt(a);
    const bUpdated = this.persistedJobUpdatedAt(b);
    if (aUpdated !== bUpdated) {
      return bUpdated > aUpdated ? b : a;
    }
    const statusPriority: Record<Job['status'], number> = { queued: 0, running: 1, failed: 2, completed: 2 };
    return (statusPriority[b.status] || 0) >= (statusPriority[a.status] || 0) ? b : a;
  }

  private persistedJobUpdatedAt(job: PersistedJob): number {
    return Math.max(
      new Date(job.createdAt).getTime(),
      job.startedAt ? new Date(job.startedAt).getTime() : 0,
      job.completedAt ? new Date(job.completedAt).getTime() : 0,
    );
  }

  /**
   * Get queue status.
   */
  getQueueStatus(): { pending: number; running: number; maxConcurrent: number } {
    return {
      pending: this.queue.length,
      running: this.running.size,
      maxConcurrent: this.config.maxConcurrentRuns,
    };
  }

  /**
   * Shutdown the scheduler, aborting running jobs.
   */
  shutdown(): void {
    for (const jobId of this.running) {
      const j = this.jobs.get(jobId);
      if (j?.timeout) {
        clearTimeout(j.timeout);
      }

      const proc = this.processes.get(jobId);
      if (proc) {
        proc.kill('SIGTERM');

        const shutdownKillTimer = setTimeout(() => {
          if (!this.processExited.get(jobId)) {
            proc.kill('SIGKILL');
          }
          this.shutdownKillTimers.delete(jobId);
        }, JobScheduler.SHUTDOWN_GRACE_MS);
        this.shutdownKillTimers.set(jobId, shutdownKillTimer);
      }

      if (j && !j.finalized) {
        j.status = 'failed';
        j.failureClass = 'shutdown_aborted';
        j.error = 'Job aborted during scheduler shutdown';
        j.exitCode = 143;
        j.completedAt = new Date();
        this.completeJob(j);
      }
    }

    const now = new Date();
    for (const queuedJob of this.queue) {
      if (queuedJob.finalized) {
        continue;
      }
      queuedJob.status = 'failed';
      queuedJob.failureClass = 'shutdown_aborted';
      queuedJob.error = 'Job dropped during scheduler shutdown before execution';
      queuedJob.exitCode = 143;
      queuedJob.completedAt = now;
      queuedJob.finalized = true;
      this.jobs.set(queuedJob.id, queuedJob);
    }

    this.queue = [];
    this.persistJobs();
  }
}
