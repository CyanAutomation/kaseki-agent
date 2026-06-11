/**
 * Goal-Setting Artifacts Registration - Test Suite
 *
 * Validates artifact metadata registry entries for goal-setting phase.
 */

import { ARTIFACT_METADATA_REGISTRY } from '../src/artifact-metadata';
import { ArtifactAvailability } from '../src/kaseki-api-types';

type ExpectedGoalSettingArtifact = {
  name: string;
  contentType: string;
  availability: ArtifactAvailability;
  sizeHint: 'small' | 'medium' | 'large';
  triageOrder?: {
    lessThan?: number;
    greaterThan?: number;
  };
};

const EXPECTED_GOAL_SETTING_ARTIFACTS: ExpectedGoalSettingArtifact[] = [
  {
    name: 'goal-setting.json',
    contentType: 'application/json',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'small',
    triageOrder: { lessThan: 10 },
  },
  {
    name: 'goal-setting-events.jsonl',
    contentType: 'application/x-jsonl',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'large',
  },
  {
    name: 'goal-setting-stderr.log',
    contentType: 'text/plain',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'medium',
  },
  {
    name: 'goal-setting-validation-errors.jsonl',
    contentType: 'application/x-jsonl',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'small',
  },
];

describe('Goal-Setting Artifacts Registry', () => {
  it.each(EXPECTED_GOAL_SETTING_ARTIFACTS)(
    'registers exact metadata for $name',
    ({ name, contentType, availability, sizeHint, triageOrder }) => {
      const artifact = ARTIFACT_METADATA_REGISTRY[name];
      expect(artifact).toBeDefined();

      // Validate each field explicitly (not using objectContaining for precision)
      expect(artifact.name).toBe(name);
      expect(artifact.contentType).toBe(contentType);
      expect(artifact.availability).toBe(availability);
      expect(artifact.sizeHint).toBe(sizeHint);

      if (triageOrder) {
        expect(artifact.triageOrder).toBeDefined();

        if (triageOrder.lessThan !== undefined) {
          expect(artifact.triageOrder).toBeLessThan(triageOrder.lessThan);
        }

        if (triageOrder.greaterThan !== undefined) {
          expect(artifact.triageOrder).toBeGreaterThan(triageOrder.greaterThan);
        }
      } else {
        // If no triageOrder expected, ensure it's either undefined or a valid number
        if (artifact.triageOrder !== undefined) {
          expect(typeof artifact.triageOrder).toBe('number');
        }
      }
    },
  );

  describe('Artifact ordering', () => {
    it('goal-setting artifacts should appear before scouting artifacts in registry order', () => {
      const keys = Object.keys(ARTIFACT_METADATA_REGISTRY);
      const firstGoalSetting = keys.findIndex(k => k.startsWith('goal-setting'));
      const firstScouting = keys.findIndex(k => k.startsWith('scouting'));

      expect(firstGoalSetting).toBeGreaterThanOrEqual(0);
      expect(firstScouting).toBeGreaterThan(firstGoalSetting);
    });
  });
});
