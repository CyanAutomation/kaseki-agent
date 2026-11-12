import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DecisionService, ProfileDecisionRequest, ProfileDecisionResult } from './decision-service';
import { DecisionServiceError } from './decision-service';
import { evaluateWorkflow, type DecisionWorkflowDependencies } from './jev-workflow-evaluator';
import type { ClassificationAnswer } from './types/openrouter-decisions';

const ENVIRONMENT_KEYS = [
  'KASEKI_TASK_MODE',
  'KASEKI_WORKSPACE_DIR',
  'KASEKI_VALIDATION_RECOVERY_MODE',
  'KASEKI_FAILED_VALIDATION_COMMAND',
  'KASEKI_FAILED_VALIDATION_EXIT_CODE',
  'KASEKI_VALIDATION_RETRY_SAFE_COMMANDS',
] as const;

type SavedEnvironment = Partial<Record<typeof ENVIRONMENT_KEYS[number], string>>;

function profileAnswersFor(request: ProfileDecisionRequest): Record<string, ClassificationAnswer> {
  if (request.profileId === 'kaseki_goal_check_v1') {
    const answers: Record<string, ClassificationAnswer> = {};
    const criteria = Array.isArray(request.input.criteria) ? request.input.criteria : [];
    for (const item of criteria) {
      if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string') continue;
      if ('appliesWhen' in item && typeof item.appliesWhen === 'string' && item.appliesWhen) {
        answers[`${item.id}_applicability`] = {
          type: 'choice', choice: 'applicable',
          probabilities: { applicable: 1, not_applicable: 0, unknown: 0 }, confidence: 0.97,
        };
      }
      answers[item.id] = { type: 'noul', noul: 0.97 };
    }
    return answers;
  }
  if (request.profileId === 'kaseki_run_evaluation_v1') {
    const choices = (choice: string, ids: string[]): ClassificationAnswer => ({
      type: 'choice', choice, probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 1 : 0])), confidence: 0.97,
    });
    return {
      overall_assessment: choices('excellent', ['excellent', 'good', 'mixed', 'poor']),
      reviewer_confidence: choices('high', ['high', 'medium', 'low']),
      task_completion_score: {
        type: 'score', score: 4, legend: { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4' },
        probabilities: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 }, confidence: 0.97,
      },
      ...(request.input.includeFailureDiagnosis === true ? {
        validation_failure_cause: choices('test_failure', ['test_failure', 'type_or_lint_failure', 'build_failure', 'dependency_or_environment', 'timeout_or_flaky', 'implementation_logic', 'unknown']),
        validation_recovery_action: choices('fix_implementation', ['fix_implementation', 'repair_environment', 'retry_validation_once', 'inspect_diagnostics']),
      } : {}),
    };
  }
  return {};
}

function successfulService(providerId = 'test-provider'): DecisionService & {
  evaluateProfile: NonNullable<DecisionService['evaluateProfile']>;
} {
  return {
    providerId,
    evaluateProfile: async (request): Promise<ProfileDecisionResult> => ({
      provider: providerId,
      model: 'test/model',
      answers: request.profileId === 'validation_recovery_v1' ? {
        validation_failure_cause: {
          type: 'choice', choice: 'test_failure',
          probabilities: { test_failure: 1, type_or_lint_failure: 0, build_failure: 0, dependency_or_environment: 0, timeout_or_flaky: 0, implementation_logic: 0, unknown: 0 },
          confidence: 0.97,
        },
        validation_recovery_action: {
          type: 'choice', choice: 'fix_implementation',
          probabilities: { fix_implementation: 1, repair_environment: 0, retry_validation_once: 0, inspect_diagnostics: 0 },
          confidence: 0.97,
        },
      } : profileAnswersFor(request),
      usage: { input_tokens: 120, output_tokens: 24 },
      responseTime: 37,
      attemptCount: 1,
      profileId: request.profileId,
      profileVersion: '1',
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
    const service = successfulService();
    const evaluateProfile = jest.fn(service.evaluateProfile);

    const artifact = await evaluateWorkflow(mode, resultsDir, '1', {
      decisionService: { ...service, evaluateProfile },
    });

    expect(artifact).toBeDefined();
    expect(telemetryFor(resultsDir)).toEqual([
      expect.objectContaining({
        stage,
        status: 'completed',
        provider: 'test-provider',
        model: 'test/model',
        outcome,
        attemptCount: 1,
        usage: { input_tokens: 120, output_tokens: 24 },
      }),
    ]);
    const call = evaluateProfile.mock.calls[0]?.[0];
    expect(call?.profileId).toBe(mode === 'goal-check' ? 'kaseki_goal_check_v1' : mode === 'run-evaluation' ? 'kaseki_run_evaluation_v1' : 'validation_recovery_v1');
    expect(call?.timeoutMs).toBe(15_000);
    if (mode === 'goal-check') {
      expect(call?.input).toMatchObject({ criteria: [{ id: 'criterion_1', criterion: 'The requested implementation is complete' }] });
      expect(call?.input).toHaveProperty('state');
    } else if (mode === 'run-evaluation') {
      expect(call?.input).toMatchObject({ includeFailureDiagnosis: false });
      expect(call?.input).toHaveProperty('state');
    } else {
      expect(call?.input).toEqual({ command: 'npm test', exitCode: 1, output: '' });
    }
  });

  it('records the HTTP status and provider request ID when Run Evaluation is unavailable', async () => {
    const error = new DecisionServiceError('invalid_request', {
      httpStatus: 400,
      requestId: 'request-400-test',
      attemptCount: 1,
    });

    await expect(evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw error; },
        evaluateProfile: async () => { throw error; },
      },
    })).rejects.toBe(error);

    expect(telemetryFor(resultsDir)).toEqual([
      expect.objectContaining({
        stage: 'run_evaluation',
        status: 'unavailable',
        errorCode: 'invalid_request',
        httpStatus: 400,
        requestId: 'request-400-test',
      }),
    ]);
  });

  it('requests the fixed run-evaluation profile with failure diagnosis when persisted run evidence records a failure', async () => {
    fs.writeFileSync(path.join(resultsDir, 'metadata.json'), JSON.stringify({ exit_code: 1 }));
    fs.writeFileSync(path.join(resultsDir, 'validation.log'), 'npm test failed with exit code 1');
    let capturedRequest: ProfileDecisionRequest | undefined;
    const service = successfulService();
    const artifact = await evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        ...service,
        evaluateProfile: async (request) => {
          capturedRequest = request;
          return service.evaluateProfile!(request);
        },
      },
    });

    expect(capturedRequest).toMatchObject({
      profileId: 'kaseki_run_evaluation_v1',
      input: { includeFailureDiagnosis: true, state: { validation_present: true, diff_present: true } },
    });
    expect(artifact).toMatchObject({
      overall_assessment: 'poor',
      reviewer_confidence: 'low',
      task_completion_score: 2,
    });
  });

  it('does not convert null choice or score confidence into a high run evaluation', async () => {
    const service = successfulService();
    const artifact = await evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        ...service,
        evaluateProfile: async (request) => {
          const result = await service.evaluateProfile!(request);
          for (const answer of Object.values(result.answers)) {
            if (answer.type === 'choice' || answer.type === 'score') answer.confidence = null;
          }
          return result;
        },
      },
    });

    expect(artifact).toMatchObject({
      overall_assessment: 'unknown',
      reviewer_confidence: 'low',
      task_completion_score: 1,
    });
  });

  it('preserves resolved choices and scores with zero confidence', async () => {
    const service = successfulService();
    const artifact = await evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        ...service,
        evaluateProfile: async (request) => {
          const result = await service.evaluateProfile!(request);
          for (const answer of Object.values(result.answers)) {
            if (answer.type === 'choice' || answer.type === 'score') answer.confidence = 0;
          }
          return result;
        },
      },
    });

    expect(artifact).toMatchObject({
      overall_assessment: 'excellent',
      task_completion_score: 5,
    });
  });

  it('supplies bounded, redacted implementation evidence to JEV for documentation-only changes', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-workflow-repo-'));
    const repoDir = path.join(workspaceDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src/api.ts'), 'export const endpoint = "/api/v1/runs";\nconst credential = "' + 'sk-or-' + 'P9m4Q2x7L8v3R1w6T0a5NcKd";\n');
    fs.writeFileSync(path.join(repoDir, 'scripts/run.sh'), 'npm run check\n');
    fs.writeFileSync(path.join(repoDir, '.env'), 'LOCAL_ONLY_SENTINEL=must-not-be-sent\n');
    fs.writeFileSync(path.join(resultsDir, 'changed-files.txt'), 'docs/API.md\n');
    fs.writeFileSync(path.join(resultsDir, 'git.diff'), 'diff --git a/docs/API.md b/docs/API.md\n+GET /api/v1/runs\n');
    fs.writeFileSync(path.join(resultsDir, 'goal-setting.json'), JSON.stringify({
      outcome_policy: 'change_required',
      success_criteria: [{
        id: 'criterion_1',
        criterion: 'Documentation statements match the current implementation.',
        verification_sources: ['src/api.ts', '../outside.env', 'src/../.env', '.env'],
      }],
    }));
    fs.writeFileSync(path.join(resultsDir, 'scouting.json'), JSON.stringify({
      relevant_files: [{ path: 'scripts/run.sh', reason: 'Defines the documented check command.' }],
    }));
    process.env.KASEKI_WORKSPACE_DIR = workspaceDir;

    let capturedRequest: ProfileDecisionRequest | undefined;
    const service = successfulService();
    try {
      await evaluateWorkflow('goal-check', resultsDir, '1', {
        decisionService: {
          ...service,
          evaluateProfile: async (request) => {
            capturedRequest = request;
            return service.evaluateProfile!(request);
          },
        },
      });
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }

    expect(capturedRequest?.input.state).toMatchObject({
      implementation_evidence: [
        expect.objectContaining({ path: 'src/api.ts', content: expect.stringContaining('/api/v1/runs') }),
        expect.objectContaining({ path: 'scripts/run.sh', content: expect.stringContaining('npm run check') }),
      ],
    });
    expect(JSON.stringify(capturedRequest?.input.state)).not.toContain('P9m4Q2x7L8v3R1w6T0a5NcKd');
    expect(JSON.stringify(capturedRequest?.input.state.implementation_evidence)).not.toContain('outside.env');
    expect(JSON.stringify(capturedRequest?.input.state.implementation_evidence)).not.toContain('.env');
    expect(JSON.stringify(capturedRequest?.input.state.implementation_evidence)).not.toContain('LOCAL_ONLY_SENTINEL');
  });

  it('omits implementation snippets for non-documentation changes', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-workflow-repo-'));
    const repoDir = path.join(workspaceDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src/api.ts'), 'export const endpoint = "/api/v1/runs";\n');
    fs.writeFileSync(path.join(resultsDir, 'changed-files.txt'), 'src/api.ts\n');
    fs.writeFileSync(path.join(resultsDir, 'goal-setting.json'), JSON.stringify({
      outcome_policy: 'change_required',
      success_criteria: [{ criterion: 'The implementation matches the source contract.', verification_sources: ['src/api.ts'] }],
    }));
    fs.writeFileSync(path.join(resultsDir, 'scouting.json'), JSON.stringify({ relevant_files: [{ path: 'src/api.ts' }] }));
    process.env.KASEKI_WORKSPACE_DIR = workspaceDir;

    let capturedRequest: ProfileDecisionRequest | undefined;
    const service = successfulService();
    try {
      await evaluateWorkflow('goal-check', resultsDir, '1', {
        decisionService: {
          ...service,
          evaluateProfile: async (request) => {
            capturedRequest = request;
            return service.evaluateProfile!(request);
          },
        },
      });
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }

    expect(capturedRequest?.input.state.implementation_evidence).toEqual([]);
  });

  it.each([
    ['goal-check', 'goal_check'],
    ['run-evaluation', 'run_evaluation'],
  ] as const)('records an unavailable event when %s classification fails', async (mode, stage) => {
    const error = new DecisionServiceError('timeout', { attemptCount: 1 });
    const dependencies: DecisionWorkflowDependencies = {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw error; },
        evaluateProfile: async () => { throw error; },
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
        attemptCount: 1,
        generativeCallsAvoided: 0,
      }),
    ]);
  });

  it('returns the validation fallback and records unavailability when classification fails', async () => {
    process.env.KASEKI_VALIDATION_RECOVERY_MODE = 'auto';
    process.env.KASEKI_FAILED_VALIDATION_COMMAND = 'npm test';
    process.env.KASEKI_VALIDATION_RETRY_SAFE_COMMANDS = '["npm test"]';
    const error = new DecisionServiceError('network', { attemptCount: 1 });

    const artifact = await evaluateWorkflow('validation-recovery', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        decide: async () => { throw error; },
        evaluateProfile: async () => { throw error; },
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
        attemptCount: 1,
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
    const providerError = new DecisionServiceError('provider_failure', { httpStatus: 503, attemptCount: 1 });
    const telemetryError = new Error('telemetry disk is full');
    const appendTelemetry = jest.fn(() => { throw telemetryError; });

    await expect(evaluateWorkflow('run-evaluation', resultsDir, '1', {
      decisionService: {
        providerId: 'test-provider',
        evaluateProfile: async () => { throw providerError; },
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
        evaluateProfile: async () => { throw new DecisionServiceError('network', { attemptCount: 1 }); },
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
        decide: async () => { throw new Error('goal checks must use a fixed profile'); },
        evaluateProfile: async (request) => ({
          provider: 'test-provider', model: 'test/model',
          answers: { criterion_1: { type: 'noul', noul: 0.99 } },
          usage: {}, responseTime: 1, attemptCount: 1,
          profileId: request.profileId, profileVersion: '1',
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
    const evaluateProfile = jest.fn(async () => {
      throw new Error('semantic classification should not run for an invalid contract');
    });

    const artifact = await evaluateWorkflow('goal-check', resultsDir, '1', {
      decisionService: { providerId: 'test-provider', decide, evaluateProfile },
    });

    expect(decide).not.toHaveBeenCalled();
    expect(evaluateProfile).not.toHaveBeenCalled();
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
