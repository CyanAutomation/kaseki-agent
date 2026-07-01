/**
 * Functional TypeScript summarization coverage using direct module calls.
 *
 * This replaces the old root-level smoke script's TypeScript phase without
 * building dist/ or invoking the packaging CLI. The fixture mirrors a realistic
 * auth module and asserts extracted semantics instead of processed-file counts.
 */
import { describe, expect, it } from '@jest/globals';
import { TypeScriptCompilerSummarizer } from '../../src/summarization/typescript-compiler-summarizer';

const authModuleFixture = `
import { createHash } from 'crypto';
import type { Logger } from './logger';

export interface Token {
  value: string;
  expires: number;
}

export type RefreshResult = Token | null;

export class AuthManager {
  constructor(private secret: string, private logger?: Logger) {}

  validate(token: Token): boolean {
    this.logger?.debug('validating token');
    return Date.now() < token.expires;
  }

  refresh(token: Token): RefreshResult {
    if (!this.validate(token)) {
      return null;
    }

    return { ...token, expires: Date.now() + 3600000 };
  }
}

export function decode(jwt: string): Token {
  return { value: createHash('sha256').update(jwt).digest('hex'), expires: Date.now() };
}
`;

describe('TypeScript functional summarization', () => {
  it('extracts semantic navigation data from a fixed TypeScript fixture', () => {
    const summary = new TypeScriptCompilerSummarizer('typescript').summarize(authModuleFixture);

    expect(summary.parseError).toBeUndefined();
    expect(summary.language).toBe('typescript');
    expect(summary.imports).toEqual([
      { module: 'crypto', items: ['createHash'] },
      { module: './logger', items: ['Logger'] },
    ]);
    expect(summary.interfaces).toEqual([
      { name: 'Token', signature: 'interface Token', kind: 'interface' },
    ]);
    expect(summary.types).toEqual([
      { name: 'RefreshResult', signature: 'type RefreshResult', kind: 'type' },
    ]);
    expect(summary.classes).toEqual([
      {
        name: 'AuthManager',
        methods: [
          { name: 'validate', signature: expect.stringContaining('validate(token: Token): boolean'), kind: 'method' },
          { name: 'refresh', signature: expect.stringContaining('refresh(token: Token): RefreshResult'), kind: 'method' },
        ],
      },
    ]);
    expect(summary.functions).toEqual([
      { name: 'decode', signature: expect.stringContaining('function decode(jwt: string): Token'), kind: 'function' },
    ]);
    expect(summary.exports).toEqual([
      { name: 'Token', kind: 'interface' },
      { name: 'RefreshResult', kind: 'type' },
      { name: 'AuthManager', kind: 'class' },
      { name: 'decode', kind: 'function' },
    ]);
  });
});
