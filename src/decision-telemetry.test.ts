import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendDecisionTelemetry, summarizeDecisionConfidence } from './decision-telemetry';

describe('decision telemetry', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-decisions-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  it('records bounded decision metadata without storing evaluated state', () => {
    appendDecisionTelemetry(resultsDir, {
      stage: 'goal_check',
      status: 'completed',
      provider: 'jev',
      model: 'typesafe/model',
      outcome: 'met',
      confidence: 0.91,
      durationMs: 42.4,
      attemptCount: 1,
      usage: { input_tokens: 12, output_tokens: 4, private_input: 'secret state' },
      generativeCallsAvoided: 1,
    });

    const line = fs.readFileSync(path.join(resultsDir, 'decisions.jsonl'), 'utf8').trim();
    const event = JSON.parse(line);
    expect(event).toMatchObject({
      stage: 'goal_check',
      status: 'completed',
      provider: 'jev',
      outcome: 'met',
      confidence: 0.91,
      durationMs: 42,
      attemptCount: 1,
      usage: { input_tokens: 12, output_tokens: 4 },
      generativeCallsAvoided: 1,
    });
    expect(event).not.toHaveProperty('state');
    expect(line).not.toContain('secret state');
  });

  it('summarizes the least certain typed answer conservatively', () => {
    expect(summarizeDecisionConfidence({
      satisfied: { type: 'noul', noul: 0.97 },
      risk: { type: 'choice', choice: 'low', probabilities: { low: 0.8, high: 0.2 }, confidence: 0.8 },
      score: { type: 'score', score: 1, legend: { 0: 'Low', 1: 'High' }, probabilities: { 0: 0.1, 1: 0.9 }, confidence: 0.9 },
    })).toBe(0.8);
    expect(summarizeDecisionConfidence({ uncertain: { type: 'noul', noul: 0.5 } })).toBe(0.5);
  });

  it('appends compact records for repeated stage decisions', () => {
    appendDecisionTelemetry(resultsDir, {
      stage: 'goal_check', status: 'completed', provider: 'jev', outcome: 'unmet', durationMs: 20,
    });
    appendDecisionTelemetry(resultsDir, {
      stage: 'goal_check', status: 'unavailable', provider: 'jev', durationMs: 10, errorCode: 'timeout',
    });

    expect(fs.readFileSync(path.join(resultsDir, 'decisions.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('records bounded HTTP diagnostics without storing response bodies', () => {
    appendDecisionTelemetry(resultsDir, {
      stage: 'run_evaluation',
      status: 'unavailable',
      provider: 'jev',
      durationMs: 12,
      errorCode: 'http',
      httpStatus: 400,
      requestId: 'request-400-test',
    });

    const line = fs.readFileSync(path.join(resultsDir, 'decisions.jsonl'), 'utf8').trim();
    expect(JSON.parse(line)).toMatchObject({ httpStatus: 400, requestId: 'request-400-test', errorCode: 'http' });
    expect(line).not.toContain('response body');
  });
});
