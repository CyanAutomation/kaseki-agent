import { collectValidationEvidence } from './run-scorecard-evidence-validation';

describe('run-scorecard-evidence-validation', () => {
  describe('collectValidationEvidence', () => {
    it('returns failed when failure.validation_exit_code is non-zero', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': { validation_exit_code: 1 },
          'timings-manifest.json': { validation_timings: [] },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('failed');
    });

    it('returns passed when failure.validation_exit_code is 0 with executed validation rows', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': { validation_commands_attempted: 1 },
          'failure.json': { validation_exit_code: 0 },
          'timings-manifest.json': {
            validation_timings: [
              { command: 'npm test', exit_code: 0, status: 'passed' },
            ],
          },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('passed');
    });

    it('returns passed when all executed validation rows have exit_code 0', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': {},
          'timings-manifest.json': {
            validation_timings: [
              { command: 'npm test', exit_code: 0, status: 'passed' },
              { command: 'npm build', exit_code: 0, status: 'passed' },
            ],
          },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('passed');
      expect(evidence.executedValidationRows).toHaveLength(2);
    });

    it('returns failed when any executed validation row has non-zero exit_code', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': {},
          'timings-manifest.json': {
            validation_timings: [
              { command: 'npm test', exit_code: 0, status: 'passed' },
              { command: 'npm build', exit_code: 1, status: 'failed' },
            ],
          },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('failed');
      expect(evidence.executedValidationRows).toHaveLength(2);
    });

    it('filters out skipped rows with skipped=missing_npm_script', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': {},
          'timings-manifest.json': {
            validation_timings: [
              { command: 'npm test', exit_code: 0, status: 'passed' },
              { command: 'npm missing', details: 'skipped=missing_npm_script', status: 'skipped' },
            ],
          },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('passed');
      expect(evidence.executedValidationRows).toHaveLength(1);
      expect(evidence.executedValidationRows[0].command).toBe('npm test');
    });

    it('filters out rows with status: skipped', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': {},
          'timings-manifest.json': {
            validation_timings: [
              { command: 'npm test', exit_code: 0, status: 'passed' },
              { command: 'npm lint', status: 'skipped' },
            ],
          },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.executedValidationRows).toHaveLength(1);
    });

    it('returns unknown when no validation_timings but validation_commands_attempted > 0', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': { validation_commands_attempted: 2 },
          'failure.json': {},
          'timings-manifest.json': {},
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('unknown');
    });

    it('returns unknown when no validation_timings and no validation_commands_attempted', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': { validation_commands_attempted: 0 },
          'failure.json': {},
          'timings-manifest.json': {},
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('unknown');
    });

    it('handles missing metadata.json gracefully', () => {
      const evidence = collectValidationEvidence({
        json: {
          'failure.json': { validation_exit_code: 0 },
          'timings-manifest.json': { validation_timings: [] },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('unknown');
    });

    it('handles missing timings-manifest.json gracefully', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': { validation_commands_attempted: 0 },
          'failure.json': { validation_exit_code: 0 },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.validation).toBe('unknown');
      expect(evidence.executedValidationRows).toEqual([]);
    });

    it('handles validation_timings as non-array gracefully', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': {},
          'timings-manifest.json': { validation_timings: 'not-an-array' },
        },
        text: {},
        summaries: [],
      });
      expect(evidence.executedValidationRows).toEqual([]);
    });

    it('extracts validation rows with various exit_code formats', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': {},
          'timings-manifest.json': {
            validation_timings: [
              { command: 'test1', exit_code: 0 },
              { command: 'test2', exit_code: null },
              { command: 'test3' }, // missing exit_code
            ],
          },
        },
        text: {},
        summaries: [],
      });
      // All non-skipped rows should be included
      expect(evidence.executedValidationRows).toHaveLength(3);
    });

    it('favors failure.validation_exit_code over validation rows status', () => {
      const evidence = collectValidationEvidence({
        json: {
          'metadata.json': {},
          'failure.json': { validation_exit_code: 1 },
          'timings-manifest.json': {
            validation_timings: [
              { command: 'npm test', exit_code: 0, status: 'passed' },
            ],
          },
        },
        text: {},
        summaries: [],
      });
      // failure.validation_exit_code takes precedence
      expect(evidence.validation).toBe('failed');
    });
  });
});
