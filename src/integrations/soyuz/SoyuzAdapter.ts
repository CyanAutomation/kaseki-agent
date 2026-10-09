import { createHash, randomUUID } from 'node:crypto';
import { createEventLogger } from '../../logger';
import { metricsRegistry } from '../../metrics';
import type { KasekiApiConfig } from '../../kaseki-api-config';
import type { Job, RunRequest } from '../../kaseki-api-types';
import { JobScheduler } from '../../job-scheduler';
import { checkGitHubAppCredentials, checkTemplatePublishModeCompatibility, getSubmissionTemplateHealthStatus, isTemplateDoctorTimeout } from '../../kaseki-api-health-checks';
import { evaluateTaskAdmission, type TaskAdmissionEvaluator } from '../../task-admission';
import type { SoyuzOutboxEntry } from '../../job-persistence-manager';
import { loadSoyuzAdapterConfig, type SoyuzAdapterConfig } from './config';
import { CloudflareQueueConsumer } from './CloudflareQueueConsumer';
import { decodeQueueMessageBody, parseSoyuzQueuedRun, type CloudflarePulledMessage, type SoyuzQueuedRun, type SoyuzWorkerRun } from './contracts';
import { SoyuzApiClient, SoyuzApiError } from './SoyuzApiClient';

class SoyuzAdmissionRejectedError extends Error {
  constructor(readonly safeReason: string) {
    super(safeReason);
    this.name = 'SoyuzAdmissionRejectedError';
  }
}

const MAX_NONTERMINAL_OUTBOX_PENDING = 250;
const CLAIM_CALLBACK_NAMESPACE = Buffer.from('3b7d4c748b5b5f8fa2d0a13c4a44c955', 'hex');
const logger = createEventLogger('soyuz-adapter');

export class SoyuzAdapter {
  private readonly config: SoyuzAdapterConfig;
  private readonly api: SoyuzApiClient;
  private readonly queue: CloudflareQueueConsumer;
  private readonly taskAdmissionEvaluator: TaskAdmissionEvaluator;
  private accepting = true;
  private stopping = false;
  private loopPromise?: Promise<void>;
  private activeCycle?: Promise<void>;
  private wakeLoop?: () => void;
  private pullFailures = 0;
  private pullRetryAfterMs = 0;
  private lastOutboxBacklogWarningAt = 0;
  private lastOutboxFullWarningAt = 0;
  private cancellationCheckAt = new Map<string, number>();

  constructor(
    kasekiConfig: KasekiApiConfig,
    private readonly scheduler: JobScheduler,
    taskAdmissionEvaluator: TaskAdmissionEvaluator = evaluateTaskAdmission,
    config: SoyuzAdapterConfig = kasekiConfig.soyuz ?? loadSoyuzAdapterConfig(),
    fetchImpl: typeof fetch = fetch,
  ) {
    this.config = config;
    this.api = new SoyuzApiClient(config, fetchImpl);
    this.queue = new CloudflareQueueConsumer(config, fetchImpl);
    this.taskAdmissionEvaluator = taskAdmissionEvaluator;
  }

  start(): void {
    if (!this.config.enabled || this.loopPromise) return;
    logger.event('soyuz_adapter_started', {
      workerId: this.config.workerId,
      pollIntervalMs: this.config.pollIntervalMs,
      batchSize: this.config.batchSize,
      visibilityTimeoutMs: this.config.visibilityTimeoutMs,
    });
    this.loopPromise = this.runLoop();
  }

  async runOnce(): Promise<void> {
    await this.cycle();
  }

  async stopConsuming(): Promise<void> {
    this.accepting = false;
    this.stopping = true;
    this.wakeLoop?.();
    await this.activeCycle;
    await this.loopPromise;
  }

  async shutdown(): Promise<void> {
    if (!this.config.enabled) return;
    this.accepting = false;
    this.stopping = true;
    await this.activeCycle;
    await this.loopPromise;
    try {
      await this.reconcileLocalJobs();
      await this.flushCallbackOutbox();
    } catch (error) {
      logger.error('Final Soyuz shutdown reconciliation failed; durable callback records will retry on restart', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logger.event('soyuz_adapter_stopped', { workerId: this.config.workerId });
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      this.activeCycle = this.cycle();
      try {
        await this.activeCycle;
      } catch (error) {
        logger.error('Soyuz adapter cycle failed', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.activeCycle = undefined;
      }
      if (!this.stopping) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.wakeLoop = undefined;
            resolve();
          }, this.nextPollDelayMs());
          this.wakeLoop = () => {
            clearTimeout(timer);
            this.wakeLoop = undefined;
            resolve();
          };
        });
      }
    }
  }

  private nextPollDelayMs(): number {
    const failureBackoff = this.pullFailures === 0
      ? this.config.pollIntervalMs
      : Math.min(60_000, this.config.pollIntervalMs * (2 ** Math.min(this.pullFailures, 4)));
    return Math.max(failureBackoff, this.pullRetryAfterMs);
  }

  private async cycle(): Promise<void> {
    if (!this.config.enabled) return;
    await this.flushCallbackOutbox();
    await this.reconcileLocalJobs();
    if (!this.accepting || this.stopping) return;

    const status = this.scheduler.getQueueStatus();
    const capacity = Math.max(0, status.maxConcurrent - status.running - status.pending);
    if (capacity === 0) return;
    const outbox = await this.scheduler.getSoyuzOutboxStatus();
    metricsRegistry.setSoyuzCallbacksPending(outbox.pending);
    if (outbox.pending >= 5_000) {
      if (Date.now() - this.lastOutboxFullWarningAt >= 60_000) {
        this.lastOutboxFullWarningAt = Date.now();
        logger.error('Soyuz callback outbox is full; queue consumption is paused', {
          pendingCallbacks: outbox.pending,
          oldestPendingAt: outbox.oldestPendingAt,
        });
      }
      return;
    }

    let messages: CloudflarePulledMessage[];
    try {
      messages = await this.queue.pull(Math.min(this.config.batchSize, capacity));
      this.pullFailures = 0;
      this.pullRetryAfterMs = 0;
      metricsRegistry.incSoyuzCounter('queue_pull_success');
    } catch (error) {
      this.pullFailures += 1;
      this.pullRetryAfterMs = Math.min(15 * 60_000, (isHttpError(error) ? error.retryAfterSeconds ?? 0 : 0) * 1_000);
      metricsRegistry.incSoyuzCounter('queue_pull_failure');
      logger.error('Soyuz Queue pull failed', {
        workerId: this.config.workerId,
        failureCount: this.pullFailures,
        status: isHttpError(error) ? error.status : undefined,
        retryAfterSeconds: isHttpError(error) ? error.retryAfterSeconds : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const message of messages) {
      await this.consumeMessage(message);
    }
  }

  private async consumeMessage(message: CloudflarePulledMessage): Promise<void> {
    let safeToAcknowledge = false;
    try {
      const run = parseSoyuzQueuedRun(decodeQueueMessageBody(message.body));
      safeToAcknowledge = await this.handoff(run);
    } catch (error) {
      if (error instanceof SoyuzAdmissionRejectedError) {
        logger.warn('Kaseki admission rejected Soyuz work', { reason: error.safeReason });
      } else {
        logger.error('Soyuz Queue message was not handed off', {
          queueMessageId: message.id,
          attempt: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (safeToAcknowledge) {
      try {
        await this.queue.acknowledge(message.lease_id);
      } catch (error) {
        // The response may have been lost after Cloudflare accepted the ack. Let lease expiry/redelivery resolve it.
        logger.error('Soyuz Queue acknowledgement is uncertain; duplicate delivery will be reconciled by run ID', {
          queueMessageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    try {
      await this.queue.retry(message.lease_id, this.queueRetryDelaySeconds(message.attempts));
    } catch (error) {
      logger.error('Soyuz Queue retry request failed; the lease will expire and be redelivered', {
        queueMessageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private queueRetryDelaySeconds(attempts: number): number {
    return Math.min(900, Math.max(5, 5 * (2 ** Math.min(attempts, 7))));
  }

  private async handoff(run: SoyuzQueuedRun): Promise<boolean> {
    const handoffStartedAt = Date.now();
    let canonical = await this.api.getRun(run.runId);
    if (isTerminal(canonical.status)) return true;
    if (canonical.status === 'admitting') return false;

    let localJob = await this.scheduler.findSoyuzJob(run.runId);
    if (canonical.status === 'running' || canonical.status === 'cancel_requested') {
      if (localJob && canonical.workerId === this.config.workerId) {
        if (canonical.status === 'cancel_requested') {
          await this.scheduler.cancelSoyuzJob(localJob.id);
        } else if (localJob.status === 'queued'
          && (!localJob.soyuz?.startAuthorized || localJob.soyuz.startNeedsCanonicalRecheck)) {
          await this.api.started(run.runId, localJob.soyuz?.startedCallbackId ?? randomUUID(), this.config.workerId, new Date().toISOString());
          await this.scheduler.authorizeSoyuzStart(localJob.id);
        }
      } else if (!localJob) {
        logger.error('Soyuz run is active on a host with no matching durable Kaseki mapping; refusing to execute duplicate work', {
          runId: run.runId,
          canonicalWorkerId: canonical.workerId,
          workerId: this.config.workerId,
          operationalHealth: canonical.operationalHealth,
        });
      }
      return true;
    }

    if (canonical.status === 'claimed' && canonical.workerId !== this.config.workerId) return false;
    if (canonical.status !== 'queued' && canonical.status !== 'claimed') return false;

    if (!localJob) {
      let request: RunRequest;
      try {
        request = await this.assertKasekiAdmission(run);
      } catch (error) {
        if (!(error instanceof SoyuzAdmissionRejectedError)) throw error;
        if (canonical.status === 'queued') {
          await this.api.claim(run.runId, claimCallbackId(run.runId, this.config.workerId, canonical.updatedAt), this.config.workerId);
          metricsRegistry.incSoyuzCounter('claim_success');
          canonical = await this.api.getRun(run.runId);
        }
        if (canonical.status !== 'claimed' || canonical.workerId !== this.config.workerId) return false;
        localJob = await this.scheduler.recordSoyuzAdmissionFailure(
          run.request,
          run.runId,
          this.config.workerId,
          run.correlationId,
          run.requestId,
        );
        await this.ensureTerminalCallback(localJob);
        return true;
      }

      if (canonical.status === 'queued') {
        try {
          await this.api.claim(run.runId, claimCallbackId(run.runId, this.config.workerId, canonical.updatedAt), this.config.workerId);
          metricsRegistry.incSoyuzCounter('claim_success');
          canonical = await this.api.getRun(run.runId);
        } catch (error) {
          if (error instanceof SoyuzApiError && error.status === 409) {
            metricsRegistry.incSoyuzCounter('claim_conflict');
            canonical = await this.api.getRun(run.runId);
            if (isTerminal(canonical.status)) return true;
            if (canonical.status === 'claimed' && canonical.workerId === this.config.workerId) {
              // This host received the response-lost claim on a previous Queue delivery.
            } else if (canonical.status === 'running' && canonical.workerId === this.config.workerId) {
              localJob = await this.scheduler.submitSoyuzJob(request, run.runId, this.config.workerId, run.correlationId, run.requestId);
              await this.api.started(run.runId, localJob.soyuz?.startedCallbackId ?? randomUUID(), this.config.workerId, new Date().toISOString());
              await this.scheduler.authorizeSoyuzStart(localJob.id);
              metricsRegistry.observeSoyuzHandoffDuration((Date.now() - handoffStartedAt) / 1000);
              return true;
            } else {
              return canonical.status === 'running' || canonical.status === 'cancel_requested' ? true : false;
            }
          } else {
            throw error;
          }
        }
      }

      localJob = await this.scheduler.submitSoyuzJob(
        request,
        run.runId,
        this.config.workerId,
        run.correlationId,
        run.requestId,
      );
    }

    if (localJob.status !== 'queued') {
      if (canonical.status === 'queued') {
        try {
          await this.api.claim(run.runId, claimCallbackId(run.runId, this.config.workerId, canonical.updatedAt), this.config.workerId);
          metricsRegistry.incSoyuzCounter('claim_success');
          canonical = await this.api.getRun(run.runId);
        } catch (error) {
          if (!(error instanceof SoyuzApiError) || error.status !== 409) throw error;
          metricsRegistry.incSoyuzCounter('claim_conflict');
          canonical = await this.api.getRun(run.runId);
        }
      }
      if (canonical.status === 'claimed' && canonical.workerId === this.config.workerId) {
        await this.ensureTerminalCallback(localJob);
        return true;
      }
      if (isTerminal(canonical.status)) return true;
      return false;
    }

    if (canonical.status === 'queued') {
      try {
        await this.api.claim(run.runId, claimCallbackId(run.runId, this.config.workerId, canonical.updatedAt), this.config.workerId);
        metricsRegistry.incSoyuzCounter('claim_success');
      } catch (error) {
        if (!(error instanceof SoyuzApiError) || error.status !== 409) throw error;
        metricsRegistry.incSoyuzCounter('claim_conflict');
        canonical = await this.api.getRun(run.runId);
        if (isTerminal(canonical.status)) return true;
        if (canonical.status !== 'claimed' || canonical.workerId !== this.config.workerId) return false;
      }
    }
    if (canonical.status !== 'claimed' && canonical.status !== 'queued') return false;
    if (canonical.status === 'claimed' && canonical.workerId !== this.config.workerId) return false;

    const startedAt = new Date().toISOString();
    try {
      await this.api.started(run.runId, localJob.soyuz?.startedCallbackId ?? randomUUID(), this.config.workerId, startedAt);
    } catch (error) {
      if (error instanceof SoyuzApiError && error.status === 409) {
        const latest = await this.api.getRun(run.runId);
        if (isTerminal(latest.status)) return true;
      }
      throw error;
    }
    if (!(await this.scheduler.authorizeSoyuzStart(localJob.id))) {
      throw new Error('Soyuz accepted started callback but Kaseki no longer has an authorizable queued job');
    }
    metricsRegistry.incSoyuzCounter('runs_started');
    metricsRegistry.observeSoyuzHandoffDuration((Date.now() - handoffStartedAt) / 1000);
    logger.event('soyuz_run_started', {
      runId: run.runId,
      localRunId: localJob.id,
      correlationId: run.correlationId,
      workerId: this.config.workerId,
    });
    return true;
  }

  private async reconcileLocalJobs(): Promise<void> {
    const jobs = await this.scheduler.listSoyuzJobs();
    for (const job of jobs) {
      if (!job.soyuz) continue;
      try {
        const canonical = await this.api.getRun(job.soyuz.externalRunId);
        if (isTerminal(canonical.status)) {
          if (job.status === 'queued') await this.scheduler.cancelSoyuzJob(job.id);
          if (this.scheduler.isJobExecuting(job.id)) await this.scheduler.cancelSoyuzJob(job.id);
          continue;
        }
        if (job.status === 'queued'
          && (!job.soyuz.startAuthorized || job.soyuz.startNeedsCanonicalRecheck)) {
          await this.recoverUnstartedLocalJob(job, canonical);
          continue;
        }
        if (this.scheduler.isJobExecuting(job.id) || job.status === 'running'
          || (job.status === 'queued' && job.soyuz.startAuthorized && !job.soyuz.startNeedsCanonicalRecheck)) {
          await this.monitorActiveRun(job, canonical);
        }
        if ((job.status === 'completed' || job.status === 'failed')
          && !this.scheduler.isJobExecuting(job.id)
          && !this.scheduler.isJobProcessAlive(job.id)) {
          await this.ensureTerminalCallback(job);
          this.cancellationCheckAt.delete(job.id);
        }
      } catch (error) {
        logger.error('Soyuz local-run reconciliation failed', {
          runId: job.soyuz.externalRunId,
          localRunId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async recoverUnstartedLocalJob(job: Job, canonical: SoyuzWorkerRun): Promise<void> {
    if (!job.soyuz) return;
    if (canonical.workerId && canonical.workerId !== this.config.workerId) {
      this.scheduler.holdSoyuzJob(job.id);
      return;
    }
    if (canonical.status === 'cancelled' || isTerminal(canonical.status)) {
      await this.scheduler.cancelSoyuzJob(job.id);
      return;
    }
    if (canonical.status === 'cancel_requested') {
      await this.scheduler.cancelSoyuzJob(job.id);
      return;
    }
    if (canonical.status === 'admitting') return;
    if (canonical.status === 'queued') {
      try {
        await this.api.claim(job.soyuz.externalRunId, claimCallbackId(job.soyuz.externalRunId, this.config.workerId, canonical.updatedAt), this.config.workerId);
        metricsRegistry.incSoyuzCounter('claim_success');
      } catch (error) {
        if (!(error instanceof SoyuzApiError) || error.status !== 409) throw error;
        metricsRegistry.incSoyuzCounter('claim_conflict');
        const latest = await this.api.getRun(job.soyuz.externalRunId);
        if (latest.status !== 'claimed' || latest.workerId !== this.config.workerId) return;
      }
    } else if (canonical.status !== 'claimed' && canonical.status !== 'running') {
      return;
    } else if (canonical.status === 'claimed' && canonical.workerId !== this.config.workerId) {
      return;
    }

    await this.api.started(
      job.soyuz.externalRunId,
      job.soyuz.startedCallbackId,
      this.config.workerId,
      new Date().toISOString(),
    );
    await this.scheduler.authorizeSoyuzStart(job.id);
    metricsRegistry.incSoyuzCounter('runs_started');
  }

  private async monitorActiveRun(job: Job, canonical: SoyuzWorkerRun): Promise<void> {
    if (!job.soyuz) return;
    const now = Date.now();
    const nextCheck = this.cancellationCheckAt.get(job.id) ?? 0;
    if (now >= nextCheck) {
      this.cancellationCheckAt.set(job.id, now + this.config.cancellationPollIntervalMs);
      if (canonical.status === 'cancel_requested' && !job.soyuz.cancellationRequestedAt) {
        await this.scheduler.cancelSoyuzJob(job.id);
        logger.event('soyuz_cancellation_observed', {
          runId: job.soyuz.externalRunId,
          localRunId: job.id,
          workerId: this.config.workerId,
        });
      }
    }

    if ((canonical.status === 'running' || canonical.status === 'cancel_requested')
      && (!job.soyuz.lastHeartbeatAt || now - Date.parse(job.soyuz.lastHeartbeatAt) >= this.config.heartbeatIntervalMs)) {
      const outbox = await this.scheduler.getSoyuzOutboxStatus();
      if (outbox.pending < MAX_NONTERMINAL_OUTBOX_PENDING) {
        const eventId = randomUUID();
        const timestamp = new Date(now).toISOString();
        await this.scheduler.enqueueSoyuzCallback(this.outboxEntry(job, eventId, 'event', {
          workerId: this.config.workerId,
          type: 'worker.heartbeat',
          timestamp,
          payload: { hostHealthy: true, executionActive: this.scheduler.isJobExecuting(job.id) },
        }));
        await this.scheduler.updateSoyuzJobMetadata(job.id, { lastHeartbeatAt: timestamp });
      }
    }

    const progress = this.scheduler.getLiveProgressEvents(job.id, 10);
    const latestStage = [...progress].reverse().find((event) => typeof event.stage === 'string')?.stage;
    if (typeof latestStage === 'string' && /^[\w .:/-]{1,120}$/.test(latestStage)
      && latestStage !== job.soyuz.lastReportedStage) {
      const outbox = await this.scheduler.getSoyuzOutboxStatus();
      if (outbox.pending < MAX_NONTERMINAL_OUTBOX_PENDING) {
        const timestamp = new Date().toISOString();
        await this.scheduler.enqueueSoyuzCallback(this.outboxEntry(job, randomUUID(), 'event', {
          workerId: this.config.workerId,
          type: 'stage.changed',
          stage: latestStage,
          timestamp,
          payload: { source: 'kaseki_progress' },
        }));
        await this.scheduler.updateSoyuzJobMetadata(job.id, { lastReportedStage: latestStage });
      }
    }
  }

  private async ensureTerminalCallback(job: Job): Promise<void> {
    if (!job.soyuz || job.soyuz.terminalCallbackDelivered || job.status === 'queued' || job.status === 'running') return;
    const callbackId = job.soyuz.terminalCallbackId ?? randomUUID();
    const completedAt = (job.completedAt ?? new Date()).toISOString();
    let eventType: SoyuzOutboxEntry['eventType'];
    let payload: Record<string, unknown>;
    if (job.failureClass === 'cancelled') {
      eventType = 'cancelled';
      payload = {
        callbackId,
        workerId: this.config.workerId,
        completedAt,
        exitCode: job.exitCode ?? 143,
        reason: 'Kaseki stopped execution after cancellation was applied.',
      };
    } else if (job.status === 'completed') {
      eventType = 'completed';
      payload = { callbackId, workerId: this.config.workerId, completedAt, exitCode: 0 };
    } else {
      eventType = 'failed';
      if (job.failureClass === 'api_restart') metricsRegistry.incSoyuzCounter('runs_failed');
      payload = {
        callbackId,
        workerId: this.config.workerId,
        completedAt,
        exitCode: job.exitCode ?? 1,
        failureClass: (job.failureClass || 'execution_failed').slice(0, 120),
        failureMessage: `Kaseki execution ended with failure class ${(job.failureClass || 'execution_failed').slice(0, 120)}. See Kaseki host artifacts for diagnostics.`,
      };
    }
    const entry = this.outboxEntry(job, callbackId, eventType, payload);
    await this.scheduler.persistSoyuzTerminalCallback(job, entry);
    logger.event('soyuz_terminal_callback_queued', {
      runId: job.soyuz.externalRunId,
      localRunId: job.id,
      eventType,
      callbackId,
    });
  }

  private async flushCallbackOutbox(): Promise<void> {
    const entries = await this.scheduler.claimSoyuzCallbacks();
    for (const entry of entries) {
      try {
        switch (entry.eventType) {
          case 'event': {
            const payload = entry.payload;
            const workerId = typeof payload.workerId === 'string' ? payload.workerId : this.config.workerId;
            const type = typeof payload.type === 'string' ? payload.type : 'progress.updated';
            const { workerId: _workerId, type: _type, ...data } = payload;
            await this.api.event(entry.externalRunId, entry.callbackId, workerId, type, data);
            break;
          }
          case 'completed':
            await this.api.completed(entry.externalRunId, entry.payload);
            metricsRegistry.incSoyuzCounter('runs_completed');
            break;
          case 'failed':
            await this.api.failed(entry.externalRunId, entry.payload);
            metricsRegistry.incSoyuzCounter('runs_failed');
            break;
          case 'cancelled':
            await this.api.cancelled(entry.externalRunId, entry.payload);
            break;
        }
        await this.scheduler.completeSoyuzCallback(entry.callbackId);
      } catch (error) {
        const retryMs = Math.min(15 * 60_000, 1_000 * (2 ** Math.min(entry.attemptCount, 10)));
        const jitteredRetryMs = Math.round(retryMs * (0.8 + Math.random() * 0.4));
        const errorText = error instanceof Error ? error.message : String(error);
        await this.scheduler.retrySoyuzCallback(
          entry.callbackId,
          new Date(Date.now() + jitteredRetryMs).toISOString(),
          errorText,
        );
        metricsRegistry.incSoyuzCounter('callbacks_retry');
        logger.error('Soyuz callback delivery failed; callback remains in the durable outbox', {
          runId: entry.externalRunId,
          callbackId: entry.callbackId,
          eventType: entry.eventType,
          attemptCount: entry.attemptCount,
          nextAttemptInMs: jitteredRetryMs,
          status: error instanceof SoyuzApiError ? error.status : undefined,
          code: error instanceof SoyuzApiError ? error.code : undefined,
          error: errorText,
        });
      }
    }
    const status = await this.scheduler.getSoyuzOutboxStatus();
    metricsRegistry.setSoyuzCallbacksPending(status.pending);
    if (status.pending >= 100 && Date.now() - this.lastOutboxBacklogWarningAt >= 60_000) {
      this.lastOutboxBacklogWarningAt = Date.now();
      logger.warn('Soyuz callback outbox backlog needs operator attention', {
        pendingCallbacks: status.pending,
        failedCallbacks: status.failures,
        oldestPendingAt: status.oldestPendingAt,
      });
    }
  }

  private outboxEntry(
    job: Job,
    callbackId: string,
    eventType: SoyuzOutboxEntry['eventType'],
    payload: Record<string, unknown>,
  ): SoyuzOutboxEntry {
    return {
      externalRunId: job.soyuz?.externalRunId ?? '',
      callbackId,
      eventType,
      payload,
      attemptCount: 0,
      nextAttemptAt: new Date().toISOString(),
      deliveryState: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  private async assertKasekiAdmission(run: SoyuzQueuedRun): Promise<RunRequest> {
    const readiness = this.scheduler.getReadiness();
    if (!readiness.ready) throw new Error(`Kaseki host is not ready: ${readiness.reasons.join(', ')}`);
    const request: RunRequest = { ...run.request };
    if (request.taskMode === 'inspect') {
      request.goalCheck = {
        ...request.goalCheck,
        enabled: request.goalCheck?.enabled ?? false,
      };
    }
    const publishMode = request.publishMode ?? 'pr';
    const compatibility = checkTemplatePublishModeCompatibility(publishMode);
    if (!compatibility.ok) throw new SoyuzAdmissionRejectedError('The configured Kaseki template does not support this publish mode.');
    if ((publishMode === 'branch' || publishMode === 'pr') && !checkGitHubAppCredentials().ok) {
      throw new SoyuzAdmissionRejectedError(`publishMode=${publishMode} requires configured GitHub App credentials.`);
    }
    const template = getSubmissionTemplateHealthStatus().status;
    if (!template.ok && !isTemplateDoctorTimeout(template)) {
      throw new SoyuzAdmissionRejectedError('The Kaseki template is not ready for execution.');
    }
    await this.validateTaskSafety(request);
    return request;
  }

  private async validateTaskSafety(request: RunRequest): Promise<void> {
    const admission = await this.taskAdmissionEvaluator(request as unknown as Record<string, unknown>);
    if (admission.status === 'rejected' || !admission.allowed) {
      throw new SoyuzAdmissionRejectedError('Kaseki task safety admission rejected this request.');
    }
    if (admission.degraded) {
      logger.event('soyuz_task_admission_degraded', {
        status: admission.status,
        warningCount: admission.warnings?.length ?? 0,
      });
    }
  }
}

function isTerminal(status: SoyuzWorkerRun['status']): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed' || status === 'admission_failed';
}

function claimCallbackId(runId: string, workerId: string, queuedAt: string): string {
  const bytes = createHash('sha1')
    .update(CLAIM_CALLBACK_NAMESPACE)
    .update(`soyuz-claim-v1:${runId}:${workerId}:${queuedAt}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  bytes[12] = '5';
  bytes[16] = ((Number.parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function isHttpError(error: unknown): error is { status: number; retryAfterSeconds?: number } {
  return Boolean(error && typeof error === 'object' && 'status' in error);
}
