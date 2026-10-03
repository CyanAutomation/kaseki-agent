import { metricsRegistry } from './metrics';

describe('API Prometheus metrics', () => {
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
