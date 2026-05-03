import { ChildProcess, spawn } from 'child_process';
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
  private nextInstanceNumber = 1;
  private logger: EventLogger;
  private webhookManager: WebhookManager;
  private static readonly SHUTDOWN_GRACE_MS = 5000;

  constructor(config: KasekiApiConfig, webhookManager: WebhookManager) {
    this.config = config;
    this.indexPath = path.join(config.resultsDir, '.kaseki-api-jobs.json');
    this.logger = createEventLogger('job-scheduler');
    this.webhookManager = webhookManager;
    this.loadPersistedJobs();
    this.initializeInstanceCounter();
    this.persistJobs();
    this.processQueue();
  }

  /**
   * Submit a new job to the queue.
   */
  submitJob(request: RunRequest): Job {
    const instanceId = this.generateInstanceId();

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
    job.status = 'failed';
    job.exitCode = 143;
    job.failureClass = 'cancelled';
    job.error = 'Job cancelled by API request';
    job.completedAt = completedAt;

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
      reason: 'cancelled_by_request',
      processId: job.processId,
    });

    this.completeJob(job);
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

    const finalizeJob = (updates: Partial<Job>): void => {
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
      this.completeJob(job);
    };

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
        this.logger.event('job_failed', {
          jobId: job.id,
          failureClass: 'timeout',
          exitCode: 124,
          durationSeconds: Math.round((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000,
        });

        // Emit webhook event for failure
        if (job.webhookConfig) {
          const payload: WebhookPayload = {
            eventType: WebhookEventType.JOB_FAILED,
            jobId: job.id,
            timestamp: new Date().toISOString(),
            data: {
              status: 'failed',
              failureClass: 'timeout',
              error: updates.error,
              elapsed: Math.round(((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000),
            },
          };
          this.webhookManager.enqueueWebhook(job.id, payload, job.webhookConfig);
        }
      } else if (code === 0) {
        updates.status = 'completed';
        this.logger.event('job_completed', {
          jobId: job.id,
          exitCode: code,
          durationSeconds: Math.round((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000,
        });

        // Emit webhook event for completion
        if (job.webhookConfig) {
          const payload: WebhookPayload = {
            eventType: WebhookEventType.JOB_COMPLETED,
            jobId: job.id,
            timestamp: new Date().toISOString(),
            data: {
              status: 'completed',
              exitCode: code,
              elapsed: Math.round(((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000),
            },
          };
          this.webhookManager.enqueueWebhook(job.id, payload, job.webhookConfig);
        }
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

        // Emit webhook event for failure
        if (job.webhookConfig) {
          const payload: WebhookPayload = {
            eventType: WebhookEventType.JOB_FAILED,
            jobId: job.id,
            timestamp: new Date().toISOString(),
            data: {
              status: 'failed',
              exitCode: code ?? undefined,
              failureClass: job.failureClass,
              error: job.error,
              elapsed: Math.round(((updates.completedAt as Date).getTime() - (job.startedAt?.getTime() || 0)) / 1000),
            },
          };
          this.webhookManager.enqueueWebhook(job.id, payload, job.webhookConfig);
        }
      }
      finalizeJob(updates);
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
      finalizeJob({
        status: 'failed',
        error: errorMsg,
        completedAt: new Date(),
      });
    });
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
    return decoder.write(tail);
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
  private generateInstanceId(): string {
    const maxAttempts = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const id = `kaseki-${this.nextInstanceNumber}`;
      this.nextInstanceNumber += 1;
      const resultsPath = this.getResultDir(id);
      if (!this.jobs.has(id) && !fs.existsSync(resultsPath)) {
        return id;
      }
    }

    throw new Error(`Failed to allocate unique job ID after ${maxAttempts} attempts`);
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
  }

  private initializeInstanceCounter(): void {
    const usedNumbers = new Set<number>();

    for (const id of this.jobs.keys()) {
      const num = this.parseInstanceNumber(id);
      if (num !== null) {
        usedNumbers.add(num);
      }
    }

    if (fs.existsSync(this.config.resultsDir)) {
      try {
        for (const entry of fs.readdirSync(this.config.resultsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) {
            continue;
          }
          const num = this.parseInstanceNumber(entry.name);
          if (num !== null) {
            usedNumbers.add(num);
          }
        }
      } catch {
        // Best effort only; generateInstanceId still validates on disk.
      }
    }

    const maxUsed = usedNumbers.size ? Math.max(...usedNumbers) : 0;
    this.nextInstanceNumber = maxUsed + 1;
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
      fs.mkdirSync(this.config.resultsDir, { recursive: true });
      const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        jobs: this.listJobs().map((job) => this.serializeJob(job)),
      };
      const tmpPath = `${this.indexPath}.tmp`;
      fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmpPath, this.indexPath);
    } catch {
      // Keep scheduler progress alive even if persistence is unavailable.
    }
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
