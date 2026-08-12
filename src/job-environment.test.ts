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

  it('applies explicit goal-setting settings', () => {
    const env: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(env, {
      goalSetting: { enabled: false, model: 'goal-setter', timeoutSeconds: 18 },
    } as any, config);

    expect(env.KASEKI_GOAL_SETTING).toBe('0');
    expect(env.KASEKI_GOAL_SETTING_MODEL).toBe('goal-setter');
    expect(env.KASEKI_GOAL_SETTING_TIMEOUT_SECONDS).toBe('18');
  });

  it.each([
    ['draft_pr', 'patch', false, '1'],
    ['issue', 'patch', false, '0'],
    ['pr', 'inspect', false, '0'],
    ['pr', 'patch', true, '0'],
    ['issue', 'inspect', true, '0'],
  ])('applies evaluation default for %s/%s startup=%s', (publishMode, taskMode, startupCheck, expected) => {
    const env: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(env, { publishMode, taskMode, startupCheck } as any, config);

    expect(env.KASEKI_RUN_EVALUATION).toBe(expected);
  });

  it.each([true, false])('honors explicit evaluation enabled=%s over its default', enabled => {
    const env: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(env, {
      publishMode: 'pr',
      taskMode: 'inspect',
      startupCheck: true,
      runEvaluation: { enabled },
    } as any, config);

    expect(env.KASEKI_RUN_EVALUATION).toBe(enabled ? '1' : '0');
  });

  it('applies explicit goal-check disablement and zero retries', () => {
    const env: NodeJS.ProcessEnv = {};
    configureScoutingAndGoalCheckEnv(env, {
      goalCheck: { enabled: false, maxRetries: 0, model: 'checker', timeoutSeconds: 0 },
    } as any, config);

    expect(env.KASEKI_GOAL_CHECK).toBe('0');
    expect(env.KASEKI_GOAL_CHECK_MAX_RETRIES).toBe('0');
    expect(env.KASEKI_GOAL_CHECK_MODEL).toBe('checker');
    expect(env.KASEKI_GOAL_CHECK_TIMEOUT_SECONDS).toBe('0');
  });

  it('writes explicit zero values without overwriting omitted settings', () => {
    const env: NodeJS.ProcessEnv = {
      KASEKI_GOAL_CHECK_MAX_RETRIES: '9',
      KASEKI_SCOUTING_TIMEOUT_SECONDS: '30',
    };
    configureScoutingAndGoalCheckEnv(env, {
      goalCheck: { maxRetries: 0, timeoutSeconds: 0 },
      scouting: { timeoutSeconds: 0 },
    } as any, config);

    expect(env.KASEKI_GOAL_CHECK_MAX_RETRIES).toBe('0');
    expect(env.KASEKI_GOAL_CHECK_TIMEOUT_SECONDS).toBe('0');
    expect(env.KASEKI_SCOUTING_TIMEOUT_SECONDS).toBe('0');
    expect(env.KASEKI_GOAL_SETTING_MODEL).toBeUndefined();
  });
});
