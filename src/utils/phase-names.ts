/**
 * Phase Display Names
 *
 * Maps internal stage identifiers to short, descriptive names for the Web UI.
 */

const PHASE_DISPLAY_NAMES: Record<string, string> = {
  'cold-cache setup': 'Preparing dependencies',
  // Goal-setting is a pre-scouting planning step. Keeping its display name
  // distinct from the post-scouting weaving outcome prevents the console from
  // implying that coding has begun before scouting has completed.
  'pi goal-setting agent': 'Goal setting',
  'pi scouting agent': 'Scouting',
  'pi coding agent': 'Weaving',
  'goal check': 'Testing',
  'run evaluation': 'Final review',
};

/**
 * Get the display name for a stage identifier.
 * Returns the display name if the stage is one of the named phases,
 * otherwise returns undefined.
 */
export function getPhaseDisplayName(stage: string): string | undefined {
  return stage && typeof stage === 'string' ? PHASE_DISPLAY_NAMES[stage.trim()] : undefined;
}
