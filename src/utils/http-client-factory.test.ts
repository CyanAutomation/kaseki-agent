import { HttpClientFactory, RetryConfig } from './http-client-factory';

describe('http-client-factory', () => {
  describe('HttpClientFactory', () => {
    it('should initialize with default retry config', () => {
      const factory = new HttpClientFactory();
      expect(factory).toBeDefined();
    });

    it('should initialize with custom retry config', () => {
      const customConfig: Partial<RetryConfig> = {
        maxAttempts: 5,
        initialDelayMs: 500,
        maxDelayMs: 5000,
      };
      const factory = new HttpClientFactory(customConfig);
      expect(factory).toBeDefined();
    });

    it('should have request method', () => {
      const factory = new HttpClientFactory();
      expect(factory.request).toBeDefined();
      expect(typeof factory.request).toBe('function');
    });

    it('should have requestText method', () => {
      const factory = new HttpClientFactory();
      expect(factory.requestText).toBeDefined();
      expect(typeof factory.requestText).toBe('function');
    });

    it('should have requestBlob method', () => {
      const factory = new HttpClientFactory();
      expect(factory.requestBlob).toBeDefined();
      expect(typeof factory.requestBlob).toBe('function');
    });

    // Integration test example (can be expanded with proper fetch mocking)
    it('should handle successful requests with proper parsing', async () => {
      const factory = new HttpClientFactory();

      // This is a placeholder test - real integration tests would need proper fetch mocking
      expect(factory).toBeDefined();
    });
  });
});
