/**
 * Phase Display Names
 *
 * Maps internal stage identifiers to human-readable character names for the Web UI.
 * These 5 phases are the primary workflow checkpoints and are displayed with
 * distinctive names in the Kaseki Task Console.
 */

export const PHASE_DISPLAY_NAMES: Record<string, string> = {
  // Goal-setting is a pre-scouting planning step. Keeping its display name
  // distinct from the post-scouting weaving outcome prevents the console from
  // implying that coding has begun before scouting has completed.
  'pi goal-setting agent': 'Yuzuriha — Goal-setting',
  'pi scouting agent': 'Suika — Scouting',
  'pi coding agent': 'Kaseki — Crafting',
  'goal check': 'Senku — Testing',
  'run evaluation': 'Xeno — Evaluating',
};

/**
 * Get the display name for a stage identifier.
 * Returns the character name if the stage is one of the 5 named phases,
 * otherwise returns undefined.
 */
export function getPhaseDisplayName(stage: string): string | undefined {
  return stage && typeof stage === 'string' ? PHASE_DISPLAY_NAMES[stage.trim()] : undefined;
}
