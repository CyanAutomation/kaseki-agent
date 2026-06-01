import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import {
  Job,
  RunRequest,
  WebhookEventType,
  WebhookPayload,
} from './kaseki-api-types';
import { KasekiApiConfig } from './kaseki-api-config';
import { createEventLogger, EventLogger } from './logger';
import { WebhookManager } from './webhook-manager';
import { metricsRegistry } from './metrics';
import { execSubprocess } from './lib/subprocess-helpers';
import { FailureArtifactWriter } from './utils/failure-artifact-writer';
import { clearRunArtifactMetadataCache } from './run-artifact-metadata-cache';
import { getSecretFilePath } from './secrets/host-secrets-reader';
import type { ResultCache } from './result-cache';
import { JobPersistenceManager } from './job-persistence-manager';

/**
 * Execution state for a job process lifecycle.
 * Replaces distributed boolean flags (timedOut, processExited) with a single state machine.
 */
enum JobExecutionState {
  IDLE = 'idle',
  STARTING = 'starting',
  RUNNING = 'running',
  TIMED_OUT = 'timed_out',
  EXITED = 'exited',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

type CleanupResult = {
  attempted: boolean;
  ok?: boolean;
  detail?: string;
};

type LiveProgressCacheEntry = {
  events: Array<Record<string, unknown>>;
  expiresAt: number;
};

type TimeoutHandles = {
  timeoutHandle: NodeJS.Timeout;
  forceKillHandle?: NodeJS.Timeout;
  cleanup: () => void;
  isTimedOut?: () => boolean;
};

/**
 * Job scheduler manages a FIFO queue of kaseki runs with concurrency control.
 */
export class JobScheduler {
  private static readonly STREAM_TAIL_LIMIT_BYTES = 64 * 1024;
  private static readonly DEFAULT_LIVE_PROGRESS_CACHE_TTL_MS = 1500;
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = new Set<string>();
  private processes = new Map<string, ChildProcess>();
  private processExited = new Map<string, boolean>();
  private shutdownKillTimers = new Map<string, NodeJS.Timeout>();
  private timeoutKillTimers = new Map<string, NodeJS.Timeout>();
  private liveProgressCache = new Map<string, LiveProgressCacheEntry>();
  private executionState = new Map<string, JobExecutionState>();
  private config: KasekiApiConfig;
  private logger: EventLogger;
  private webhookManager: WebhookManager;
  private failureArtifactWriter: FailureArtifactWriter;
  private artifactCache?: Pick<ResultCache, 'clearForJob'>;
  private persistenceManager: JobPersistenceManager;
  private initializationPromise: Promise<void>;
  private static readonly SHUTDOWN_GRACE_MS = 5000;

  constructor(
    config: KasekiApiConfig,
    webhookManager: WebhookManager,
    artifactCache?: Pick<ResultCache, 'clearForJob'>,
  ) {
    this.config = config;
    this.logger = createEventLogger('job-scheduler');
    this.webhookManager = webhookManager;
    this.failureArtifactWriter = new FailureArtifactWriter(config.resultsDir);
    this.artifactCache = artifactCache;
    this.persistenceManager = new JobPersistenceManager(config);
    this.initializationPromise = this.initializeFromPersistence();
  }

  /**
   * Submit a new job to the queue.
   */
  async submitJob(request: RunRequest): Promise<Job> {
    await this.ready();
    const instanceId = await this.persistenceManager.generateInstanceId(
      Array.from(this.jobs.keys()),
    );

    // Generate tracing IDs if not provided
    const correlationId = request.tracing?.correlationId || randomUUID();
    const requestId = request.tracing?.requestId || randomUUID();

    const job: Job = {
      id: instanceId,
      status: 'queued',
      request,
      createdAt: new Date(),
      resultDir: this.persistenceManager.getResultDir(instanceId),
      webhookConfig: request.webhookConfig,
      correlationId,
      requestId,
    };

    this.jobs.set(instanceId, job);
    this.queue.push(job);
    await this.persistJobs();

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
      this.webhookManager.enqueueWebhook(
        instanceId,
        payload,
        job.webhookConfig,
      );
    }

    this.processQueue();
    metricsRegistry.setQueuePending(this.queue.length);

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
   * List jobs retained in the API index. Active jobs are always retained;
   * terminal jobs may be compacted out of this API index after the newest
   * `jobIndexMaxEntries` terminal records, while their artifacts remain on disk.
   */
  listJobs(): Job[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
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
      this.failureArtifactWriter.writeFailureArtifacts(job, {
        attempted: false,
        detail: 'Job never started; no worker container was created.',
      });
      clearRunArtifactMetadataCache(job.id, job.resultDir);
      this.clearArtifactContentCache(job.id);
      this.clearLiveProgressCache(job.id);
      void this.persistJobs();

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

    // For running jobs, mark as cancelled but keep in running set
    // until the process actually exits to prevent race conditions
    job.status = 'failed';
    job.exitCode = 143;
    job.failureClass = 'cancelled';
    job.error = 'Job cancelled by API request';

    const proc = this.processes.get(id);
    if (proc) {
      proc.kill('SIGTERM');

      if (!this.shutdownKillTimers.has(id)) {
        // Force kill after grace period if process doesn't exit.
        const forceKillHandle = setTimeout(() => {
          if (!this.processExited.get(id)) {
            proc.kill('SIGKILL');
          }
          this.shutdownKillTimers.delete(id);
        }, JobScheduler.SHUTDOWN_GRACE_MS);

        this.unrefTimer(forceKillHandle);
        this.shutdownKillTimers.set(id, forceKillHandle);
      }
    }

    // Cleanup operations are handled by the process exit handler, which has
    // access to stdout/stderr tails for complete diagnostics.
    clearRunArtifactMetadataCache(job.id, job.resultDir);
    this.clearArtifactContentCache(job.id);
    this.clearLiveProgressCache(job.id);

    // Note: Don't call finalizeJobIfNeeded() here - let the process exit handler
    // handle the actual removal from running set to prevent race conditions

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
    while (
      this.queue.length > 0 &&
      this.running.size < this.config.maxConcurrentRuns
    ) {
      const job = this.queue.shift();
      if (job) {
        this.executeJob(job);
      }
    }
  }

  /**
   * Execute a single job.
   */
  /**
   * Build the environment variables for a job execution.
   * Extracted to reduce executeJob complexity and enable isolated testing.
   */
  private buildProcessEnvironment(
    job: Job,
    effectiveTimeoutSeconds: number,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // run-kaseki.sh owns creation of the per-instance result directory and
      // refuses to overwrite it. Keep host log mirroring at the parent results
      // directory so the API does not accidentally reserve the final result path.
      KASEKI_LOG_DIR: this.config.resultsDir,
      KASEKI_TASK_MODE: job.request.taskMode || this.config.defaultTaskMode,
      KASEKI_PUBLISH_MODE: job.request.publishMode || 'pr',
      KASEKI_MAX_DIFF_BYTES: String(
        job.request.maxDiffBytes || this.config.maxDiffBytes,
      ),
      KASEKI_AGENT_TIMEOUT_SECONDS: String(effectiveTimeoutSeconds),
    };

    // Inspect mode always skips pre-agent validation for speed (fast by default)
    if ((job.request.taskMode || this.config.defaultTaskMode) === 'inspect') {
      env.KASEKI_PRE_AGENT_VALIDATION = '0';
    }
    if ((job.request.publishMode || 'pr') === 'none') {
      env.GITHUB_APP_ENABLED = '0';
    }

    this.populateGitHubAppEnv(env);
    this.setupStartupCheckMode(job, env);
    this.setupValidationCommands(job, env);
    this.setupAutoLintCleanup(job, env);
    this.setupChangedFilesAllowlist(job, env);
    this.setupScoutingAndGoalCheckEnv(job, env);
    this.setupTaskPrompt(job, env);

    return env;
  }

  /**
   * Configure startup check mode environment variables.
   */
  private setupStartupCheckMode(job: Job, env: NodeJS.ProcessEnv): void {
    const validationCommands =
      job.request.validationCommands ?? job.request.validation?.commands;
    const startupCheckMode =
      job.request.startupCheckMode ||
      (job.request.startupCheck && validationCommands
        ? 'baseline-validation'
        : 'boot');

    if (job.request.startupCheck) {
      env.KASEKI_DRY_RUN = '1';
      env.KASEKI_TASK_MODE = 'inspect';
      env.KASEKI_STARTUP_CHECK_MODE = startupCheckMode;
      if (startupCheckMode === 'baseline-validation') {
        env.KASEKI_BASELINE_VALIDATION_DRY_RUN = '1';
      } else {
        env.KASEKI_VALIDATION_COMMANDS = 'none';
      }
      env.TASK_PROMPT =
        job.request.taskPrompt ||
        (startupCheckMode === 'baseline-validation'
          ? 'Run Kaseki baseline validation startup checks only. Clone the repo, install dependencies, run pre-agent validation, then exit without Pi agent work.'
          : 'Run Kaseki startup checks only. Verify container boot and dependencies, then exit without agent work.');
    }
  }

  /**
   * Configure validation commands in environment.
   */
  private setupValidationCommands(job: Job, env: NodeJS.ProcessEnv): void {
    const validationCommands =
      job.request.validationCommands ?? job.request.validation?.commands;
    if (validationCommands) {
      env.KASEKI_VALIDATION_COMMANDS = validationCommands.join(';');
    }
  }

  /**
   * Configure automatic lint cleanup in environment.
   */
  private setupAutoLintCleanup(job: Job, env: NodeJS.ProcessEnv): void {
    const autoLintCleanup =
      job.request.autoLintCleanup ?? job.request.validation?.autoLintCleanup;

    if (autoLintCleanup?.enabled !== undefined) {
      env.KASEKI_AUTO_LINT_CLEANUP = autoLintCleanup.enabled ? '1' : '0';
    }
    if (autoLintCleanup?.commands && autoLintCleanup.commands.length > 0) {
      env.KASEKI_AUTO_LINT_CLEANUP_COMMANDS = autoLintCleanup.commands.join(';');
    }
  }

  /**
   * Configure changed files allowlist in environment.
   */
  private setupChangedFilesAllowlist(job: Job, env: NodeJS.ProcessEnv): void {
    const changedFilesAllowlist =
      job.request.changedFilesAllowlist ?? job.request.allowlist?.include;
    if (changedFilesAllowlist) {
      env.KASEKI_CHANGED_FILES_ALLOWLIST = changedFilesAllowlist.join(' ');
    }
  }

  /**
   * Configure scouting, goal-setting, and goal-check environment variables.
   * Scouting is always enabled by default.
   */
  private setupScoutingAndGoalCheckEnv(job: Job, env: NodeJS.ProcessEnv): void {
    // Scouting is always enabled for patch mode runs
    env.KASEKI_SCOUTING = '1';
    // Goal-setting is enabled by default unless explicitly disabled
    if (job.request.goalSetting?.enabled !== undefined) {
      env.KASEKI_GOAL_SETTING = job.request.goalSetting.enabled ? '1' : '0';
    }
    if (job.request.goalSetting?.model) {
      env.KASEKI_GOAL_SETTING_MODEL = job.request.goalSetting.model;
    }
    if (job.request.goalSetting?.timeoutSeconds) {
      env.KASEKI_GOAL_SETTING_TIMEOUT_SECONDS = String(
        job.request.goalSetting.timeoutSeconds,
      );
    }
    if (job.request.goalCheck?.enabled !== undefined) {
      env.KASEKI_GOAL_CHECK = job.request.goalCheck.enabled ? '1' : '0';
    }
    if (job.request.goalCheck?.maxRetries !== undefined) {
      env.KASEKI_GOAL_CHECK_MAX_RETRIES = String(
        job.request.goalCheck.maxRetries,
      );
    }
    if (job.request.goalCheck?.model) {
      env.KASEKI_GOAL_CHECK_MODEL = job.request.goalCheck.model;
    }
    if (job.request.goalCheck?.timeoutSeconds) {
      env.KASEKI_GOAL_CHECK_TIMEOUT_SECONDS = String(
        job.request.goalCheck.timeoutSeconds,
      );
    }
    const taskMode = job.request.taskMode || this.config.defaultTaskMode;
    const publishMode = job.request.publishMode || 'pr';
    const defaultRunEvaluation =
      publishMode === 'pr' || publishMode === 'draft_pr'
        ? taskMode !== 'inspect' && !job.request.startupCheck
        : false;
    env.KASEKI_RUN_EVALUATION =
      (job.request.runEvaluation?.enabled ?? defaultRunEvaluation) ? '1' : '0';
    if (job.request.runEvaluation?.model) {
      env.KASEKI_RUN_EVALUATION_MODEL = job.request.runEvaluation.model;
    }
    if (job.request.runEvaluation?.timeoutSeconds) {
      env.KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS = String(
        job.request.runEvaluation.timeoutSeconds,
      );
    }
  }

  /**
   * Configure task prompt and related settings.
   */
  private setupTaskPrompt(job: Job, env: NodeJS.ProcessEnv): void {
    if (job.request.taskPrompt) {
      env.TASK_PROMPT = job.request.taskPrompt;
    }
    if ((job.request.taskMode || this.config.defaultTaskMode) === 'inspect') {
      env.KASEKI_ALLOW_EMPTY_DIFF = '1';
      env.KASEKI_SCOUTING = '0';
      env.KASEKI_GOAL_CHECK = job.request.goalCheck?.enabled ? '1' : '0';
      env.KASEKI_RUN_EVALUATION = job.request.runEvaluation?.enabled
        ? '1'
        : '0';
    }
  }

  /**
   * Configure timeout and kill timer for a job.
   * Orchestrates SIGTERM → grace period → SIGKILL flow.
   * Returns an object with timeout handles and a flag to check if timeout occurred.
   */
  private configureJobTimeout(
    jobId: string,
    proc: ChildProcess,
    effectiveTimeoutSeconds: number,
  ): TimeoutHandles & { isTimedOut: () => boolean } {
    let hasTimedOut = false;

    const timeoutHandle = setTimeout(() => {
      if (hasTimedOut) {
        return; // Already timed out, prevent double-kill
      }
      hasTimedOut = true;
      this.transitionState(
        jobId,
        JobExecutionState.RUNNING,
        JobExecutionState.TIMED_OUT,
      );

      proc.kill('SIGTERM');

      // Grace period: attempt SIGKILL after 5 seconds if process still alive
      const forceKillHandle = setTimeout(() => {
        if (!this.processExited.get(jobId)) {
          proc.kill('SIGKILL');
        }
        this.timeoutKillTimers.delete(jobId);
      }, JobScheduler.SHUTDOWN_GRACE_MS);

      this.unrefTimer(forceKillHandle);
      this.timeoutKillTimers.set(jobId, forceKillHandle);
    }, effectiveTimeoutSeconds * 1000);

    this.unrefTimer(timeoutHandle);

    return {
      timeoutHandle,
      cleanup: () => {
        clearTimeout(timeoutHandle);
        const forceKillHandle = this.timeoutKillTimers.get(jobId);
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
          this.timeoutKillTimers.delete(jobId);
        }
      },
      isTimedOut: () => hasTimedOut,
    };
  }

  /**
   * Attach event listeners to process for stdout, stderr, exit, and error handling.
   * Extracted to separate concerns and enable isolated listener testing.
   * Maintains separate buffers for stdout and stderr to prevent diagnostic misclassification.
   */
  private attachProcessListeners(
    jobId: string,
    job: Job,
    proc: ChildProcess,
    streamState: {
      stdoutTailRef: { current: Buffer<ArrayBufferLike> };
      stderrTailRef: { current: Buffer<ArrayBufferLike> };
      onExit: (code: number) => void;
    },
  ): void {
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      streamState.stdoutTailRef.current = this.appendBoundedTail(
        streamState.stdoutTailRef.current,
        incoming,
        JobScheduler.STREAM_TAIL_LIMIT_BYTES,
      );
    });

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      streamState.stderrTailRef.current = this.appendBoundedTail(
        streamState.stderrTailRef.current,
        incoming,
        JobScheduler.STREAM_TAIL_LIMIT_BYTES,
      );
    });

    proc.on('exit', (code) => {
      this.processExited.set(jobId, true);
      if (job.finalized) {
        return;
      }
      this.transitionState(
        jobId,
        JobExecutionState.RUNNING,
        JobExecutionState.EXITED,
      );
      streamState.onExit(code ?? -1);
    });

    proc.on('error', (err) => {
      this.processExited.set(jobId, true);
      if (job.finalized) {
        return;
      }
      this.transitionState(
        jobId,
        JobExecutionState.STARTING,
        JobExecutionState.FAILED,
      );
      const errorMsg = `Failed to spawn process: ${err.message}`;
      this.logger.event('job_failed', {
        jobId,
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

  private executeJob(job: Job): void {
    const effectiveTimeoutSeconds =
      job.request.timeoutSeconds ?? this.config.agentTimeoutSeconds;

    // Initialize job state
    this.clearLiveProgressCache(job.id);
    this.transitionState(
      job.id,
      JobExecutionState.IDLE,
      JobExecutionState.STARTING,
    );
    job.status = 'running';
    job.startedAt = new Date();
    job.effectiveTimeoutSeconds = effectiveTimeoutSeconds;
    job.resultDir = this.getResultDir(job.id);
    this.running.add(job.id);
    metricsRegistry.setRunningJobs(this.running.size);

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

    // Build process environment (extracted)
    const env = this.buildProcessEnvironment(job, effectiveTimeoutSeconds);

    // Determine kaseki-activate.sh path
    let activateScript = '/agents/kaseki-template/scripts/kaseki-activate.sh';
    if (!fs.existsSync(activateScript)) {
      // Fall back to development path
      activateScript = `${process.env.PWD || '/workspaces/kaseki-agent'}/scripts/kaseki-activate.sh`;
    }

    // Spawn process
    const proc = spawn(
      'bash',
      [
        activateScript,
        '--controller',
        'run',
        job.request.repoUrl,
        job.request.ref,
        job.id,
      ],
      {
        env,
        stdio: 'pipe',
      },
    );

    this.processes.set(job.id, proc);
    this.processExited.set(job.id, false);
    this.clearLiveProgressCache(job.id);

    // Create shared mutable stream state object with independent stdout/stderr tail references.
    let timeoutHandles: TimeoutHandles & { isTimedOut: () => boolean };
    const streamState = {
      stdoutTailRef: { current: Buffer.alloc(0) },
      stderrTailRef: { current: Buffer.alloc(0) },
      onExit: (code: number) => {
        const isTimedOut = timeoutHandles.isTimedOut
          ? timeoutHandles.isTimedOut()
          : false;
        this.handleProcessExit(
          job,
          code,
          isTimedOut,
          streamState.stdoutTailRef.current,
          streamState.stderrTailRef.current,
          timeoutHandles,
        );
      },
    };

    job.processId = proc.pid;
    void this.persistJobs();

    // Transition to RUNNING after successful spawn
    this.transitionState(
      job.id,
      JobExecutionState.STARTING,
      JobExecutionState.RUNNING,
    );

    // Configure timeout (extracted)
    timeoutHandles = this.configureJobTimeout(job.id, proc, effectiveTimeoutSeconds);
    job.timeout = timeoutHandles.timeoutHandle;

    // Attach process listeners with shared stream state
    this.attachProcessListeners(job.id, job, proc, streamState);
  }

  /**
   * Handle process exit event.
   * Extracted to reduce nesting and improve readability of exit logic.
   */
  private handleProcessExit(
    job: Job,
    code: number | null,
    isTimedOut: boolean,
    stdoutTail: Buffer<ArrayBufferLike>,
    stderrTail: Buffer<ArrayBufferLike>,
    timeoutHandles: TimeoutHandles,
  ): void {
    // Clean up timeout handles
    timeoutHandles.cleanup();

    const updates: Partial<Job> = {
      completedAt: new Date(),
      exitCode: code ?? -1,
    };

    // Handle cancelled jobs - they were marked as cancelled in cancelJob()
    if (job.failureClass === 'cancelled') {
      // Job was already marked as cancelled, just ensure completion status
      updates.status = 'failed';
      updates.exitCode = 143; // SIGTERM + 1
      updates.error = job.error || 'Job cancelled by API request';

      this.logger.event('job_cancelled_completed', {
        jobId: job.id,
        processId: job.processId,
        durationSeconds:
          Math.round(
            (updates.completedAt as Date).getTime() -
              (job.startedAt?.getTime() || 0),
          ) / 1000,
      });

      // Write failure artifacts for cancelled jobs
      const cleanup = this.cleanupContainer(job.id);
      this.failureArtifactWriter.writeFailureArtifacts(job, cleanup, {
        stdoutTail,
        stderrTail,
        lastStage: 'cancelled',
      });
    } else if (isTimedOut) {
      metricsRegistry.incTimeout();
      updates.status = 'failed';
      updates.exitCode = 124;
      updates.failureClass = 'timeout';
      updates.error = `Agent timeout after ${job.effectiveTimeoutSeconds} seconds`;
      this.logger.event('job_failed', {
        jobId: job.id,
        failureClass: 'timeout',
        exitCode: 124,
        durationSeconds:
          Math.round(
            (updates.completedAt as Date).getTime() -
              (job.startedAt?.getTime() || 0),
          ) / 1000,
      });
    } else if (code === 0) {
      updates.status = 'completed';
      this.transitionState(
        job.id,
        JobExecutionState.EXITED,
        JobExecutionState.COMPLETED,
      );
      this.logger.event('job_completed', {
        jobId: job.id,
        exitCode: code,
        durationSeconds:
          Math.round(
            (updates.completedAt as Date).getTime() -
              (job.startedAt?.getTime() || 0),
          ) / 1000,
      });
    } else {
      updates.status = 'failed';
      this.transitionState(
        job.id,
        JobExecutionState.EXITED,
        JobExecutionState.FAILED,
      );
      this.parseFailureFromResults(job);
      this.writeControllerBootstrapLogs(job, stdoutTail, stderrTail);
      this.failureArtifactWriter.writeFailureArtifacts(
        job,
        {
          attempted: false,
          ok: false,
          detail: 'Worker failed before complete diagnostics.',
        },
        {
          stdoutTail,
          stderrTail,
          lastStage: 'worker_exit',
        },
      );
      this.logger.event('job_failed', {
        jobId: job.id,
        exitCode: code,
        failureClass: job.failureClass,
        error: job.error,
        durationSeconds:
          Math.round(
            (updates.completedAt as Date).getTime() -
              (job.startedAt?.getTime() || 0),
          ) / 1000,
      });
    }

    this.finalizeJobIfNeeded(job, updates);
    this.clearExecutionState(job.id);

    if (isTimedOut) {
      const cleanup = this.cleanupContainer(job.id);
      this.failureArtifactWriter.writeFailureArtifacts(job, cleanup, {
        stdoutTail,
        stderrTail,
        lastStage: 'timeout',
      });
    }
  }

  private unrefTimer(timer: NodeJS.Timeout): void {
    timer.unref();
  }

  /**
   * Transition job execution state with logging.
   * Prevents invalid state transitions and logs state changes for debugging.
   */
  private transitionState(
    jobId: string,
    fromState: JobExecutionState,
    toState: JobExecutionState,
  ): void {
    const currentState =
      this.executionState.get(jobId) || JobExecutionState.IDLE;

    // Log state transitions for debugging
    if (currentState !== fromState) {
      this.logger.event('job_execution_state_mismatch', {
        jobId,
        expected: fromState,
        actual: currentState,
        target: toState,
      });
    }

    this.executionState.set(jobId, toState);
    this.logger.event('job_execution_state_transition', {
      jobId,
      from: currentState,
      to: toState,
    });
  }

  /**
   * Clear execution state for a job (after finalization).
   */
  private clearExecutionState(jobId: string): void {
    this.executionState.delete(jobId);
  }

  private populateGitHubAppEnv(env: NodeJS.ProcessEnv): void {
    const githubAppSecretFiles = [
      ['GITHUB_APP_ID_FILE', 'github_app_id'],
      ['GITHUB_APP_CLIENT_ID_FILE', 'github_app_client_id'],
      ['GITHUB_APP_PRIVATE_KEY_FILE', 'github_app_private_key'],
    ] as const;

    for (const [envName, secretName] of githubAppSecretFiles) {
      // If already configured via environment, skip
      const configuredPath = env[envName];
      if (configuredPath) {
        continue;
      }

      // GitHub App secrets are now resolved by host-secrets-reader.ts to prefer
      // root-level mounts (/run/secrets/{name}) which align with run-kaseki.sh.
      // This ensures the job scheduler passes correct paths to worker containers.
      const secretPath = getSecretFilePath(secretName);
      if (fs.existsSync(secretPath)) {
        env[envName] = secretPath;
      }
    }
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

    // Emit terminal webhook for all jobs (cancelled jobs will emit JOB_CANCELLED here)
    this.emitTerminalWebhook(job);
    this.completeJob(job);
  }

  private emitTerminalWebhook(job: Job): void {
    if (!job.webhookConfig) {
      return;
    }

    const elapsed =
      job.completedAt && job.startedAt
        ? Math.round(
          (job.completedAt.getTime() - job.startedAt.getTime()) / 1000,
        )
        : undefined;

    if (job.failureClass === 'cancelled') {
      const payload: WebhookPayload = {
        eventType: WebhookEventType.JOB_CANCELLED,
        jobId: job.id,
        timestamp: new Date().toISOString(),
        data: {
          status: 'failed',
          failureClass: 'cancelled',
          error: job.error,
          elapsed,
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
    limitBytes: number,
  ): Buffer<ArrayBufferLike> {
    if (incoming.length >= limitBytes) {
      return incoming.subarray(incoming.length - limitBytes);
    }
    const combined =
      currentTail.length > 0
        ? Buffer.concat([currentTail, incoming])
        : incoming;
    if (combined.length <= limitBytes) {
      return combined;
    }
    return combined.subarray(combined.length - limitBytes);
  }

  private writeControllerBootstrapLogs(
    job: Job,
    stdoutTail: Buffer<ArrayBufferLike>,
    stderrTail: Buffer<ArrayBufferLike>,
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
      const metadataPath = path.join(
        this.getResultDir(job.id),
        'metadata.json',
      );
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

  private clearArtifactContentCache(jobId: string): void {
    this.artifactCache?.clearForJob(jobId);
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
    if (job.startedAt && job.completedAt) {
      metricsRegistry.observeRunDuration(
        (job.completedAt.getTime() - job.startedAt.getTime()) / 1000,
      );
    }
    if (job.status === 'completed') {
      metricsRegistry.incRunSuccess();
    } else if (job.status === 'failed') {
      metricsRegistry.incRunFailure();
    }
    this.running.delete(job.id);
    metricsRegistry.setRunningJobs(this.running.size);
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
    clearRunArtifactMetadataCache(job.id, job.resultDir);
    this.clearArtifactContentCache(job.id);
    this.clearLiveProgressCache(job.id);
    void this.persistJobs();
    this.processQueue();
    metricsRegistry.setQueuePending(this.queue.length);
  }

  private cleanupContainer(id: string): CleanupResult {
    if (!/^kaseki-\d+$/.test(id)) {
      return {
        attempted: false,
        ok: false,
        detail: 'Invalid Kaseki container id.',
      };
    }
    const result = execSubprocess('docker', ['rm', '-f', id]);
    return {
      attempted: true,
      ok: result.ok,
      detail: result.detail || undefined,
    };
  }

  getLiveDockerLogTail(id: string, lines = 200): string | null {
    if (!/^kaseki-\d+$/.test(id)) {
      return null;
    }
    const result = execSubprocess('docker', [
      'logs',
      '--tail',
      String(lines),
      id,
    ]);
    const output = [result.stdout || '', result.stderr || ''].join('');
    return output.trim().length > 0 ? output : null;
  }

  getLiveProgressEvents(id: string, tail = 25): Array<Record<string, unknown>> {
    if (!/^kaseki-\d+$/.test(id)) {
      return [];
    }
    const job = this.jobs.get(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) {
      this.clearLiveProgressCache(id);
      return [];
    }

    const cacheKey = this.getLiveProgressCacheKey(id);
    const cachedEvents = this.getCachedLiveProgressEvents(cacheKey);
    if (cachedEvents) {
      return tail > 0 ? cachedEvents.slice(-tail) : [];
    }

    const output = this.getLiveDockerLogTail(id, Math.max(tail * 8, 80));
    if (!output) {
      this.cacheLiveProgressEvents(cacheKey, []);
      return [];
    }
    const events = this.parseLiveProgressEvents(output);
    this.cacheLiveProgressEvents(cacheKey, events);
    return tail > 0 ? events.slice(-tail) : [];
  }

  private parseLiveProgressEvents(
    output: string,
  ): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];
    for (const line of output.split(/\r?\n/)) {
      const match = /^\[progress\]\s+([^:]+):\s*(.*)$/.exec(line);
      if (match) {
        events.push({
          source: 'docker-logs',
          stage: match[1].trim().replace(/ info$/, ''),
          message: match[2].trim(),
          timestamp: new Date().toISOString(),
        });
      }
    }
    return events;
  }

  private getCachedLiveProgressEvents(
    cacheKey: string,
  ): Array<Record<string, unknown>> | undefined {
    const cached = this.liveProgressCache.get(cacheKey);
    if (!cached) {
      return undefined;
    }
    if (Date.now() >= cached.expiresAt) {
      this.liveProgressCache.delete(cacheKey);
      return undefined;
    }
    return cached.events;
  }

  private cacheLiveProgressEvents(
    cacheKey: string,
    events: Array<Record<string, unknown>>,
  ): void {
    this.liveProgressCache.set(cacheKey, {
      events,
      expiresAt: Date.now() + this.getLiveProgressCacheTtlMs(),
    });
  }

  private clearLiveProgressCache(id: string): void {
    const prefix = `${id}::`;
    for (const key of this.liveProgressCache.keys()) {
      if (key.startsWith(prefix)) {
        this.liveProgressCache.delete(key);
      }
    }
  }

  private getLiveProgressCacheKey(id: string): string {
    const job = this.jobs.get(id);
    const startedAt = job?.startedAt?.getTime() ?? 0;
    const processId = job?.processId ?? 0;
    return `${id}::${startedAt}::${processId}`;
  }

  private getLiveProgressCacheTtlMs(): number {
    const rawTtl = process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
    if (!rawTtl) {
      return JobScheduler.DEFAULT_LIVE_PROGRESS_CACHE_TTL_MS;
    }

    const ttl = Number(rawTtl);
    if (!Number.isFinite(ttl) || ttl < 0) {
      return JobScheduler.DEFAULT_LIVE_PROGRESS_CACHE_TTL_MS;
    }
    return ttl;
  }

  private getResultDir(id: string): string {
    return this.persistenceManager.getResultDir(id);
  }

  async ready(): Promise<void> {
    await this.initializationPromise;
  }

  private async initializeFromPersistence(): Promise<void> {
    await this.loadPersistedJobs();
    await this.persistJobs();
    this.processQueue();
    metricsRegistry.setQueuePending(this.queue.length);
    metricsRegistry.setRunningJobs(this.running.size);
  }

  private async loadPersistedJobs(): Promise<void> {
    const { jobs, queuedJobs, status } =
      await this.persistenceManager.loadPersistedJobs();
    for (const job of jobs) {
      this.jobs.set(job.id, job);
    }
    for (const job of queuedJobs) {
      this.queue.push(job);
    }

    if (status === 'lock_contention') {
      this.logger.event('persisted_jobs_load_skipped_lock_contention', {
        resultsDir: this.config.resultsDir,
      });
      return;
    }

    if (status === 'read_error') {
      this.logger.event('persisted_jobs_load_read_error', {
        resultsDir: this.config.resultsDir,
      });
    }
  }

  private async persistJobs(): Promise<void> {
    await this.persistenceManager.persistJobs(Array.from(this.jobs.values()));
  }

  /**
   * Get queue status.
   */
  getQueueStatus(): {
    pending: number;
    running: number;
    maxConcurrent: number;
    } {
    return {
      pending: this.queue.length,
      running: this.running.size,
      maxConcurrent: this.config.maxConcurrentRuns,
    };
  }

  getReadiness(): { ready: boolean; reasons: string[] } {
    const reasons: string[] = [];
    try {
      fs.mkdirSync(this.config.resultsDir, { recursive: true });
      fs.accessSync(
        this.config.resultsDir,
        fs.constants.R_OK | fs.constants.W_OK,
      );
    } catch (error) {
      reasons.push(`results_dir_unwritable:${(error as Error).message}`);
    }
    if (!this.webhookManager.isHealthy()) {
      reasons.push('webhook_manager_unhealthy');
    }
    try {
      const status = this.getQueueStatus();
      if (
        !Number.isFinite(status.pending) ||
        !Number.isFinite(status.running)
      ) {
        reasons.push('scheduler_status_invalid');
      }
    } catch {
      reasons.push('scheduler_unavailable');
    }
    return { ready: reasons.length === 0, reasons };
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
        this.unrefTimer(shutdownKillTimer);
        this.shutdownKillTimers.set(jobId, shutdownKillTimer);
      }

      // Proactively clean up the Docker container
      this.cleanupContainer(jobId);

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

      this.finalizeJobIfNeeded(queuedJob, {
        status: 'failed',
        exitCode: 143,
        failureClass: 'shutdown_aborted',
        error: 'Job dropped during scheduler shutdown before execution',
        completedAt: now,
      });
    }

    this.queue = [];
    this.liveProgressCache.clear();
    void this.persistJobs();
  }
}
