import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Job, RunRequest } from './kaseki-api-types';
import { KasekiApiConfig } from './kaseki-api-config';

/**
 * Job scheduler manages a FIFO queue of kaseki runs with concurrency control.
 */
export class JobScheduler {
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = new Set<string>();
  private instanceCounter = 0;
  private config: KasekiApiConfig;

  constructor(config: KasekiApiConfig) {
    this.config = config;
  }

  /**
   * Submit a new job to the queue.
   */
  submitJob(request: RunRequest): Job {
    const instanceId = this.generateInstanceId();
    const job: Job = {
      id: instanceId,
      status: 'queued',
      request,
      createdAt: new Date(),
    };

    this.jobs.set(instanceId, job);
    this.queue.push(job);
    this.processQueue();

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
    this.running.add(job.id);

    const resultsDir = path.join(this.config.resultsDir, job.id);

    // Prepare environment
    const env = {
      ...process.env,
      KASEKI_LOG_DIR: resultsDir,
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
    const proc = spawn('bash', [activateScript, '--controller', 'run', job.request.repoUrl, job.request.ref], {
      env,
      stdio: 'pipe',
    });

    job.processId = proc.pid;

    // Note: stdout/stderr collection omitted per kaseki-agent design
    // (logs are written directly to disk by kaseki-agent.sh)

    // Set timeout
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      job.status = 'failed';
      job.exitCode = 124;
      job.failureClass = 'timeout';
      job.error = `Agent timeout after ${this.config.agentTimeoutSeconds} seconds`;
      this.completeJob(job);
    }, this.config.agentTimeoutSeconds * 1000);

    job.timeout = timeout;

    // Handle process exit
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      job.completedAt = new Date();
      job.exitCode = code ?? -1;

      if (code === 0) {
        job.status = 'completed';
      } else {
        job.status = 'failed';
        // Try to parse failure from results
        this.parseFailureFromResults(job);
      }

      this.completeJob(job);
    });

    // Handle process error
    proc.on('error', (err) => {
      clearTimeout(timeout);
      job.status = 'failed';
      job.error = `Failed to spawn process: ${err.message}`;
      job.completedAt = new Date();
      this.completeJob(job);
    });
  }

  /**
   * Parse failure class from results metadata.
   */
  private parseFailureFromResults(job: Job): void {
    try {
      const metadataPath = path.join(this.config.resultsDir, job.id, 'metadata.json');
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
    this.running.delete(job.id);
    this.processQueue();
  }

  /**
   * Generate a unique instance ID.
   */
  private generateInstanceId(): string {
    return `kaseki-${++this.instanceCounter}`;
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
    for (const job of this.running) {
      const j = this.jobs.get(job);
      if (j?.timeout) {
        clearTimeout(j.timeout);
      }
    }
    this.running.clear();
    this.queue = [];
  }
}
