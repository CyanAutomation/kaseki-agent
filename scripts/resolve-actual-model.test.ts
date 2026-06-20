/**
 * Tests for scripts/resolve-actual-model.js
 * 
 * Tests invoke the script via subprocess to properly handle ESM + import.meta patterns
 * Coverage targets:
 * - Model extraction from event stream (JSONL)
 * - Model extraction from summary.json (selected_model, model, counters)
 * - Fallback chain: events → summary.selected_model → summary.model → counters → "unknown"
 * - Robustness: malformed JSON, missing files, empty files
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/resolve-actual-model.js');
const RESULTS_DIR = path.resolve(process.cwd(), 'test-resolve-model-tmp');

// Helper to run the resolve-actual-model script as subprocess
function runScript(summaryPath: string, eventsPath: string = ''): string {
  try {
    const output = execSync(
      `node "${SCRIPT_PATH}" "${summaryPath}" "${eventsPath}"`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return output.trim();
  } catch (error: any) {
    return error.stdout?.trim() || '';
  }
}

describe('resolve-actual-model', () => {
  beforeEach(() => {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(RESULTS_DIR)) {
      fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
    }
  });

  describe('happy path', () => {
    it('should extract model from pi-events.jsonl', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const eventsContent =
        '{"type":"tool_call","model":"openrouter/anthropic/claude-opus-4-1"}\n' +
        '{"type":"tool_result","text":"done"}\n';
      fs.writeFileSync(eventsPath, eventsContent);

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('openrouter/anthropic/claude-opus-4-1');
    });

    it('should extract model from first event in stream', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const eventsContent =
        '{"type":"start","model":"model1"}\n' +
        '{"type":"intermediate","model":"model2"}\n' +
        '{"type":"end","model":"model3"}\n';
      fs.writeFileSync(eventsPath, eventsContent);

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('model1');
    });
  });

  describe('fallback 1: summary.selected_model', () => {
    it('should fallback to summary.selected_model when events absent', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        selected_model: 'openrouter/google/gemini-2.0-flash',
        model: 'fallback-model',
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('openrouter/google/gemini-2.0-flash');
    });

    it('should prefer selected_model over model field', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        selected_model: 'preferred-model',
        model: 'less-preferred-model',
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('preferred-model');
    });
  });

  describe('fallback 2: summary.model', () => {
    it('should fallback to summary.model when selected_model absent', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        model: 'openrouter/cohere/command-r',
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('openrouter/cohere/command-r');
    });
  });

  describe('fallback 3: summary.counters.models deduplication', () => {
    it('should extract from counters.models object', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        counters: {
          models: {
            'model-a': 5,
            'model-b': 3,
            'model-c': 1,
          },
        },
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      // Should return unknown because multiple models exist (ambiguous)
      expect(result).toBe('unknown');
    });

    it('should handle single model in counters.models', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        counters: {
          models: {
            'openrouter/only-model': 1,
          },
        },
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('openrouter/only-model');
    });

    it('should reject array-format counters.models', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        counters: {
          models: ['openrouter/model1', 'openrouter/model2'],
        },
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('unknown');
    });
  });

  describe('fallback chain', () => {
    it('should follow chain: events → selected_model → model → counters → unknown', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        counters: {
          models: {
            'fallback-model': 1,
          },
        },
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('fallback-model');
    });

    it('should return "unknown" when no model data available', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {};
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace in model names', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = {
        selected_model: '  openrouter/model-with-spaces  ',
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('openrouter/model-with-spaces');
    });

    it('should skip malformed JSON lines and use valid ones', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const eventsContent = 'not valid json\n{"model":"from-events"}\n';
      fs.writeFileSync(eventsPath, eventsContent);

      const summaryContent = { selected_model: 'from-summary' };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      // Should extract from events since valid JSON exists there
      expect(result).toBe('from-events');
    });

    it('should handle very long model names', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const longName = 'openrouter/' + 'a'.repeat(500);
      const summaryContent = { selected_model: longName };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe(longName);
    });

    it('should handle special characters in model name', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const specialName = 'model/with-special_chars.v2:updated@2024';
      const summaryContent = { selected_model: specialName };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe(specialName);
    });

    it('should handle empty event stream', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      fs.writeFileSync(eventsPath, '');

      const summaryContent = { selected_model: 'fallback-model' };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('fallback-model');
    });

    it('should handle missing events but present summary', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const summaryContent = { model: 'summary-only-model' };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('summary-only-model');
    });

    it('should prioritize events over summary', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      const eventsContent = '{"type":"start","model":"from-events"}\n';
      fs.writeFileSync(eventsPath, eventsContent);

      const summaryContent = { selected_model: 'from-summary' };
      fs.writeFileSync(summaryPath, JSON.stringify(summaryContent, null, 2));

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('from-events');
    });
  });

  describe('default case', () => {
    it('should return "unknown" when no files provided', () => {
      const eventsPath = path.join(RESULTS_DIR, 'nonexistent-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'nonexistent-summary.json');

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('unknown');
    });

    it('should return "unknown" when directory is empty', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      // Don't create any files - both paths are non-existent

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('unknown');
    });

    it('should return "unknown" when summary.json is malformed', () => {
      const eventsPath = path.join(RESULTS_DIR, 'pi-events.jsonl');
      const summaryPath = path.join(RESULTS_DIR, 'pi-summary.json');
      fs.writeFileSync(summaryPath, 'not valid json at all');

      const result = runScript(summaryPath, eventsPath);
      expect(result).toBe('unknown');
    });
  });
});
