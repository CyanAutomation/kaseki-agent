/**
 * Unit tests for phase detection logic
 * Tests detectPhaseReached and detectPhaseFailures with comprehensive coverage
 */

import { detectPhaseReached, detectPhaseFailures } from './run-scorecard-evidence-phases';
import type { ArtifactSnapshot } from './run-scorecard-evidence-types';

describe('run-scorecard-evidence-phases', () => {
  describe('detectPhaseReached', () => {
    const baseSnapshot = (): ArtifactSnapshot => ({
      json: {},
      text: {},
      summaries: [],
    });

    test('detects goal_setting via artifact presence', () => {
      const snapshot = baseSnapshot();
      snapshot.json['goal-setting.json'] = { goal: 'refactor' };

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_setting).toBe(true);
    });

    test('detects goal_setting via metadata duration', () => {
      const result = detectPhaseReached(baseSnapshot(), { goal_setting_duration_seconds: 5.2 }, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_setting).toBe(true);
    });

    test('detects goal_setting via stage rows', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [{ stage: 'Goal Setting' }], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_setting).toBe(true);
    });

    test('detects scouting via artifact presence', () => {
      const snapshot = baseSnapshot();
      snapshot.json['scouting.json'] = { scope: 'narrow' };

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.scouting).toBe(true);
    });

    test('detects scouting via metadata duration', () => {
      const result = detectPhaseReached(baseSnapshot(), { scouting_duration_seconds: 3.1 }, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.scouting).toBe(true);
    });

    test('detects scouting via stage rows', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [{ stage: 'Scouting' }], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.scouting).toBe(true);
    });

    test('detects coding via pi-summary artifact', () => {
      const snapshot = baseSnapshot();
      snapshot.json['pi-summary.json'] = { model: 'gpt-4' };

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.coding).toBe(true);
    });

    test('detects coding via pi-events artifact', () => {
      const snapshot = baseSnapshot();
      snapshot.text['pi-events.jsonl'] = '{}';

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.coding).toBe(true);
    });

    test('detects coding via git diff presence', () => {
      const snapshot = baseSnapshot();
      snapshot.text['git.diff'] = '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@';

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.coding).toBe(true);
    });

    test('detects coding via noChangeAccepted flag', () => {
      const snapshot = baseSnapshot();
      // No artifacts, no diff, but flag is set

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: true,
        executedValidationRowsCount: 0,
      });

      expect(result.coding).toBe(true);
    });

    test('detects coding via stage rows', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [{ stage: 'Pi Coding Agent' }], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.coding).toBe(true);
    });

    test('detects validation via executed rows count', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 3,
      });

      expect(result.validation).toBe(true);
    });

    test('detects validation via metadata commands attempted', () => {
      const result = detectPhaseReached(baseSnapshot(), { validation_commands_attempted: 2 }, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.validation).toBe(true);
    });

    test('detects validation via non-zero exit code', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
        validationExitCode: 1,
      });

      expect(result.validation).toBe(true);
    });

    test('detects goal_check via artifact presence', () => {
      const snapshot = baseSnapshot();
      snapshot.json['goal-check.json'] = { met: true };

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_check).toBe(true);
    });

    test('detects goal_check via metadata duration', () => {
      const result = detectPhaseReached(baseSnapshot(), { goal_check_duration_seconds: 4.5 }, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_check).toBe(true);
    });

    test('detects goal_check via failed_command metadata', () => {
      const result = detectPhaseReached(baseSnapshot(), { failed_command: 'goal check' }, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_check).toBe(true);
    });

    test('detects goal_check via failure reason metadata', () => {
      const result = detectPhaseReached(baseSnapshot(), { goal_check_failure_reason: 'goal not met' }, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_check).toBe(true);
    });

    test('detects goal_check via stage rows', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [{ stage: 'Goal Check' }], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_check).toBe(true);
    });

    test('detects run_evaluation via evaluation object', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [], {
        evaluation: { score: 0.85 },
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.run_evaluation).toBe(true);
    });

    test('detects run_evaluation via metadata duration', () => {
      const result = detectPhaseReached(baseSnapshot(), { run_evaluation_duration_seconds: 2.3 }, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.run_evaluation).toBe(true);
    });

    test('detects run_evaluation via evaluatorFailed flag', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [], {
        evaluatorFailed: true,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.run_evaluation).toBe(true);
    });

    test('detects run_evaluation via stage rows', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [{ stage: 'Run Evaluation' }], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.run_evaluation).toBe(true);
    });

    test('returns false for all phases when no signals present', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result).toEqual({
        goal_setting: false,
        scouting: false,
        coding: false,
        validation: false,
        goal_check: false,
        run_evaluation: false,
      });
    });

    test('handles non-object stage row gracefully', () => {
      const result = detectPhaseReached(baseSnapshot(), {}, [null, undefined, 'string', 123], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_setting).toBe(false);
    });

    test('handles undefined metadata gracefully', () => {
      const result = detectPhaseReached(baseSnapshot(), undefined as any, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.goal_setting).toBe(false);
    });

    test('ignores whitespace-only git diff', () => {
      const snapshot = baseSnapshot();
      snapshot.text['git.diff'] = '   \n  \t  \n  ';

      const result = detectPhaseReached(snapshot, {}, [], {
        evaluatorFailed: false,
        noChangeAccepted: false,
        executedValidationRowsCount: 0,
      });

      expect(result.coding).toBe(false);
    });
  });

  describe('detectPhaseFailures', () => {
    test('detects goal_setting failure via failure object', () => {
      const result = detectPhaseFailures({}, { goal_setting_exit_code: 1 }, false);
      expect(result.goal_setting).toBe(true);
    });

    test('detects goal_setting failure via metadata', () => {
      const result = detectPhaseFailures({ goal_setting_exit_code: 2 }, {}, false);
      expect(result.goal_setting).toBe(true);
    });

    test('prefers failure object over metadata', () => {
      const result = detectPhaseFailures(
        { goal_setting_exit_code: 0 },
        { goal_setting_exit_code: 1 },
        false,
      );
      expect(result.goal_setting).toBe(true);
    });

    test('passes goal_setting when exit code is 0', () => {
      const result = detectPhaseFailures(
        { goal_setting_exit_code: 0 },
        { goal_setting_exit_code: 0 },
        false,
      );
      expect(result.goal_setting).toBe(false);
    });

    test('detects scouting failure', () => {
      const result = detectPhaseFailures({}, { scouting_exit_code: 127 }, false);
      expect(result.scouting).toBe(true);
    });

    test('detects scouting pass', () => {
      const result = detectPhaseFailures({ scouting_exit_code: 0 }, {}, false);
      expect(result.scouting).toBe(false);
    });

    test('detects coding failure', () => {
      const result = detectPhaseFailures({}, { pi_exit_code: 124 }, false);
      expect(result.coding).toBe(true);
    });

    test('detects coding pass', () => {
      const result = detectPhaseFailures({ pi_exit_code: 0 }, {}, false);
      expect(result.coding).toBe(false);
    });

    test('detects validation failure', () => {
      const result = detectPhaseFailures({}, { validation_exit_code: 1 }, false);
      expect(result.validation).toBe(true);
    });

    test('detects validation pass', () => {
      const result = detectPhaseFailures({ validation_exit_code: 0 }, {}, false);
      expect(result.validation).toBe(false);
    });

    test('detects goal_check failure', () => {
      const result = detectPhaseFailures({}, { goal_check_exit_code: 88 }, false);
      expect(result.goal_check).toBe(true);
    });

    test('detects goal_check pass', () => {
      const result = detectPhaseFailures({ goal_check_exit_code: 0 }, {}, false);
      expect(result.goal_check).toBe(false);
    });

    test('detects run_evaluation failure via exit code', () => {
      const result = detectPhaseFailures({}, { run_evaluation_exit_code: 1 }, false);
      expect(result.run_evaluation).toBe(true);
    });

    test('detects run_evaluation failure via evaluatorFailed flag', () => {
      const result = detectPhaseFailures({}, {}, true);
      expect(result.run_evaluation).toBe(true);
    });

    test('detects run_evaluation pass when both exit code and flag are false', () => {
      const result = detectPhaseFailures({ run_evaluation_exit_code: 0 }, {}, false);
      expect(result.run_evaluation).toBe(false);
    });

    test('handles missing exit codes as success (defaults to 0)', () => {
      const result = detectPhaseFailures({}, {}, false);
      expect(result).toEqual({
        goal_setting: false,
        scouting: false,
        coding: false,
        validation: false,
        goal_check: false,
        run_evaluation: false,
      });
    });

    test('handles non-numeric exit codes gracefully', () => {
      const result = detectPhaseFailures(
        { goal_setting_exit_code: 'invalid' },
        { scouting_exit_code: null },
        false,
      );
      expect(result.goal_setting).toBe(false);
      expect(result.scouting).toBe(false);
    });

    test('treats non-zero exit codes as failures', () => {
      const result = detectPhaseFailures(
        {
          goal_setting_exit_code: 1,
          scouting_exit_code: 127,
          pi_exit_code: 124,
          validation_exit_code: 42,
          goal_check_exit_code: 88,
        },
        {},
        false,
      );
      expect(Object.values(result)).toEqual([true, true, true, true, true, false]);
    });
  });
});
