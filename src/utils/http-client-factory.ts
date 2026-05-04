/**
 * HTTP client factory for creating API requests with retry logic.
 * Consolidates HTTP fetch + error handling patterns across kaseki-api-client.ts.
 */

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

/**
 * Default retry configuration for HTTP requests.
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 8000,
};

/**
 * Creates an HTTP request factory with retry logic.
 */
export class HttpClientFactory {
  private retryConfig: RetryConfig;

  constructor(retryConfig: Partial<RetryConfig> = {}) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Create and execute an HTTP request with automatic retry on failure.
   */
  async request<T>(
    url: string,
    options: HttpRequestOptions,
    parser: (data: unknown) => T,
    description: string = 'HTTP request'
  ): Promise<T> {
    return this.retryWithBackoff(async () => {
      const response = await fetch(url, options);

      if (!response.ok) {
        let errorDetail: string | undefined;
        try {
          const errorData: unknown = await response.json();
          errorDetail = this.parseErrorDetail(errorData);
        } catch {
          // Ignore non-JSON error payloads
        }
        throw new Error(`${description} failed: ${errorDetail ?? response.statusText}`);
      }

      const data: unknown = await response.json();
      return parser(data);
    }, description);
  }

  /**
   * Create and execute an HTTP request that returns text content.
   */
  async requestText(url: string, options: HttpRequestOptions, description: string = 'HTTP request'): Promise<string> {
    return this.retryWithBackoff(async () => {
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`${description} failed: ${response.status}`);
      }

      return response.text();
    }, description);
  }

  /**
   * Create and execute an HTTP request that returns binary data.
   */
  async requestBlob(url: string, options: HttpRequestOptions, description: string = 'HTTP request'): Promise<Blob> {
    return this.retryWithBackoff(async () => {
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`${description} failed: ${response.status}`);
      }

      return response.blob();
    }, description);
  }

  /**
   * Execute a function with exponential backoff retry.
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    description: string = 'Operation'
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx errors (except 429 Too Many Requests)
        const is4xxError =
          lastError.message.includes('400') ||
          lastError.message.includes('401') ||
          lastError.message.includes('403') ||
          lastError.message.includes('404');

        if (is4xxError && !lastError.message.includes('429')) {
          throw lastError;
        }

        // If this is the last attempt, throw
        if (attempt === this.retryConfig.maxAttempts - 1) {
          throw lastError;
        }

        // Calculate backoff with exponential increase
        const delayMs = Math.min(
          this.retryConfig.initialDelayMs * Math.pow(2, attempt),
          this.retryConfig.maxDelayMs
        );

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error(`${description} failed after ${this.retryConfig.maxAttempts} attempts`);
  }

  /**
   * Parse error detail from a response body.
   */
  private parseErrorDetail(value: unknown): string | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const detail = value.detail;
    return typeof detail === 'string' ? detail : undefined;
  }

  /**
   * Type guard for checking if a value is an object/record.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
