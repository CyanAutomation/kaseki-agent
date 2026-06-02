/**
 * Goal-Setting Artifacts Registration - Test Suite
 *
 * Validates artifact metadata registry entries for goal-setting phase.
 */

import { ARTIFACT_METADATA_REGISTRY } from '../src/artifact-metadata';
import { ArtifactAvailability } from '../src/kaseki-api-types';

describe('Goal-Setting Artifacts Registry', () => {
  describe('Primary artifact registration', () => {
    it('should register goal-setting.json with CONDITIONAL availability', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting.json'];
      expect(artifact).toBeDefined();
      expect(artifact.name).toBe('goal-setting.json');
      expect(artifact.contentType).toBe('application/json');
      expect(artifact.availability).toBe(ArtifactAvailability.CONDITIONAL);
      expect(artifact.description).toContain('goal-setting');
      expect(artifact.sizeHint).toBe('small');
    });

    it('should have reasonable triageOrder for goal-setting.json', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting.json'];
      expect(artifact.triageOrder).toBeDefined();
      expect(artifact.triageOrder).toBeLessThan(10);
    });
  });

  describe('Supporting artifact registration', () => {
    it('should register goal-setting-summary.json', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting-summary.json'];
      expect(artifact).toBeDefined();
      expect(artifact.availability).toBe(ArtifactAvailability.CONDITIONAL);
      expect(artifact.contentType).toBe('application/json');
    });

    it('should register goal-setting-events.jsonl', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting-events.jsonl'];
      expect(artifact).toBeDefined();
      expect(artifact.availability).toBe(ArtifactAvailability.CONDITIONAL);
      expect(artifact.contentType).toBe('application/x-jsonl');
      expect(artifact.sizeHint).toBe('large');
    });

    it('should register goal-setting-stderr.log', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting-stderr.log'];
      expect(artifact).toBeDefined();
      expect(artifact.availability).toBe(ArtifactAvailability.CONDITIONAL);
      expect(artifact.contentType).toBe('text/plain');
    });

    it('should register goal-setting-validation-errors.jsonl', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting-validation-errors.jsonl'];
      expect(artifact).toBeDefined();
      expect(artifact.availability).toBe(ArtifactAvailability.CONDITIONAL);
      expect(artifact.contentType).toBe('application/x-jsonl');
    });
  });

  describe('Metrics artifact registration', () => {
    it('should register goal-setting-metrics.json with ALWAYS availability', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting-metrics.json'];
      expect(artifact).toBeDefined();
      expect(artifact.name).toBe('goal-setting-metrics.json');
      expect(artifact.contentType).toBe('application/json');
      expect(artifact.availability).toBe(ArtifactAvailability.ALWAYS);
      expect(artifact.description).toContain('metrics');
      expect(artifact.sizeHint).toBe('small');
    });

    it('should have triageOrder set for goal-setting-metrics.json', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting-metrics.json'];
      expect(artifact.triageOrder).toBeDefined();
      // Should be high order (lower priority in triage, higher number)
      expect(artifact.triageOrder).toBeGreaterThan(20);
    });
  });

  describe('Artifact ordering and discovery', () => {
    it('should have all goal-setting artifacts discoverable via registry', () => {
      const goalSettingArtifacts = Object.keys(ARTIFACT_METADATA_REGISTRY).filter(name =>
        name.startsWith('goal-setting'),
      );
      expect(goalSettingArtifacts).toContain('goal-setting.json');
      expect(goalSettingArtifacts).toContain('goal-setting-summary.json');
      expect(goalSettingArtifacts).toContain('goal-setting-events.jsonl');
      expect(goalSettingArtifacts).toContain('goal-setting-stderr.log');
      expect(goalSettingArtifacts).toContain('goal-setting-validation-errors.jsonl');
      expect(goalSettingArtifacts).toContain('goal-setting-metrics.json');
      expect(goalSettingArtifacts).toHaveLength(6);
    });

    it('goal-setting artifacts should appear before scouting artifacts in registry order', () => {
      const keys = Object.keys(ARTIFACT_METADATA_REGISTRY);
      const firstGoalSetting = keys.findIndex(k => k.startsWith('goal-setting'));
      const firstScouting = keys.findIndex(k => k.startsWith('scouting'));

      expect(firstGoalSetting).toBeGreaterThanOrEqual(0);
      expect(firstScouting).toBeGreaterThan(firstGoalSetting);
    });
  });

  describe('Artifact metadata structure', () => {
    const goalSettingArtifacts = [
      'goal-setting.json',
      'goal-setting-summary.json',
      'goal-setting-events.jsonl',
      'goal-setting-stderr.log',
      'goal-setting-validation-errors.jsonl',
      'goal-setting-metrics.json',
    ];

    goalSettingArtifacts.forEach(artifactName => {
      it(`${artifactName} should have complete metadata`, () => {
        const artifact = ARTIFACT_METADATA_REGISTRY[artifactName];
        expect(artifact).toBeDefined();
        expect(artifact.name).toBe(artifactName);
        expect(artifact.contentType).toBeTruthy();
        expect(artifact.description).toBeTruthy();
        expect(artifact.description.length).toBeGreaterThan(10);
        expect(Object.values(ArtifactAvailability)).toContain(artifact.availability);
      });

      it(`${artifactName} should have appropriate sizeHint if defined`, () => {
        const artifact = ARTIFACT_METADATA_REGISTRY[artifactName];
        if (artifact.sizeHint) {
          expect(['small', 'medium', 'large']).toContain(artifact.sizeHint);
        }
      });
    });
  });

  describe('Availability semantics', () => {
    it('CONDITIONAL artifacts may not exist in every run', () => {
      const conditionalArtifacts = [
        'goal-setting.json',
        'goal-setting-summary.json',
        'goal-setting-events.jsonl',
        'goal-setting-stderr.log',
        'goal-setting-validation-errors.jsonl',
      ];

      conditionalArtifacts.forEach(name => {
        const artifact = ARTIFACT_METADATA_REGISTRY[name];
        expect(artifact.availability).toBe(ArtifactAvailability.CONDITIONAL);
      });
    });

    it('ALWAYS artifact should exist in every run', () => {
      const artifact = ARTIFACT_METADATA_REGISTRY['goal-setting-metrics.json'];
      expect(artifact.availability).toBe(ArtifactAvailability.ALWAYS);
    });
  });

  describe('Content type validation', () => {
    it('should use correct MIME type for JSON artifacts', () => {
      const jsonArtifacts = [
        'goal-setting.json',
        'goal-setting-summary.json',
        'goal-setting-metrics.json',
      ];

      jsonArtifacts.forEach(name => {
        const artifact = ARTIFACT_METADATA_REGISTRY[name];
        expect(artifact.contentType).toBe('application/json');
      });
    });

    it('should use correct MIME type for JSONL artifacts', () => {
      const jsonlArtifacts = ['goal-setting-events.jsonl', 'goal-setting-validation-errors.jsonl'];

      jsonlArtifacts.forEach(name => {
        const artifact = ARTIFACT_METADATA_REGISTRY[name];
        expect(artifact.contentType).toBe('application/x-jsonl');
      });
    });

    it('should use correct MIME type for log artifacts', () => {
      const logArtifacts = ['goal-setting-stderr.log'];

      logArtifacts.forEach(name => {
        const artifact = ARTIFACT_METADATA_REGISTRY[name];
        expect(artifact.contentType).toBe('text/plain');
      });
    });
  });
});
