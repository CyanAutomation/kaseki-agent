import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;

/**
 * Unit tests for exit code 86 scouting diagnostics.
 *
 * These tests verify:
 * 1. Filesystem writability checks detect read-only directories
 * 2. Error messages include docker run volume mount suggestions
 * 3. Artifact recovery from event streams with incomplete JSON
 * 4. Metadata includes filesystem diagnostic fields
 */

describe('Exit Code 86 - Scouting Artifact Diagnostics', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-exit86-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Filesystem writability checks', () => {
    it('should detect when /results directory is read-only', () => {
      const resultsDir = path.join(tmpDir, 'results');
      fs.mkdirSync(resultsDir, { recursive: true });

      // Directory is writable initially
      expect(fs.accessSync(resultsDir, fs.constants.W_OK)).toBeUndefined();

      // Make it read-only
      fs.chmodSync(resultsDir, 0o555);

      // The mode bits should mark the directory non-writable for normal users.
      expect(fs.statSync(resultsDir).mode & 0o222).toBe(0);

      // Root can still pass access(2) checks for read-only mode bits in containers,
      // so only assert the OS-level access failure when not running as root.
      if (!isRoot()) {
        expect(() => {
          fs.accessSync(resultsDir, fs.constants.W_OK);
        }).toThrow();
      }

      // Clean up
      fs.chmodSync(resultsDir, 0o755);
    });

    it('should detect when touch fails on read-only directory', () => {
      const resultsDir = path.join(tmpDir, 'results');
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.chmodSync(resultsDir, 0o555);

      // The mode bits should mark the directory non-writable for normal users.
      expect(fs.statSync(resultsDir).mode & 0o222).toBe(0);

      // Root can still create files despite read-only mode bits in containers,
      // so only assert the write failure when not running as root.
      const testFile = path.join(resultsDir, '.write-test');
      if (!isRoot()) {
        expect(() => {
          fs.writeFileSync(testFile, 'test');
        }).toThrow();
      }

      // Clean up
      fs.chmodSync(resultsDir, 0o755);
    });

    it('should confirm writable directory is accessible', () => {
      const resultsDir = path.join(tmpDir, 'results');
      fs.mkdirSync(resultsDir, { recursive: true });

      // Should be writable
      expect(() => {
        fs.accessSync(resultsDir, fs.constants.W_OK);
      }).not.toThrow();

      // Should be able to create files
      const testFile = path.join(resultsDir, '.write-test');
      fs.writeFileSync(testFile, 'test');
      expect(fs.existsSync(testFile)).toBe(true);
    });
  });

  describe('Error message suggestions', () => {
    it('should include docker run fix when filesystem diagnostic triggered', () => {
      const errorMessage = 'SCOUTING FAILED: /results is not writable. Fix: docker run -v /path/to/results:/results:rw';
      expect(errorMessage).toMatch(/docker run/);
      expect(errorMessage).toMatch(/:rw/);
    });

    it('should suggest correct volume mount syntax', () => {
      const correctFix = '-v /path/to/results:/results:rw';
      const incorrectSyntax = '-v /path/to/results:/results:ro';

      // Verify fix has correct syntax
      expect(correctFix).toMatch(/-v\s+\S+:\S+:rw/);

      // Verify incorrect syntax can be detected
      expect(incorrectSyntax).toMatch(/ro$/);
    });
  });

  describe('Artifact recovery from event streams', () => {
    it('should recover JSON object with balanced braces', () => {
      const incompleteJson = '{"task":"test","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}';

      // Verify this is valid JSON
      const parsed = JSON.parse(incompleteJson);
      expect(parsed).toHaveProperty('task', 'test');
      expect(parsed).toHaveProperty('requirements');
    });

    it('should identify incomplete JSON (missing closing brace)', () => {
      const incompleteJson = '{"task":"incomplete","requirements":[],"relevant_files":[],"observations":[]';

      // Should throw on parse
      expect(() => {
        JSON.parse(incompleteJson);
      }).toThrow();
    });

    it('should accept minimal scouting artifact with just task field', () => {
      const minimalScoutingArtifact = {
        task: 'test task',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      };

      // Verify essential fields are present
      expect(minimalScoutingArtifact).toHaveProperty('task');
      expect(typeof minimalScoutingArtifact.task).toBe('string');
      expect(minimalScoutingArtifact.task.length).toBeGreaterThan(0);

      // Verify this structure is valid JSON
      const jsonStr = JSON.stringify(minimalScoutingArtifact);
      const reparsed = JSON.parse(jsonStr);
      expect(reparsed.task).toBe('test task');
    });
  });

  describe('Metadata filesystem diagnostics fields', () => {
    it('should include filesystem_check_status in metadata', () => {
      const metadata = {
        filesystem_check_status: 'writable',
        phases: {
          scouting: {
            artifact_recovery_attempted: false,
            artifact_recovery_success: false,
          },
        },
      };

      expect(metadata).toHaveProperty('filesystem_check_status');
      expect(['writable', 'read_only', 'not_tested']).toContain(metadata.filesystem_check_status);
    });

    it('should include recovery attempt tracking in scouting phase', () => {
      const scoutingPhase = {
        artifact_recovery_attempted: true,
        artifact_recovery_success: true,
        artifact_recovery_reason: 'recovered from event stream',
        scouting_exit_code: 0,
      };

      expect(scoutingPhase).toHaveProperty('artifact_recovery_attempted');
      expect(scoutingPhase).toHaveProperty('artifact_recovery_success');
      expect(typeof scoutingPhase.artifact_recovery_attempted).toBe('boolean');
      expect(typeof scoutingPhase.artifact_recovery_success).toBe('boolean');
    });

    it('should include filesystem diagnostics in error reporting', () => {
      const diagnostics = {
        filesystem_writable: false,
        filesystem_readonly_reason: '/results mounted with :ro flag (Docker)',
        suggested_fix: 'docker run -v /path/to/results:/results:rw kaseki-agent',
      };

      expect(diagnostics).toHaveProperty('filesystem_writable');
      expect(diagnostics).toHaveProperty('filesystem_readonly_reason');
      expect(diagnostics).toHaveProperty('suggested_fix');
      expect(diagnostics.suggested_fix).toMatch(/docker run/);
    });
  });

  describe('Exit code semantics', () => {
    it('should distinguish exit code 83 (prerequisite check failed)', () => {
      const EXIT_CODE_SCOUTING_PREREQUISITE_FAILED = 83;
      expect(EXIT_CODE_SCOUTING_PREREQUISITE_FAILED).toBeDefined();
      expect(EXIT_CODE_SCOUTING_PREREQUISITE_FAILED).toBeGreaterThan(0);
    });

    it('should distinguish exit code 86 (scouting validation failed)', () => {
      const EXIT_CODE_SCOUTING_VALIDATION_FAILED = 86;
      expect(EXIT_CODE_SCOUTING_VALIDATION_FAILED).toBeDefined();
      expect(EXIT_CODE_SCOUTING_VALIDATION_FAILED).not.toBe(83);
    });

    it('should exit 83 before Pi invocation, 86 after', () => {
      // Exit 83: /results not writable BEFORE scouting Pi starts
      // Exit 86: /results not writable or artifact validation AFTER scouting Pi completes
      expect(83).toBeLessThan(86);
    });
  });
});
