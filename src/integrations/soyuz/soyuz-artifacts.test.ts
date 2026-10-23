import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { artifactIdForSoyuzFile, loadSoyuzArtifacts, loadSoyuzTerminalOutcome } from './soyuz-artifacts';

describe('Soyuz artifact selection', () => {
  let resultDir: string;

  beforeEach(async () => {
    resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-soyuz-artifacts-'));
  });

  afterEach(async () => {
    await fs.rm(resultDir, { recursive: true, force: true });
  });

  test('selects only allowlisted bounded artifacts and derives stable run-scoped IDs', async () => {
    await fs.writeFile(path.join(resultDir, 'result-summary.md'), '# Done\n');
    await fs.writeFile(path.join(resultDir, 'failure.json'), '{"failureClass":"validation"}\n');
    await fs.writeFile(path.join(resultDir, 'git.diff'), 'diff --git a/src/a.ts b/src/a.ts\n');
    await fs.writeFile(path.join(resultDir, 'changed-files.txt'), 'src/a.ts\nsrc/b.ts\n');
    await fs.writeFile(path.join(resultDir, 'run-scorecard.json'), '{"overall_score":72}\n');
    await fs.writeFile(path.join(resultDir, 'run-evaluation.json'), '{"task_completion_score":3}\n');
    await fs.writeFile(path.join(resultDir, 'stdout.log'), 'must remain on the host');

    const result = await loadSoyuzArtifacts(RUN_ID, resultDir);

    expect(result.artifacts.map(({ name }) => name)).toEqual([
      'result-summary.md', 'failure.json', 'git.diff', 'changed-files.txt', 'run-scorecard.json', 'run-evaluation.json',
    ]);
    expect(result.artifacts[0].artifactId).toBe(artifactIdForSoyuzFile(RUN_ID, 'result-summary.md'));
    expect(artifactIdForSoyuzFile(RUN_ID, 'result-summary.md')).toBe(artifactIdForSoyuzFile(RUN_ID, 'result-summary.md'));
    expect(result.artifacts[0].kind).toBe('report');
    expect(result.artifacts[1].contentType).toBe('application/json');
    expect(result.artifacts[3].kind).toBe('report');
    expect(result.artifacts[4].contentType).toBe('application/json');
  });

  test('ignores symlinks and files above the upload limit', async () => {
    await fs.symlink('/etc/passwd', path.join(resultDir, 'result-summary.md'));
    await fs.writeFile(path.join(resultDir, 'git.diff'), '');
    await fs.writeFile(path.join(resultDir, 'failure.json'), '{}');
    await fs.truncate(path.join(resultDir, 'failure.json'), 2_000_001);

    const result = await loadSoyuzArtifacts(RUN_ID, resultDir);

    expect(result.artifacts).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'result-summary.md', reason: 'unsafe_file' }),
      expect.objectContaining({ name: 'failure.json', reason: 'too_large' }),
    ]));
  });

  test('extracts only bounded terminal fields and strips URL query and fragment data', async () => {
    await fs.writeFile(path.join(resultDir, 'result-summary.md'), '  Run completed safely.  \n');
    await fs.writeFile(path.join(resultDir, 'metadata.json'), JSON.stringify({
      github_pr_url: 'https://github.com/example/project/pull/7?token=private#details',
      task_prompt: 'Do not forward this prompt',
    }));
    await fs.writeFile(path.join(resultDir, 'changed-files.txt'), 'src/a.ts\nsrc/b.ts\nsrc/a.ts\n');

    await expect(loadSoyuzTerminalOutcome(resultDir)).resolves.toEqual({
      summary: 'Run completed safely.',
      publishedUrl: 'https://github.com/example/project/pull/7',
      changedFileCount: 2,
    });
  });
});

const RUN_ID = '11111111-1111-4111-8111-111111111111';
