class MetricsRegistry {
  private queuePending = 0;
  private runningJobs = 0;
  private runsTotal = { success: 0, failure: 0 };
  private timeoutsTotal = 0;
  private admissionRejections = new Map<string, number>();
  private readonly durationBuckets = [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800];
  private durationBucketCounts: number[] = this.durationBuckets.map(() => 0);
  private durationSum = 0;
  private durationCount = 0;

  setQueuePending(count: number): void { this.queuePending = Math.max(0, count); }
  setRunningJobs(count: number): void { this.runningJobs = Math.max(0, count); }
  incRunSuccess(): void { this.runsTotal.success += 1; }
  incRunFailure(): void { this.runsTotal.failure += 1; }
  incTimeout(): void { this.timeoutsTotal += 1; }
  incAdmissionRejection(reason: string): void {
    const normalized = reason.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
    this.admissionRejections.set(normalized, (this.admissionRejections.get(normalized) || 0) + 1);
  }

  observeRunDuration(seconds: number): void {
    const value = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    this.durationSum += value;
    this.durationCount += 1;
    for (let i = 0; i < this.durationBuckets.length; i += 1) {
      if (value <= this.durationBuckets[i]) {
        for (let j = i; j < this.durationBuckets.length; j += 1) {
          this.durationBucketCounts[j] += 1;
        }
        break;
      }
    }
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    lines.push('# HELP kaseki_queue_pending Number of queued jobs awaiting execution.');
    lines.push('# TYPE kaseki_queue_pending gauge');
    lines.push(`kaseki_queue_pending ${this.queuePending}`);
    lines.push('# HELP kaseki_running_jobs Number of jobs currently running.');
    lines.push('# TYPE kaseki_running_jobs gauge');
    lines.push(`kaseki_running_jobs ${this.runningJobs}`);

    lines.push('# HELP kaseki_runs_total Total number of completed runs partitioned by outcome.');
    lines.push('# TYPE kaseki_runs_total counter');
    lines.push(`kaseki_runs_total{result="success"} ${this.runsTotal.success}`);
    lines.push(`kaseki_runs_total{result="failure"} ${this.runsTotal.failure}`);

    lines.push('# HELP kaseki_run_duration_seconds Runtime duration of completed jobs in seconds.');
    lines.push('# TYPE kaseki_run_duration_seconds histogram');
    this.durationBuckets.forEach((bucket, idx) => {
      lines.push(`kaseki_run_duration_seconds_bucket{le="${bucket}"} ${this.durationBucketCounts[idx]}`);
    });
    lines.push(`kaseki_run_duration_seconds_bucket{le="+Inf"} ${this.durationCount}`);
    lines.push(`kaseki_run_duration_seconds_sum ${this.durationSum}`);
    lines.push(`kaseki_run_duration_seconds_count ${this.durationCount}`);

    lines.push('# HELP kaseki_timeouts_total Total number of timed out runs.');
    lines.push('# TYPE kaseki_timeouts_total counter');
    lines.push(`kaseki_timeouts_total ${this.timeoutsTotal}`);
    lines.push('# HELP kaseki_timeout_rate Ratio of timed out runs to all completed runs.');
    lines.push('# TYPE kaseki_timeout_rate gauge');
    const totalRuns = this.runsTotal.success + this.runsTotal.failure;
    lines.push(`kaseki_timeout_rate ${totalRuns > 0 ? this.timeoutsTotal / totalRuns : 0}`);

    lines.push('# HELP kaseki_admission_rejections_total Total number of run submissions rejected before scheduler admission.');
    lines.push('# TYPE kaseki_admission_rejections_total counter');
    const rejectionEntries = Array.from(this.admissionRejections.entries()).sort(([left], [right]) => left.localeCompare(right));
    if (rejectionEntries.length === 0) {
      lines.push('kaseki_admission_rejections_total{reason="none"} 0');
    } else {
      rejectionEntries.forEach(([reason, count]) => {
        lines.push(`kaseki_admission_rejections_total{reason="${reason}"} ${count}`);
      });
    }

    return `${lines.join('\n')}\n`;
  }
}

export const metricsRegistry = new MetricsRegistry();
