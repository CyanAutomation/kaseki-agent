import { metricsRegistry } from './metrics';

describe('API Prometheus metrics', () => {
  it('exposes Soyuz callback and reconciliation backlog gauges', () => {
    metricsRegistry.setSoyuzCallbacksBlocked(2);
    metricsRegistry.setSoyuzTrackedRuns(7);

    const metrics = metricsRegistry.renderPrometheus();
    expect(metrics).toContain('soyuz_callbacks_blocked 2');
    expect(metrics).toContain('soyuz_tracked_runs 7');
  });

  it('exposes the age of the oldest undelivered Soyuz callback and resets when drained', () => {
    const now = Date.parse('2026-11-18T12:00:00.000Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      metricsRegistry.setSoyuzCallbacksOldestPendingAt(new Date(now - 180_000).toISOString());
      expect(metricsRegistry.renderPrometheus()).toContain('soyuz_callbacks_oldest_pending_seconds 180');

      clock.mockReturnValue(now + 60_000);
      expect(metricsRegistry.renderPrometheus()).toContain('soyuz_callbacks_oldest_pending_seconds 240');

      metricsRegistry.setSoyuzCallbacksOldestPendingAt(undefined);
      expect(metricsRegistry.renderPrometheus()).toContain('soyuz_callbacks_oldest_pending_seconds 0');
    } finally {
      clock.mockRestore();
    }
  });

  it('exposes route-template request counts and valid duration summary samples', () => {
    metricsRegistry.observeHttpRequest('GET', '/runs/{id}', 404, 0.025);
    const metrics = metricsRegistry.renderPrometheus();

    expect(metrics).toContain('# TYPE kaseki_api_requests_total counter');
    expect(metrics).toContain('kaseki_api_requests_total{method="GET",route="/runs/{id}",status_class="4xx"}');
    expect(metrics).toContain('# TYPE kaseki_api_request_duration_seconds summary');
    expect(metrics).toContain('kaseki_api_request_duration_seconds_sum{method="GET",route="/runs/{id}"}');
    expect(metrics).toContain('kaseki_api_request_duration_seconds_count{method="GET",route="/runs/{id}"}');
  });
});
