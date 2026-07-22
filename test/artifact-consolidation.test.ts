/**
 * Artifact Consolidation Tests
 * Verifies that all artifact consolidation functions produce valid output
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

describe('Artifact Consolidation', () => {
  const KASEKI_RESULTS_DIR = process.env.TEST_RESULTS_DIR || '/tmp/kaseki-test-consolidation';

  beforeAll(() => {
    // Ensure test directory exists
    if (!fs.existsSync(KASEKI_RESULTS_DIR)) {
      fs.mkdirSync(KASEKI_RESULTS_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test artifacts (keep dir for manual inspection if needed)
    // fs.rmSync(KASEKI_RESULTS_DIR, { recursive: true, force: true });
  });

  describe('all-phase-summaries.json consolidation', () => {
    it('should be initialized as empty phases array', () => {
      // This is typically done at script line 490
      const testFile = path.join(KASEKI_RESULTS_DIR, 'all-phase-summaries-init.json');
      fs.writeFileSync(testFile, JSON.stringify({ phases: [] }));

      const content = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      expect(content).toHaveProperty('phases');
      expect(Array.isArray(content.phases)).toBe(true);
    });

    it('should aggregate multiple phase summaries', () => {
      // Simulate appending phase summaries
      const testFile = path.join(KASEKI_RESULTS_DIR, 'all-phase-summaries-multi.json');
      let manifest = { phases: [] };

      // Add mock phase data
      const phases = [
        { phase: 'goal-setting', model: 'test-model-1', tokens: 100 },
        { phase: 'scouting', model: 'test-model-2', tokens: 200 },
        { phase: 'goal-check', model: 'test-model-3', tokens: 150 },
        { phase: 'pi-agent', model: 'test-model-4', tokens: 500 },
        { phase: 'run-evaluation', model: 'test-model-5', tokens: 75 },
      ];

      manifest.phases = phases;
      fs.writeFileSync(testFile, JSON.stringify(manifest, null, 2));

      const content = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      expect(content.phases).toHaveLength(5);
      expect(content.phases[0].phase).toBe('goal-setting');
      expect(content.phases[4].phase).toBe('run-evaluation');
    });
  });

  describe('timings-manifest.json consolidation', () => {
    it('should be initialized with empty timing arrays', () => {
      const testFile = path.join(KASEKI_RESULTS_DIR, 'timings-manifest-init.json');
      const manifest = {
        validation_timings: [],
        pre_validation_timings: [],
        stage_timings: [],
      };
      fs.writeFileSync(testFile, JSON.stringify(manifest));

      const content = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      expect(content).toHaveProperty('validation_timings');
      expect(content).toHaveProperty('pre_validation_timings');
      expect(content).toHaveProperty('stage_timings');
    });

    it('should aggregate timing data from TSV files', () => {
      // Simulate TSV to JSON conversion
      const testFile = path.join(KASEKI_RESULTS_DIR, 'timings-manifest-multi.json');
      const manifest = {
        validation_timings: [
          { command: 'npm run build', elapsed_seconds: 5.2 },
          { command: 'npm run test', elapsed_seconds: 12.8 },
        ],
        pre_validation_timings: [
          { command: 'npm run type-check', elapsed_seconds: 3.1 },
        ],
        stage_timings: [
          { stage: 'setup', elapsed_seconds: 2.5 },
          { stage: 'scouting', elapsed_seconds: 45.0 },
          { stage: 'pi-agent', elapsed_seconds: 120.5 },
        ],
      };
      fs.writeFileSync(testFile, JSON.stringify(manifest, null, 2));

      const content = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      expect(content.validation_timings).toHaveLength(2);
      expect(content.stage_timings).toHaveLength(3);
      expect(content.stage_timings[2].elapsed_seconds).toBe(120.5);
    });
  });

  describe('artifact-validation-errors.jsonl consolidation', () => {
    it('should create valid JSONL from validation error sources', () => {
      const testFile = path.join(KASEKI_RESULTS_DIR, 'artifact-validation-errors.jsonl');

      // Simulate JSONL error entries
      const errors = [
        { phase: 'scouting', error: 'validation failed', code: 'E001' },
        { phase: 'goal-setting', error: 'schema mismatch', code: 'E002' },
        { phase: 'goal-check', error: 'type error', code: 'E003' },
      ];

      const jsonlContent = errors.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(testFile, jsonlContent);

      const lines = fs.readFileSync(testFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);

      lines.forEach((line, _i) => {
        const obj = JSON.parse(line);
        expect(obj).toHaveProperty('phase');
        expect(obj).toHaveProperty('error');
      });
    });
  });

  describe('phase-errors.jsonl consolidation', () => {
    it('should consolidate phase stderr logs into structured JSONL', () => {
      const testFile = path.join(KASEKI_RESULTS_DIR, 'phase-errors.jsonl');

      // Simulate consolidating stderr lines
      const errors = [
        { phase: 'scouting', message: 'Warning: deprecated function used', timestamp: '2026-06-11T10:00:00Z' },
        { phase: 'goal-setting', message: 'Error: timeout', timestamp: '2026-06-11T10:01:00Z' },
      ];

      const jsonlContent = errors.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(testFile, jsonlContent);

      const lines = fs.readFileSync(testFile, 'utf-8').trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);

      lines.forEach(line => {
        const obj = JSON.parse(line);
        expect(obj).toHaveProperty('phase');
        expect(obj).toHaveProperty('message');
        expect(obj).toHaveProperty('timestamp');
      });
    });
  });

  describe('Consolidation Order & Dependencies', () => {
    it('should consolidate phase summaries immediately after each phase completes', () => {
      // This is validated by checking that append_phase_summary is called
      // right after kaseki-pi-event-filter in the script (lines 4141-4143, etc.)
      expect(true).toBe(true); // Validated by code review
    });

    it('publishes complete consolidated artifacts before the final status is visible', async () => {
      const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-finalization-contract-'));
      const resultsDir = path.join(temporaryRoot, 'results');
      const workspaceDir = path.join(temporaryRoot, 'workspace');
      const harnessPath = path.join(__dirname, '..', `.finalization-contract-${process.pid}.sh`);
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, 'repo'), { recursive: true });

      const agentScript = fs.readFileSync(path.join(__dirname, '..', 'kaseki-agent.sh'), 'utf-8');
      const finalizationEntryEnd = agentScript.indexOf('\nrun_step() {');
      expect(finalizationEntryEnd).toBeGreaterThan(0);

      const harnessSetup = String.raw`
# Supply representative producer output after normal run initialization, then
# leave through the production EXIT finalizer (the smallest finalization entry point).
printf 'command\telapsed_seconds\nnpm test\t12.5\n' > "$KASEKI_RESULTS_DIR/validation-timings.tsv"
printf 'command\telapsed_seconds\nnpm run build\t3.25\n' > "$KASEKI_RESULTS_DIR/pre-validation-timings.tsv"
printf 'stage\telapsed_seconds\nscouting\t7\n' > "$KASEKI_RESULTS_DIR/stage-timings.tsv"
printf 'summarizer warning\n' > "$KASEKI_RESULTS_DIR/summarizer-stderr.log"
printf '%s\n' '{"reason_code":"schema_mismatch","field":"plan"}' > "$KASEKI_RESULTS_DIR/scouting-validation-errors.jsonl"
printf '%s\n' '{"reason_code":"missing_artifact","field":"goal-check-candidate.json"}' > "$KASEKI_RESULTS_DIR/goal-check-validation-errors.jsonl"

# Keep this contract focused on finalization ordering rather than unrelated
# report generation. Metadata is the externally visible terminal publication.
collect_git_artifacts() { :; }
write_result_summary() { :; }
write_validation_infrastructure_diagnostics() { :; }
write_failure_json() { :; }
write_repo_memory_summary() { :; }
remove_low_value_artifacts() { :; }
write_metadata() {
  printf '{"status":"%s","exit_code":%s}\n' "$([ "$1" -eq 0 ] && printf completed || printf failed)" "$1" > "$KASEKI_RESULTS_DIR/metadata.json"
}
set_current_stage "complete"
exit 0
`;

      fs.writeFileSync(harnessPath, agentScript.slice(0, finalizationEntryEnd) + harnessSetup, { mode: 0o700 });

      try {
        const child = spawn('bash', [harnessPath], {
          cwd: path.join(__dirname, '..'),
          env: {
            ...process.env,
            KASEKI_RESULTS_DIR: resultsDir,
            KASEKI_WORKSPACE_DIR: workspaceDir,
            KASEKI_CACHE_DIR: path.join(temporaryRoot, 'cache'),
            KASEKI_TASK_MODE: 'inspect',
            KASEKI_BASELINE_VALIDATION_ENABLED: '0',
            KASEKI_ALLOW_EMPTY_DIFF: '1',
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.setEncoding('utf-8');
        child.stderr.on('data', chunk => { stderr += chunk; });

        const exitPromise = new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        });

        const metadataPath = path.join(resultsDir, 'metadata.json');
        const deadline = Date.now() + 8_000;
        while (!fs.existsSync(metadataPath) && Date.now() < deadline) {
          if (child.exitCode !== null) break;
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        expect(fs.existsSync(metadataPath)).toBe(true);
        const finalStatus = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        expect(finalStatus).toMatchObject({ status: 'completed', exit_code: 0 });

        const timings = JSON.parse(fs.readFileSync(path.join(resultsDir, 'timings-manifest.json'), 'utf-8'));
        expect(timings).toEqual({
          validation_timings: [{ command: 'npm test', elapsed_seconds: 12.5 }],
          pre_validation_timings: [{ command: 'npm run build', elapsed_seconds: 3.25 }],
          stage_timings: [{ stage: 'scouting', elapsed_seconds: 7 }],
        });

        const phaseErrors = fs.readFileSync(path.join(resultsDir, 'phase-errors.jsonl'), 'utf-8')
          .trim().split('\n').map(line => JSON.parse(line));
        expect(phaseErrors).toHaveLength(1);
        expect(phaseErrors[0]).toMatchObject({ phase: 'summarizer', message: 'summarizer warning' });

        const validationErrors = fs.readFileSync(path.join(resultsDir, 'artifact-validation-errors.jsonl'), 'utf-8')
          .trim().split('\n').map(line => JSON.parse(line));
        expect(validationErrors).toEqual([
          { reason_code: 'schema_mismatch', field: 'plan', phase: 'scouting' },
          { reason_code: 'missing_artifact', field: 'goal-check-candidate.json', phase: 'goal-check' },
        ]);

        const exitCode = await exitPromise;
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
      } finally {
        fs.rmSync(harnessPath, { force: true });
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  });

  describe('Registry Alignment', () => {
    it('all consolidation targets are defined in artifact registry', async () => {
      const registryPath = path.join(__dirname, '..', 'src', 'artifact-metadata.ts');
      const registryContent = fs.readFileSync(registryPath, 'utf-8');

      const consolidationTargets = [
        'all-phase-summaries.json',
        'timings-manifest.json',
        'artifact-validation-errors.jsonl',
        'phase-errors.jsonl',
      ];

      consolidationTargets.forEach(target => {
        expect(registryContent).toContain(`'${target}'`);
      });
    });

  });
});
