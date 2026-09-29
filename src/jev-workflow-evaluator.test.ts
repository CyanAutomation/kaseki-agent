import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DecisionRequest, DecisionResult, DecisionService } from './decision-service';
import { JevClassificationError } from './jev-classifier';
import { evaluateWorkflow, type DecisionWorkflowDependencies } from './jev-workflow-evaluator';
import type { ClassificationAnswer } from './types/openrouter-decisions';

const ENVIRONMENT_KEYS = [
  'KASEKI_TASK_MODE',
  'KASEKI_VALIDATION_RECOVERY_MODE',
  'KASEKI_FAILED_VALIDATION_COMMAND',
  'KASEKI_FAILED_VALIDATION_EXIT_CODE',
  'KASEKI_VALIDATION_RETRY_SAFE_COMMANDS',
] as const;

type SavedEnvironment = Partial<Record<typeof ENVIRONMENT_KEYS[number], string>>;

function answersFor(request: DecisionRequest): Record<string, ClassificationAnswer> {
  return Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === 'noul') return [id, { type: 'noul', noul: 0.97 } satisfies ClassificationAnswer];
    if (question.type === 'choice') {
      const choices = Object.keys(question.criteria);
      const choice = choices[0];
      const probabilities = Object.fromEntries(choices.map((key) => [key, key === choice ? 1 : 0]));
      return [id, { type: 'choice', choice, probabilities, confidence: 0.97 } satisfies ClassificationAnswer];
    }
    const score = question.criteria.length - 1;
    const legend = Object.fromEntries(question.criteria.map((criterion, index) => [String(index), String(criterion)]));
    const probabilities = Object.fromEntries(question.criteria.map((_, index) => [String(index), index === score ? 1 : 0]));
    return [id, { type: 'score', score, legend, probabilities, confidence: 0.97 } satisfies ClassificationAnswer];
  }));
}

function successfulService(providerId = 'test-provider'): DecisionService {
  return {
    providerId,
    decide: async (request): Promise<DecisionResult> => ({
      provider: providerId,
      model: 'test/model',
      answers: answersFor(request),
      usage: { input_tokens: 120, output_tokens: 24 },
      responseTime: 37,
      attemptCount: 2,
    }),
  };
}

function telemetryFor(resultsDir: string): Record<string, unknown>[] {
  return fs.readFileSync(path.join(resultsDir, 'decisions.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('decision workflow telemetry', () => {
  let resultsDir: string;
  let originalEnvironment: SavedEnvironment;

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(ENVIRONMENT_KEYS.flatMap((key) => (
      process.env[key] === undefined ? [] : [[key, process.env[key] as string]]
    ))) as SavedEnvironment;
    for (const key of ENVIRONMENT_KEYS) delete process.env[key];
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-workflow-decisions-'));
    fs.writeFileSync(path.join(resultsDir, 'goal-setting.json'), JSON.stringify({
      outcome_policy: 'change_required',
      success_criteria: ['The requested implementation is complete'],
    }));
    fs.writeFileSync(path.join(resultsDir, 'git.diff'), 'diff --git a/src/example.ts b/src/example.ts\n+export {};\n');
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
    for (const key of ENVIRONMENT_KEYS) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([
    ['goal-check', 'goal_check', 'met'],
    ['run-evaluation', 'run_evaluation', 'excellent'],
    ['validation-recovery', 'validation_recovery', 'cause_not_transient'],
  ] as const)('records completed telemetry for %s', async (mode, stage, outcome) => {
    if (mode === 'validation-recovery') {
      process.env.KASEKI_VALIDATION_RECOVERY_MODE = 'auto';
      process.env.KASEKI_FAILED_VALIDATION_COMMAND = 'npm test';
      process.env.KASEKI_FAILED_VALIDATION_EXIT_CODE = '1';
      process.env.KASEKI_VALIDATION_RETRY_SAFE_COMMANDS = '["npm test"]';
    }

    const artifact = await evaluateWorkflow(mode, resultsDir, '1', {
      decisionService: successfulService(),
    });

    expect(artifact).toBeDefined();
    expect(telemetryFor(resultsDir)).toEqual([
      expect.objectContaining({
        stage,
        status: 'completed',
        provider: 'test-provider',
        model: 'test/model',
        outcome,
        attemptCount: 2,
        usage: { input_tokens: 120, output_tokens: 24 },
      }),
    ]);
  });

  it.each([
    ['goal-check', 'goal_check'],
    ['run-evaluation', 'run_evaluation'],
  ] as const)('records an unavailable event when %s classification fails', async (mode, stage) => {
    const error = new JevClassificationError('timeout', 'decision provider timed out');
    error.attemptCount = 3;
    const dependencies: DecisionWorkflowDependencies = {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw error; },
      },
    };

    await expect(evaluateWorkflow(mode, resultsDir, '1', dependencies)).rejects.toBe(error);

    expect(telemetryFor(resultsDir)).toEqual([
      expect.objectContaining({
        stage,
        status: 'unavailable',
        provider: 'test-provider',
        outcome: 'classification_unavailable',
        errorCode: 'timeout',
        attemptCount: 3,
        generativeCallsAvoided: 0,
      }),
    ]);
  });

  it('returns the validation fallback and records unavailability when classification fails', async () => {
    process.env.KASEKI_VALIDATION_RECOVERY_MODE = 'auto';
    process.env.KASEKI_FAILED_VALIDATION_COMMAND = 'npm test';
    process.env.KASEKI_VALIDATION_RETRY_SAFE_COMMANDS = '["npm test"]';
    const error = new JevClassificationError('network', 'decision provider unavailable');
    error.attemptCount = 2;

    const artifact = await evaluateWorkflow('validation-recovery', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw error; },
      },
    });

    expect(artifact).toMatchObject({ status: 'unavailable', reason: 'classification_unavailable', retry_authorized: false });
    expect(telemetryFor(resultsDir)).toEqual([
      expect.objectContaining({
        stage: 'validation_recovery',
        status: 'unavailable',
        provider: 'test-provider',
        outcome: 'classification_unavailable',
        errorCode: 'network',
        attemptCount: 2,
      }),
    ]);
  });

  it('keeps a successful workflow result when telemetry persistence fails', async () => {
    const artifact = await evaluateWorkflow('goal-check', resultsDir, '1', {
      decisionService: successfulService(),
      appendTelemetry: () => { throw new Error('results directory is read-only'); },
    });

    expect(artifact).toMatchObject({ met: true, outcome: 'met' });
    expect(fs.existsSync(path.join(resultsDir, 'decisions.jsonl'))).toBe(false);
  });

  it('preserves the provider failure when writing failure telemetry also fails', async () => {
    const providerError = new JevClassificationError('http', 'decision provider returned HTTP 503', 503);
    const telemetryError = new Error('telemetry disk is full');
    const appendTelemetry = jest.fn(() => { throw telemetryError; });

    await expect(evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw providerError; },
      },
      appendTelemetry,
    })).rejects.toBe(providerError);
    expect(appendTelemetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the validation recovery fallback when its unavailable event cannot be persisted', async () => {
    process.env.KASEKI_VALIDATION_RECOVERY_MODE = 'auto';
    process.env.KASEKI_FAILED_VALIDATION_COMMAND = 'npm test';
    process.env.KASEKI_VALIDATION_RETRY_SAFE_COMMANDS = '["npm test"]';
    const appendTelemetry = jest.fn(() => { throw new Error('telemetry disk is full'); });
    const artifact = await evaluateWorkflow('validation-recovery', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw new JevClassificationError('network', 'decision provider unavailable'); },
      },
      appendTelemetry,
    });

    expect(artifact).toMatchObject({
      status: 'unavailable',
      reason: 'classification_unavailable',
      retry_authorized: false,
    });
    expect(appendTelemetry).toHaveBeenCalledTimes(1);
  });
});
