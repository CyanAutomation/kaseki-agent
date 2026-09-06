export const DEFAULT_RUBRIC_VERSION = '2026-08-07.1';

export interface ScorecardConfig {
  rubricVersion: string;
  taskSize: 'small' | 'medium' | 'large' | 'custom';
  targets: { elapsedSeconds: number; tokens: number; retries: number };
}

export function normalizeConfig(env: NodeJS.ProcessEnv): ScorecardConfig {
  const positive = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const requested = env.KASEKI_SCORECARD_TASK_SIZE;
  const taskSize = requested === 'small' || requested === 'medium' || requested === 'large' ? requested : 'custom';
  // These are advisory scoring targets, not execution limits.  Agentic runs
  // include cached context and evaluator passes, so the former values made
  // healthy runs look anomalous simply for emitting complete evidence.
  const defaults = taskSize === 'small' ? { elapsedSeconds: 900, tokens: 100_000 }
    : taskSize === 'medium' ? { elapsedSeconds: 2700, tokens: 300_000 }
      : taskSize === 'large' ? { elapsedSeconds: 7200, tokens: 1_200_000 }
        : { elapsedSeconds: 1800, tokens: 750_000 };
  return {
    rubricVersion: env.KASEKI_SCORECARD_RUBRIC_VERSION?.trim() || DEFAULT_RUBRIC_VERSION,
    taskSize,
    targets: {
      elapsedSeconds: positive('KASEKI_SCORECARD_TARGET_SECONDS', defaults.elapsedSeconds),
      tokens: positive('KASEKI_SCORECARD_TARGET_TOKENS', defaults.tokens),
      retries: positive('KASEKI_SCORECARD_TARGET_RETRIES', 2),
    },
  };
}
