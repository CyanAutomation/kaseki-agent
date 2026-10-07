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

  it('records the HTTP status and provider request ID when Run Evaluation is unavailable', async () => {
    const error = new JevClassificationError(
      'http',
      'OpenRouter decision endpoint returned HTTP 400',
      400,
      'request-400-test',
    );

    await expect(evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw error; },
      },
    })).rejects.toBe(error);

    expect(telemetryFor(resultsDir)).toEqual([
      expect.objectContaining({
        stage: 'run_evaluation',
        status: 'unavailable',
        errorCode: 'http',
        httpStatus: 400,
        requestId: 'request-400-test',
      }),
    ]);
  });

  it('adds failure diagnosis questions when persisted run evidence records a failure', async () => {
    fs.writeFileSync(path.join(resultsDir, 'metadata.json'), JSON.stringify({ exit_code: 1 }));
    fs.writeFileSync(path.join(resultsDir, 'validation.log'), 'npm test failed with exit code 1');
    let capturedRequest: DecisionRequest | undefined;
    const service = successfulService();
    const artifact = await evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        ...service,
        decide: async (request) => {
          capturedRequest = request;
          return service.decide(request);
        },
      },
    });

    expect(capturedRequest?.questions).toHaveProperty('validation_failure_cause');
    expect(capturedRequest?.questions).toHaveProperty('validation_recovery_action');
    expect(capturedRequest?.state).toMatchObject({ validation_present: true, diff_present: true });
    expect(artifact).toMatchObject({
      overall_assessment: 'poor',
      reviewer_confidence: 'low',
      task_completion_score: 2,
    });
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

describe('goal-check contract enforcement', () => {
  let resultsDir: string;
  let originalTaskMode: string | undefined;

  beforeEach(() => {
    originalTaskMode = process.env.KASEKI_TASK_MODE;
    delete process.env.KASEKI_TASK_MODE;
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-goal-contract-'));
    fs.writeFileSync(path.join(resultsDir, 'goal-setting.json'), JSON.stringify({
      outcome_policy: 'change_required',
      success_criteria: ['The requested implementation is complete'],
    }));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
    if (originalTaskMode === undefined) delete process.env.KASEKI_TASK_MODE;
    else process.env.KASEKI_TASK_MODE = originalTaskMode;
  });

  it('marks an empty patch diff unmet when the contract requires a change', async () => {
    fs.writeFileSync(path.join(resultsDir, 'git.diff'), '');
    const decisionService = successfulService();

    const artifact = await evaluateWorkflow('goal-check', resultsDir, '1', { decisionService });

    expect(artifact).toMatchObject({
      met: false,
      outcome: 'unmet',
      retryable: true,
      contradictions: [
        expect.objectContaining({
          sources: ['goal-setting.json', 'git.diff'],
          description: 'The goal contract requires a code change but the durable diff is empty.',
        }),
      ],
    });
    expect(artifact.missing).toContain('patch-mode task produced no git diff');
  });

  it('keeps a conditional criterion uncertain when its applicability is unknown', async () => {
    fs.writeFileSync(path.join(resultsDir, 'goal-setting.json'), JSON.stringify({
      outcome_policy: 'change_or_noop',
      success_criteria: [{
        criterion: 'Publish a release note',
        applies_when: 'A release is requested',
      }],
    }));
    const artifact = await evaluateWorkflow('goal-check', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => ({
          provider: 'test-provider',
          model: 'test/model',
          answers: { criterion_1: { type: 'noul', noul: 0.99 } },
          usage: {},
          responseTime: 1,
          attemptCount: 1,
        }),
      },
    });

    expect(artifact).toMatchObject({ met: false, outcome: 'uncertain', review_required: true });
    expect(artifact.missing).toEqual(['Publish a release note (applicability of "A release is requested" is unknown)']);
  });

  it('rejects a conflicting contract before calling the decision service', async () => {
    fs.writeFileSync(path.join(resultsDir, 'goal-setting.json'), JSON.stringify({
      outcome_policy: 'change_required',
      success_criteria: ['No code changes are required'],
    }));
    const decide = jest.fn(async () => {
      throw new Error('semantic classification should not run for an invalid contract');
    });

    const artifact = await evaluateWorkflow('goal-check', resultsDir, '1', {
      decisionService: { providerId: 'test-provider', decide },
    });

    expect(decide).not.toHaveBeenCalled();
    expect(artifact).toMatchObject({
      met: false,
      retryable: false,
      confidence: 'low',
      contract_validation: {
        valid: false,
        errors: [
          'success_criteria[0] conflicts with outcome_policy=change_required because it requires no code changes',
        ],
      },
    });
  });
});
