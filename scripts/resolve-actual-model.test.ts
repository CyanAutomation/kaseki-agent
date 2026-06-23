/**
 * Tests for scripts/resolve-actual-model.ts
 *
 * Coverage targets:
 * - Model extraction from event stream (JSONL)
 * - Model extraction from summary.json (selected_model, model, counters)
 * - Fallback chain: events → summary.selected_model → summary.model → counters → "unknown"
 * - Robustness: malformed JSON, missing files, empty files
 */

import { resolveActualModel, runCli } from './resolve-actual-model';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('resolve-actual-model', () => {

  describe('CLI contract', () => {
    it('fails with usage text when required arguments are missing', () => {
      const stderr: string[] = [];
      const stdout: string[] = [];

      const exitCode = runCli([], {
        stderr: message => stderr.push(message),
        stdout: message => stdout.push(message),
      });

      expect(exitCode).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join('\n')).toContain('Usage: resolve-actual-model.js <summaryPath> <eventsPath>');
    });
  });
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-model-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const writeSummary = (filename: string, data: Record<string, unknown>): string => {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data));
    return filePath;
  };

  const writeEvents = (filename: string, events: Array<Record<string, unknown>>): string => {
    const filePath = path.join(tmpDir, filename);
    const lines = events.map(e => JSON.stringify(e)).join('\n');
    fs.writeFileSync(filePath, lines);
    return filePath;
  };

  describe('Tier 1: Event Stream', () => {
    it('should extract model from first valid event in stream', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 'openrouter/free' },
        { type: 'step', model: 'ignored' },
      ]);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('openrouter/free');
    });

    it('should skip malformed events and find next valid one', () => {
      const eventsPath = path.join(tmpDir, 'events.jsonl');
      fs.writeFileSync(eventsPath, '{ invalid json\n' + JSON.stringify({ type: 'init', model: 'gpt-4-turbo' }));
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('gpt-4-turbo');
    });

    it('should ignore empty model strings in events', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: '' },
        { type: 'init', model: null },
        { type: 'step', model: 'claude-3-opus' },
      ]);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('claude-3-opus');
    });

    it('should filter out "unknown", "null", "undefined" strings', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 'unknown' },
        { type: 'init', model: 'null' },
        { type: 'init', model: 'undefined' },
        { type: 'step', model: 'actual-model' },
      ]);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('actual-model');
    });

    it('should handle case-insensitive filtering', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 'UNKNOWN' },
        { type: 'init', model: 'NULL' },
        { type: 'step', model: 'valid-model' },
      ]);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('valid-model');
    });

    it('should reject model strings with control characters', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 'bad\nmodel' },
        { type: 'init', model: 'good-model' },
      ]);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('good-model');
    });

    it('should trim whitespace from model strings', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: '  trimmed-model  ' },
      ]);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('trimmed-model');
    });
  });

  describe('Tier 2: Summary Metadata', () => {
    it('should extract selected_model from summary', () => {
      const summaryPath = writeSummary('summary.json', {
        selected_model: 'openrouter/auto',
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('openrouter/auto');
    });

    it('should prefer selected_model over model field', () => {
      const summaryPath = writeSummary('summary.json', {
        selected_model: 'preferred-model',
        model: 'ignored-model',
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('preferred-model');
    });

    it('should fallback to model field if selected_model missing', () => {
      const summaryPath = writeSummary('summary.json', {
        model: 'fallback-model',
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('fallback-model');
    });

    it('should extract model from counters if only 1 model counted', () => {
      const summaryPath = writeSummary('summary.json', {
        counters: {
          models: {
            'claude-3-sonnet': 15,
          },
        },
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('claude-3-sonnet');
    });

    it('should ignore counters if multiple models present (ambiguous)', () => {
      const summaryPath = writeSummary('summary.json', {
        counters: {
          models: {
            'model-a': 8,
            'model-b': 7,
          },
        },
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('unknown');
    });

    it('should ignore counters if no models with count > 0', () => {
      const summaryPath = writeSummary('summary.json', {
        counters: {
          models: {
            'model-a': 0,
          },
        },
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('unknown');
    });

    it('should filter "unknown" from selected_model', () => {
      const summaryPath = writeSummary('summary.json', {
        selected_model: 'unknown',
        model: 'fallback-model',
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('fallback-model');
    });
  });

  describe('Tier 3: Fallback', () => {
    it('should return "unknown" if all tiers fail', () => {
      const result = resolveActualModel({});
      expect(result).toBe('unknown');
    });

    it('should return "unknown" if paths do not exist', () => {
      const result = resolveActualModel({
        summaryPath: '/nonexistent/summary.json',
        eventsPath: '/nonexistent/events.jsonl',
      });
      expect(result).toBe('unknown');
    });

    it('should return "unknown" if summary JSON is malformed', () => {
      const summaryPath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(summaryPath, '{ invalid json }');
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('unknown');
    });

    it('should return "unknown" if events file is empty', () => {
      const eventsPath = path.join(tmpDir, 'empty.jsonl');
      fs.writeFileSync(eventsPath, '');
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('unknown');
    });
  });

  describe('Chain Integration', () => {
    it('should use event stream if available, ignoring summary', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 'event-model' },
      ]);
      const summaryPath = writeSummary('summary.json', {
        selected_model: 'summary-model',
      });
      const result = resolveActualModel({ eventsPath, summaryPath });
      expect(result).toBe('event-model');
    });

    it('should use summary if event stream has no valid model', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 'unknown' },
      ]);
      const summaryPath = writeSummary('summary.json', {
        selected_model: 'summary-model',
      });
      const result = resolveActualModel({ eventsPath, summaryPath });
      expect(result).toBe('summary-model');
    });

    it('should prefer event stream model over counter extraction', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 'event-model' },
      ]);
      const summaryPath = writeSummary('summary.json', {
        counters: {
          models: {
            'counter-model': 20,
          },
        },
      });
      const result = resolveActualModel({ eventsPath, summaryPath });
      expect(result).toBe('event-model');
    });
  });

  describe('Edge Cases', () => {
    it('should handle large event streams', () => {
      const largeEvents = Array.from({ length: 1000 }, (_, i) => ({
        type: 'event',
        model: i === 999 ? 'target-model' : undefined,
      }));
      const eventsPath = writeEvents('large.jsonl', largeEvents);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('target-model');
    });

    it('should handle numeric model values', () => {
      const eventsPath = writeEvents('events.jsonl', [
        { type: 'init', model: 12345 },
      ]);
      const result = resolveActualModel({ eventsPath });
      expect(result).toBe('12345');
    });

    it('should handle counters with non-numeric counts', () => {
      const summaryPath = writeSummary('summary.json', {
        counters: {
          models: {
            'model-a': 'invalid',
          },
        },
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('unknown');
    });

    it('should handle deeply nested summary structures', () => {
      const summaryPath = writeSummary('summary.json', {
        data: {
          nested: {
            field: 'ignored',
          },
        },
        selected_model: 'top-level-model',
      });
      const result = resolveActualModel({ summaryPath });
      expect(result).toBe('top-level-model');
    });
  });
});

