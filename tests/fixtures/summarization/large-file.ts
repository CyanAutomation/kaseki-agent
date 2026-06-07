/**
 * Large complex file - tests summarization benefits
 * Imagine this is a real codebase file with many methods
 */
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'guest';
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  userId: string;
  token: string;
  expiresAt: number;
  ipAddress: string;
}

export interface AuditLog {
  userId: string;
  action: string;
  resource: string;
  timestamp: number;
  details: Record<string, any>;
}

export class UserManager extends EventEmitter {
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();
  private auditLogs: AuditLog[] = [];
  private readonly sessionTTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private dbConnection: any, private logger: any) {
    super();
  }

  /**
   * Create new user
   */
  async createUser(email: string, name: string, role: User['role'] = 'user'): Promise<User> {
    // Validate email format
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Check if user exists
    if (this.userExists(email)) {
      throw new Error('User already exists');
    }

    const user: User = {
      id: this.generateUserId(),
      email,
      name,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(user.id, user);
    await this.dbConnection.users.insert(user);
    this.logAudit('CREATE', 'user', user.id, { email, role });
    this.emit('user:created', user);
    return user;
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Check if user exists
   */
  private userExists(email: string): boolean {
    return Array.from(this.users.values()).some(u => u.email === email);
  }

  /**
   * Generate unique user ID
   */
  private generateUserId(): string {
    return `user_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) || null;
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  /**
   * Update user profile
   */
  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    const updated = { ...user, ...updates, updatedAt: new Date() };
    this.users.set(userId, updated);
    await this.dbConnection.users.update(userId, updated);
    this.logAudit('UPDATE', 'user', userId, updates);
    this.emit('user:updated', updated);
    return updated;
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    this.users.delete(userId);
    await this.dbConnection.users.delete(userId);

    // Revoke all sessions
    this.sessions.forEach((session, token) => {
      if (session.userId === userId) {
        this.sessions.delete(token);
      }
    });

    this.logAudit('DELETE', 'user', userId, {});
    this.emit('user:deleted', userId);
  }

  /**
   * Create session
   */
  async createSession(userId: string, ipAddress: string): Promise<string> {
    const user = await this.getUser(userId);
    if (!user) throw new Error('User not found');

    const token = this.generateToken();
    const session: Session = {
      userId,
      token,
      expiresAt: Date.now() + this.sessionTTL,
      ipAddress,
    };

    this.sessions.set(token, session);
    await this.dbConnection.sessions.insert(session);
    this.logAudit('LOGIN', 'session', userId, { ipAddress });
    this.emit('session:created', token);
    return token;
  }

  /**
   * Validate session
   */
  async validateSession(token: string): Promise<boolean> {
    const session = this.sessions.get(token);
    if (!session) return false;

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Generate session token
   */
  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Revoke session
   */
  async revokeSession(token: string): Promise<void> {
    const session = this.sessions.get(token);
    if (!session) throw new Error('Session not found');

    this.sessions.delete(token);
    await this.dbConnection.sessions.delete(token);
    this.logAudit('LOGOUT', 'session', session.userId, {});
    this.emit('session:revoked', token);
  }

  /**
   * Log audit event
   */
  private logAudit(action: string, resource: string, resourceId: string, details: Record<string, any>): void {
    const log: AuditLog = {
      userId: resourceId,
      action,
      resource,
      timestamp: Date.now(),
      details,
    };

    this.auditLogs.push(log);
    this.logger.info(`Audit: ${action} ${resource} ${resourceId}`, details);
  }

  /**
   * Get audit logs for user
   */
  async getAuditLogs(userId: string, limit: number = 100): Promise<AuditLog[]> {
    return this.auditLogs
      .filter(log => log.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Cleanup expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    const expiredTokens: string[] = [];

    this.sessions.forEach((session, token) => {
      if (session.expiresAt < now) {
        expiredTokens.push(token);
      }
    });

    for (const token of expiredTokens) {
      this.sessions.delete(token);
      await this.dbConnection.sessions.delete(token);
    }

    if (expiredTokens.length > 0) {
      this.logger.debug(`Cleaned up ${expiredTokens.length} expired sessions`);
    }
  }

  /**
   * Start cleanup interval
   */
  startCleanup(): void {
    setInterval(() => this.cleanupExpiredSessions(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Export user data
   */
  async exportUserData(userId: string): Promise<Record<string, any>> {
    const user = await this.getUser(userId);
    if (!user) throw new Error('User not found');

    const logs = await this.getAuditLogs(userId);
    const sessions = Array.from(this.sessions.values()).filter(s => s.userId === userId);

    return { user, logs, sessions };
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    this.users.clear();
    this.sessions.clear();
    this.auditLogs = [];
    this.removeAllListeners();
  }
}
