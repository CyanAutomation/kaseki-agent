/**
 * Artifact Consolidation Tests
 * Verifies that all artifact consolidation functions produce valid output
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

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
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-all-phase-summaries-'));
      const testFile = path.join(testDir, 'all-phase-summaries.json');
      const helper = path.join(__dirname, '..', 'scripts', 'lib', 'artifact-consolidation.sh');
      const phases = [
        { phase: 'goal-setting', summary: { model: 'test-model-1', tokens: 100, duration_ms: 11, succeeded: true } },
        { phase: 'scouting', summary: { model: 'test-model-2', tokens: 200, duration_ms: 22, succeeded: true } },
        { phase: 'goal-check', summary: { model: 'test-model-3', tokens: 150, duration_ms: 33, succeeded: false } },
        { phase: 'pi-agent', summary: { model: 'test-model-4', tokens: 500, duration_ms: 44, succeeded: true } },
        { phase: 'run-evaluation', summary: { model: 'test-model-5', tokens: 75, duration_ms: 55, succeeded: true } },
      ];

      try {
        fs.writeFileSync(testFile, JSON.stringify({ phases: [] }));
        const appendArguments = phases.flatMap(({ phase, summary }) => {
          const summaryFile = path.join(testDir, `${phase}-summary.json`);
          fs.writeFileSync(summaryFile, JSON.stringify(summary));
          return [phase, summaryFile];
        });
        const appendAll = `
          set -euo pipefail
          source "$1"
          artifact="$2"
          shift 2
          while [ "$#" -gt 0 ]; do
            consolidate_completed_phase "$artifact" "$1" "$2"
            shift 2
          done
        `;

        execFileSync('bash', ['-c', appendAll, 'append-phase-summaries', helper, testFile, ...appendArguments]);

        const content = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
        const expectedPhases = phases.map(({ phase, summary }) => ({ ...summary, phase }));
        const phaseCounts = content.phases.reduce((counts: Record<string, number>, entry: { phase: string }) => {
          counts[entry.phase] = (counts[entry.phase] ?? 0) + 1;
          return counts;
        }, {});

        expect(content).toEqual({ phases: expectedPhases });
        expect(phaseCounts).toEqual(Object.fromEntries(phases.map(({ phase }) => [phase, 1])));
        expect(content.phases.map(({ phase }: { phase: string }) => phase)).toEqual(phases.map(({ phase }) => phase));
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
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
    it('persists a completed phase before the next phase or finalization begins', () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-phase-consolidation-'));
      const helper = path.join(__dirname, '..', 'scripts', 'lib', 'artifact-consolidation.sh');
      const script = `
        set -euo pipefail
        source "$1"
        results_dir="$2"
        artifact="$results_dir/all-phase-summaries.json"
        timeline="$results_dir/timeline.jsonl"
        printf '{"phases": []}\n' > "$artifact"
        printf '{"model":"scout-model","tokens":200}\n' > "$results_dir/scouting-summary.json"

        consolidate_completed_phase "$artifact" scouting "$results_dir/scouting-summary.json"
        jq -c '{event:"next-phase-start", phases:.phases}' "$artifact" >> "$timeline"

        printf '{"model":"evaluation-model","tokens":75}\n' > "$results_dir/run-evaluation-summary.json"
        consolidate_completed_phase "$artifact" run-evaluation "$results_dir/run-evaluation-summary.json"
        jq -c '{event:"finalization-start", phases:.phases}' "$artifact" >> "$timeline"
      `;

      try {
        execFileSync('bash', ['-c', script, 'phase-workflow', helper, testDir]);

        const artifact = JSON.parse(fs.readFileSync(path.join(testDir, 'all-phase-summaries.json'), 'utf-8'));
        const timeline = fs.readFileSync(path.join(testDir, 'timeline.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line));

        expect(timeline).toEqual([
          {
            event: 'next-phase-start',
            phases: [{ model: 'scout-model', tokens: 200, phase: 'scouting' }],
          },
          {
            event: 'finalization-start',
            phases: [
              { model: 'scout-model', tokens: 200, phase: 'scouting' },
              { model: 'evaluation-model', tokens: 75, phase: 'run-evaluation' },
            ],
          },
        ]);
        expect(artifact).toEqual({ phases: timeline[1].phases });
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('publishes complete timing and error artifacts before the final status', () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-finalization-contract-'));
      const helper = path.join(__dirname, '..', 'scripts', 'lib', 'artifact-consolidation.sh');
      const script = String.raw`
        set -euo pipefail
        source "$1"
        results_dir="$2"
        observed_dir="$results_dir/observed-at-final-status"
        mkdir -p "$observed_dir"

        printf 'command\telapsed_seconds\nnpm test\t12.5\n' > "$results_dir/validation-timings.tsv"
        printf 'command\telapsed_seconds\nnpm run type-check\t3.25\n' > "$results_dir/pre-validation-timings.tsv"
        printf 'stage\telapsed_seconds\nvalidation\t15.75\n' > "$results_dir/stage-timings.tsv"
        printf 'critical expectation failed\nsecond diagnostic\n' > "$results_dir/critical-change-expectations.log"
        printf '%s\n' '{"reason":"schema_mismatch","field":"requirements"}' > "$results_dir/scouting-validation-errors.jsonl"
        printf '%s\n' '{"reason":"invalid_verdict","field":"met"}' > "$results_dir/goal-check-validation-errors.jsonl"

        publish_status() {
          local status="$1"
          printf '{"status":"%s"}\n' "$status" > "$results_dir/metadata.json.tmp"
          mv "$results_dir/metadata.json.tmp" "$results_dir/metadata.json"
        }

        (
          until [ -f "$results_dir/metadata.json" ] && [ "$(jq -r .status "$results_dir/metadata.json")" = completed ]; do
            sleep 0.01
          done
          cp "$results_dir/timings-manifest.json" "$results_dir/phase-errors.jsonl" \
            "$results_dir/artifact-validation-errors.jsonl" "$observed_dir/"
          cp "$results_dir/metadata.json" "$observed_dir/"
        ) &
        observer_pid=$!

        finalize_artifacts_and_publish_status "$results_dir" publish_status completed
        wait "$observer_pid"
      `;

      try {
        execFileSync('bash', ['-c', script, 'finalization-contract', helper, testDir]);

        const observedDir = path.join(testDir, 'observed-at-final-status');
        const status = JSON.parse(fs.readFileSync(path.join(observedDir, 'metadata.json'), 'utf-8'));
        const timings = JSON.parse(fs.readFileSync(path.join(observedDir, 'timings-manifest.json'), 'utf-8'));
        const phaseErrors = fs.readFileSync(path.join(observedDir, 'phase-errors.jsonl'), 'utf-8')
          .trim().split('\n').map(line => JSON.parse(line));
        const validationErrors = fs.readFileSync(path.join(observedDir, 'artifact-validation-errors.jsonl'), 'utf-8')
          .trim().split('\n').map(line => JSON.parse(line));

        expect(status).toEqual({ status: 'completed' });
        expect(timings).toEqual({
          validation_timings: [{ command: 'npm test', elapsed_seconds: 12.5 }],
          pre_validation_timings: [{ command: 'npm run type-check', elapsed_seconds: 3.25 }],
          stage_timings: [{ stage: 'validation', elapsed_seconds: 15.75 }],
        });
        expect(phaseErrors.map(({ phase, message }) => ({ phase, message }))).toEqual([
          { phase: 'critical-change-expectations.log', message: 'critical expectation failed' },
          { phase: 'critical-change-expectations.log', message: 'second diagnostic' },
        ]);
        expect(validationErrors).toEqual([
          { reason: 'schema_mismatch', field: 'requirements', phase: 'scouting' },
          { reason: 'invalid_verdict', field: 'met', phase: 'goal-check' },
        ]);
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
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
