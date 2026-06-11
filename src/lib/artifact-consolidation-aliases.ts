/**
 * Artifact Consolidation Aliases
 * Provides backward-compatible access to deprecated artifacts via redirects to consolidated targets
 *
 * When clients request a deprecated artifact, the API can:
 * 1. Return the deprecated artifact if it exists (for clients that don't support consolidation)
 * 2. Return the consolidated artifact (primary)
 * 3. Return both with a deprecation notice
 */

export interface ArtifactAlias {
  deprecatedName: string;
  consolidatedTarget: string;
  phase?: string;
  migrationPath: 'redirect' | 'warn' | 'dual'; // How to handle the redirect
}

/**
 * Mapping of deprecated artifacts to their consolidated consolidation targets
 * Clients requesting deprecated artifacts should migrate to consolidated targets
 */
export const ARTIFACT_CONSOLIDATION_ALIASES: Record<string, ArtifactAlias> = {
  // Phase Summary Consolidation
  'scouting-summary.json': {
    deprecatedName: 'scouting-summary.json',
    consolidatedTarget: 'all-phase-summaries.json',
    phase: 'scouting',
    migrationPath: 'redirect',
  },
  'goal-setting-summary.json': {
    deprecatedName: 'goal-setting-summary.json',
    consolidatedTarget: 'all-phase-summaries.json',
    phase: 'goal-setting',
    migrationPath: 'redirect',
  },
  'goal-check-summary.json': {
    deprecatedName: 'goal-check-summary.json',
    consolidatedTarget: 'all-phase-summaries.json',
    phase: 'goal-check',
    migrationPath: 'redirect',
  },
  'run-evaluation-summary.json': {
    deprecatedName: 'run-evaluation-summary.json',
    consolidatedTarget: 'all-phase-summaries.json',
    phase: 'run-evaluation',
    migrationPath: 'redirect',
  },

  // Timing Consolidation
  'validation-timings.tsv': {
    deprecatedName: 'validation-timings.tsv',
    consolidatedTarget: 'timings-manifest.json',
    phase: undefined,
    migrationPath: 'redirect',
  },
  'pre-validation-timings.tsv': {
    deprecatedName: 'pre-validation-timings.tsv',
    consolidatedTarget: 'timings-manifest.json',
    phase: undefined,
    migrationPath: 'redirect',
  },
  'stage-timings.tsv': {
    deprecatedName: 'stage-timings.tsv',
    consolidatedTarget: 'timings-manifest.json',
    phase: undefined,
    migrationPath: 'redirect',
  },
  'goal-setting-metrics.json': {
    deprecatedName: 'goal-setting-metrics.json',
    consolidatedTarget: 'timings-manifest.json',
    phase: undefined,
    migrationPath: 'redirect',
  },
};

/**
 * Check if an artifact name is a deprecated alias
 */
export function isDeprecatedArtifact(artifactName: string): boolean {
  return artifactName in ARTIFACT_CONSOLIDATION_ALIASES;
}

/**
 * Get the consolidated target for a deprecated artifact
 * Returns null if artifact is not deprecated
 */
export function getConsolidatedTarget(artifactName: string): string | null {
  const alias = ARTIFACT_CONSOLIDATION_ALIASES[artifactName];
  return alias?.consolidatedTarget ?? null;
}

/**
 * Get deprecation metadata for an artifact
 * Returns null if artifact is not deprecated
 */
export function getDeprecationInfo(artifactName: string): ArtifactAlias | null {
  return ARTIFACT_CONSOLIDATION_ALIASES[artifactName] ?? null;
}

/**
 * Helper to extract phase data from consolidated artifact
 * For example, to get 'scouting' data from all-phase-summaries.json
 */
export function extractPhaseFromConsolidated(
  consolidatedContent: string,
  consolidatedName: string,
  phase?: string
): string | null {
  if (!phase) {
    return null;
  }

  try {
    if (consolidatedName === 'all-phase-summaries.json') {
      const manifest = JSON.parse(consolidatedContent);
      const phaseData = manifest.phases?.find((p: any) => p.phase === phase);
      return phaseData ? JSON.stringify(phaseData, null, 2) : null;
    }

    if (consolidatedName === 'timings-manifest.json') {
      // For timing manifest, return the appropriate timing source
      const manifest = JSON.parse(consolidatedContent);
      if (phase === 'validation') {
        return manifest.validation_timings ? JSON.stringify(manifest.validation_timings, null, 2) : null;
      }
      if (phase === 'pre-validation') {
        return manifest.pre_validation_timings ? JSON.stringify(manifest.pre_validation_timings, null, 2) : null;
      }
      if (phase === 'stage') {
        return manifest.stage_timings ? JSON.stringify(manifest.stage_timings, null, 2) : null;
      }
    }
  } catch (err) {
    return null;
  }

  return null;
}
