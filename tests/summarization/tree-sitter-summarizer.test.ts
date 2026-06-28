/**
 * Tests for TreeSitterSummarizer
 *
 * Summarizer contract: preserve navigational symbols (imports, exports,
 * classes, functions, methods, types, and interfaces) while reducing content
 * size enough that callers can decide when to request full source.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

import { TreeSitterSummarizer } from '../../src/summarization/tree-sitter-summarizer';
import type { CodeSummary } from '../../src/summarization/tree-sitter-summarizer';
import type { SupportedLanguage } from '../../src/summarization/summarizer-config';

type FixtureCase = {
  name: string;
  file: string;
  language: SupportedLanguage;
  expected: {
    imports: CodeSummary['imports'];
    exports: CodeSummary['exports'];
    classes: CodeSummary['classes'];
    functions: CodeSummary['functions'];
    types: CodeSummary['types'];
    interfaces: CodeSummary['interfaces'];
  };
};

const EMPTY_SYMBOLS = {
  imports: [],
  exports: [],
  classes: [],
  functions: [],
  types: [],
  interfaces: [],
};

const GO_GRAMMAR_UNAVAILABLE =
  /^(tree-sitter-cli not available \(ENOENT\)|tree-sitter-cli failed: .*?(language|langauge|grammar|parser|not found|not configured|No language found|Failed to load|Could not load)|tree-sitter-cli error: .*?(ENOENT|timed out|spawn|language|grammar|parser))/is;

describe('TreeSitterSummarizer', () => {
  let fixturesDir: string;

  beforeEach(() => {
    fixturesDir = path.join(__dirname, '../fixtures/summarization');
  });

  const readFixture = (file: string): string => fs.readFileSync(path.join(fixturesDir, file), 'utf-8');

  const summarizeFixture = (file: string, language: SupportedLanguage): CodeSummary =>
    new TreeSitterSummarizer(language).summarize(readFixture(file));

  describe('fixture symbol extraction', () => {
    const fixtureCases: FixtureCase[] = [
      {
        name: 'small-file.ts preserves exported function navigation without implementation bodies',
        file: 'small-file.ts',
        language: 'typescript',
        expected: {
          ...EMPTY_SYMBOLS,
          exports: [
            { name: 'add', kind: 'function' },
            { name: 'subtract', kind: 'function' },
          ],
          functions: [
            { name: 'add', signature: 'export function add(a: number, b: number): number {', kind: 'function' },
            {
              name: 'subtract',
              signature: 'export function subtract(a: number, b: number): number {',
              kind: 'function',
            },
          ],
        },
      },
      {
        name: 'medium-file.ts preserves AuthManager API surface while dropping method bodies',
        file: 'medium-file.ts',
        language: 'typescript',
        expected: {
          ...EMPTY_SYMBOLS,
          imports: [{ module: 'events', items: ['EventEmitter'] }],
          exports: [
            { name: 'Token', kind: 'interface' },
            { name: 'Credentials', kind: 'interface' },
            { name: 'AuthManager', kind: 'class' },
          ],
          classes: [
            {
              name: 'AuthManager',
              methods: [
                { name: 'initializeCache', signature: 'private initializeCache(): void {', kind: 'method' },
                {
                  name: 'authenticate',
                  signature: 'async authenticate(credentials: Credentials): Promise<Token> {',
                  kind: 'method',
                },
                { name: 'validateToken', signature: 'private validateToken(token: Token): boolean {', kind: 'method' },
                {
                  name: 'refreshToken',
                  signature: 'private async refreshToken(username: string): Promise<Token> {',
                  kind: 'method',
                },
                { name: 'scheduleRefresh', signature: 'private scheduleRefresh(username: string): void {', kind: 'method' },
                { name: 'getToken', signature: 'getToken(username: string): Token | null {', kind: 'method' },
                { name: 'clearCache', signature: 'clearCache(): void {', kind: 'method' },
                { name: 'destroy', signature: 'destroy(): void {', kind: 'method' },
              ],
            },
          ],
          interfaces: [
            { name: 'Token', signature: 'interface Token', kind: 'interface' },
            { name: 'Credentials', signature: 'interface Credentials', kind: 'interface' },
          ],
        },
      },
      {
        name: 'large-file.ts preserves broad navigation symbols while reducing a larger implementation',
        file: 'large-file.ts',
        language: 'typescript',
        expected: {
          ...EMPTY_SYMBOLS,
          imports: [
            { module: 'events', items: ['EventEmitter'] },
            { module: 'crypto', items: ['crypto'] },
          ],
          exports: [
            { name: 'User', kind: 'interface' },
            { name: 'Session', kind: 'interface' },
            { name: 'AuditLog', kind: 'interface' },
            { name: 'UserManager', kind: 'class' },
          ],
          classes: [
            {
              name: 'UserManager',
              methods: [
                {
                  name: 'createUser',
                  signature: 'async createUser(email: string, name: string, role: User["role"] = "user"): Promise<User> {',
                  kind: 'method',
                },
                { name: 'isValidEmail', signature: 'private isValidEmail(email: string): boolean {', kind: 'method' },
                { name: 'userExists', signature: 'private userExists(email: string): boolean {', kind: 'method' },
                { name: 'generateUserId', signature: 'private generateUserId(): string {', kind: 'method' },
                { name: 'getUser', signature: 'async getUser(userId: string): Promise<User | null> {', kind: 'method' },
                {
                  name: 'getUserByEmail',
                  signature: 'async getUserByEmail(email: string): Promise<User | null> {',
                  kind: 'method',
                },
                {
                  name: 'updateUser',
                  signature: 'async updateUser(userId: string, updates: Partial<User>): Promise<User> {',
                  kind: 'method',
                },
                { name: 'deleteUser', signature: 'async deleteUser(userId: string): Promise<void> {', kind: 'method' },
                {
                  name: 'createSession',
                  signature: 'async createSession(userId: string, ipAddress: string): Promise<string> {',
                  kind: 'method',
                },
                {
                  name: 'validateSession',
                  signature: 'async validateSession(token: string): Promise<boolean> {',
                  kind: 'method',
                },
                { name: 'generateToken', signature: 'private generateToken(): string {', kind: 'method' },
                { name: 'revokeSession', signature: 'async revokeSession(token: string): Promise<void> {', kind: 'method' },
                {
                  name: 'logAudit',
                  signature:
                    'private logAudit(action: string, resource: string, resourceId: string, details: Record<string, any>): void {',
                  kind: 'method',
                },
                {
                  name: 'getAuditLogs',
                  signature: 'async getAuditLogs(userId: string, limit: number = 100): Promise<AuditLog[]> {',
                  kind: 'method',
                },
                {
                  name: 'cleanupExpiredSessions',
                  signature: 'private async cleanupExpiredSessions(): Promise<void> {',
                  kind: 'method',
                },
                { name: 'startCleanup', signature: 'startCleanup(): void {', kind: 'method' },
                {
                  name: 'exportUserData',
                  signature: 'async exportUserData(userId: string): Promise<Record<string, any>> {',
                  kind: 'method',
                },
                { name: 'shutdown', signature: 'async shutdown(): Promise<void> {', kind: 'method' },
              ],
            },
          ],
          interfaces: [
            { name: 'User', signature: 'interface User', kind: 'interface' },
            { name: 'Session', signature: 'interface Session', kind: 'interface' },
            { name: 'AuditLog', signature: 'interface AuditLog', kind: 'interface' },
          ],
        },
      },
    ];

    it.each(fixtureCases)('$name', ({ file, language, expected }) => {
      const summary = summarizeFixture(file, language);
      expect(summary.parseError).toBeUndefined();
      expect({
        imports: summary.imports,
        exports: summary.exports,
        classes: summary.classes,
        functions: summary.functions,
        types: summary.types,
        interfaces: summary.interfaces,
      }).toEqual(expected);
      expect(summary.language).toBe(language);
      expect(summary.originalSizeBytes).toBe(Buffer.byteLength(readFixture(file), 'utf-8'));
      expect(summary.summaryTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Go fixture contract', () => {
    it('handler.go preserves handler navigation when grammar is available, otherwise reports a specific parse error', () => {
      const summary = summarizeFixture('handler.go', 'go');

      if (summary.parseError) {
        expect(summary.parseError).toMatch(GO_GRAMMAR_UNAVAILABLE);
        expect({
          imports: summary.imports,
          exports: summary.exports,
          classes: summary.classes,
          functions: summary.functions,
          types: summary.types,
          interfaces: summary.interfaces,
        }).toEqual(EMPTY_SYMBOLS);
        return;
      }

      expect(summary.functions.map(f => f.name)).toEqual([
        'NewUserHandler',
        'generateID',
        'extractUserID',
        'parseJSON',
        'respondJSON',
        'applyUpdates',
      ]);
      expect(summary.classes).toEqual([
        { name: 'User', methods: [] },
        { name: 'UserHandler', methods: ['CreateUser', 'GetUser', 'UpdateUser', 'DeleteUser'].map(name => expect.objectContaining({ name })) },
      ]);
      expect(summary.types.map(t => t.name)).toEqual(['User', 'UserStore', 'UserHandler']);
      expect(summary.interfaces).toEqual([]);
    });
  });

  describe('parse-error and empty-content behavior', () => {
    it.each([
      ['unsupported.py', 'python' as SupportedLanguage, 'Unsupported language: python'],
      ['data.xml', 'xml' as SupportedLanguage, 'Unsupported language: xml'],
    ])('%s reports an unsupported-language parse error instead of inventing symbols', (file, language, parseError) => {
      const summary = summarizeFixture(file, language);
      expect(summary.parseError).toBe(parseError);
      expect({
        imports: summary.imports,
        exports: summary.exports,
        classes: summary.classes,
        functions: summary.functions,
        types: summary.types,
        interfaces: summary.interfaces,
      }).toEqual(EMPTY_SYMBOLS);
    });

    it('recovers navigational symbols from incomplete TypeScript while reporting no compiler parse failure', () => {
      const invalidCode = `
        class RecoveredClass {
          method(): void {}
        }

        function recoveredFunction(): number {
          return 1;
        }

        const broken = {
      `;

      const summary = new TreeSitterSummarizer('typescript').summarize(invalidCode);
      expect(summary.parseError).toBeUndefined();
      expect(summary).toMatchObject({
        classes: [{ name: 'RecoveredClass', methods: [{ name: 'method', signature: 'method(): void {', kind: 'method' }] }],
        functions: [{ name: 'recoveredFunction', signature: 'function recoveredFunction(): number {', kind: 'function' }],
        imports: [],
        exports: [],
        types: [],
        interfaces: [],
      });
    });

    it.each([
      ['empty files', ''],
      [
        'comment-only files',
        `
        // This is a comment
        /* Multi-line comment
           describing nothing */
        // Another comment
      `,
      ],
    ])('%s preserve the empty-symbol contract', (_name, content) => {
      const summary = new TreeSitterSummarizer('typescript').summarize(content);
      expect({
        imports: summary.imports,
        exports: summary.exports,
        classes: summary.classes,
        functions: summary.functions,
        types: summary.types,
        interfaces: summary.interfaces,
      }).toEqual(EMPTY_SYMBOLS);
    });
  });

  describe('metadata and performance contract', () => {
    it('records source size and summary timing for callers deciding whether to request full content', () => {
      const content = readFixture('large-file.ts');
      const summary = new TreeSitterSummarizer('typescript').summarize(content);
      expect(summary.originalSizeBytes).toBe(Buffer.byteLength(content, 'utf-8'));
      expect(summary.summaryTimeMs).toBeGreaterThanOrEqual(0);
      expect(summary.language).toBe('typescript');
    });

    it.each([
      ['large-file.ts', 1000],
      ['small-file.ts', 100],
    ])('%s parses fast enough to reduce content size on the navigation path', (file, maxMs) => {
      const start = performance.now();
      summarizeFixture(file, 'typescript');
      expect(performance.now() - start).toBeLessThan(maxMs);
    });
  });
});
