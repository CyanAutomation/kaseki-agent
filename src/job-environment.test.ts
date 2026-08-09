import { configureScoutingAndGoalCheckEnv } from './job-environment';

describe('configureScoutingAndGoalCheckEnv', () => {
  const config = { defaultTaskMode: 'patch' } as any;

  it('enables scouting and evaluation defaults for a normal PR run', () => {
    const env: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(env, { publishMode: 'pr' } as any, config);

    expect(env.KASEKI_SCOUTING).toBe('1');
    expect(env.KASEKI_RUN_EVALUATION).toBe('1');
  });

  it('disables evaluation for inspect and startup-check runs by default', () => {
    const inspectEnv: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(inspectEnv, { taskMode: 'inspect', publishMode: 'pr' } as any, config);
    expect(inspectEnv.KASEKI_RUN_EVALUATION).toBe('0');

    const startupEnv: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(startupEnv, { publishMode: 'pr', startupCheck: true } as any, config);
    expect(startupEnv.KASEKI_RUN_EVALUATION).toBe('0');
  });

  it('preserves explicit model, timeout, and retry settings', () => {
    const env: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(env, {
      scouting: { enabled: false, model: 'scout', timeoutSeconds: 12 },
      goalCheck: { enabled: true, model: 'checker', maxRetries: 2, timeoutSeconds: 30 },
      runEvaluation: { enabled: true, model: 'evaluator', timeoutSeconds: 45 },
    } as any, config);

    expect(env.KASEKI_SCOUTING).toBe('0');
    expect(env.KASEKI_SCOUTING_MODEL).toBe('scout');
    expect(env.KASEKI_SCOUTING_TIMEOUT_SECONDS).toBe('12');
    expect(env.KASEKI_GOAL_CHECK).toBe('1');
    expect(env.KASEKI_GOAL_CHECK_MAX_RETRIES).toBe('2');
    expect(env.KASEKI_RUN_EVALUATION_MODEL).toBe('evaluator');
  });
});
