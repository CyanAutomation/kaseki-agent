/**
 * Authentication Manager - handles token lifecycle
 */
import { EventEmitter } from 'events';

export interface Token {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface Credentials {
  username: string;
  password: string;
}

export class AuthManager extends EventEmitter {
  private tokenCache: Map<string, Token> = new Map();
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly refreshThresholdMs = 5 * 60 * 1000; // 5 minutes

  constructor(private apiKey: string, private apiUrl: string) {
    super();
    this.initializeCache();
  }

  /**
   * Initialize cache with any stored tokens
   */
  private initializeCache(): void {
    // Load from storage
    this.emit('initialized');
  }

  /**
   * Authenticate with credentials and store token
   */
  async authenticate(credentials: Credentials): Promise<Token> {
    const response = await fetch(`${this.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText}`);
    }

    const token: Token = await response.json();
    this.tokenCache.set(credentials.username, token);
    this.scheduleRefresh(credentials.username);
    return token;
  }

  /**
   * Validate if token is still valid
   */
  private validateToken(token: Token): boolean {
    return Date.now() < token.expires_at;
  }

  /**
   * Refresh token before expiry
   */
  private async refreshToken(username: string): Promise<Token> {
    const cachedToken = this.tokenCache.get(username);
    if (!cachedToken) {
      throw new Error(`No cached token for user ${username}`);
    }

    const response = await fetch(`${this.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey },
      body: JSON.stringify({ refresh_token: cachedToken.refresh_token }),
    });

    if (!response.ok) {
      this.tokenCache.delete(username);
      throw new Error('Token refresh failed');
    }

    const newToken: Token = await response.json();
    this.tokenCache.set(username, newToken);
    this.scheduleRefresh(username);
    return newToken;
  }

  /**
   * Schedule token refresh
   */
  private scheduleRefresh(username: string): void {
    const token = this.tokenCache.get(username);
    if (!token) return;

    const timeUntilRefresh = token.expires_at - Date.now() - this.refreshThresholdMs;
    if (timeUntilRefresh > 0) {
      if (this.refreshInterval) clearTimeout(this.refreshInterval);
      this.refreshInterval = setTimeout(() => this.refreshToken(username), timeUntilRefresh);
    }
  }

  /**
   * Get cached token if valid
   */
  getToken(username: string): Token | null {
    const token = this.tokenCache.get(username);
    if (!token || !this.validateToken(token)) {
      return null;
    }
    return token;
  }

  /**
   * Clear all cached tokens
   */
  clearCache(): void {
    this.tokenCache.clear();
    if (this.refreshInterval) clearTimeout(this.refreshInterval);
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    this.clearCache();
    this.removeAllListeners();
  }
}
