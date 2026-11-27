import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadOrCreatePublicationManifest,
  parseGitHubRepository,
} from './publication-manifest';

const RUN_ID = '019a6000-0000-7000-8000-000000000002';
const REPO_URL = 'https://github.com/CyanAutomation/demo-app.git';

describe('Kirisame v1 publication manifest contract', () => {
  test('matches the shared Kirisame and Soyuz fixture fields and canonical digest', async () => {
    const fixture = JSON.parse(fsSync.readFileSync(path.join(process.cwd(), 'tests/fixtures/kirisame-publication-request-v1.json'), 'utf8')) as {
      value: { artifact: Record<string, any>; artifactDigest: string };
    };
    const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-kirisame-valid-contract-'));
    try {
      await writeStoredManifest(resultDir, fixture.value.artifact, fixture.value.artifactDigest);
      const validated = await loadOrCreatePublicationManifest(resultDir, fixtureInput(fixture.value.artifact));

      expect(validated.artifactDigest).toBe(fixture.value.artifactDigest);
      expect(validated.artifactDigest).toBe('sha256:0431e0e1ee61b9b2c10cdced895c6c879f168b47a8527c4732ceccae2a94dd10');
      expect(Object.keys(validated.artifact).sort()).toEqual([
        'artifactId', 'baseRef', 'baseSha', 'contractVersion', 'fileCount', 'files', 'repository', 'runId', 'totalBytes',
      ]);
    } finally {
      await fs.rm(resultDir, { recursive: true, force: true });
    }
  });

  test.each([
    ['path traversal', (artifact: Record<string, any>) => { artifact.files[0].path = '../escape.txt'; }],
    ['workflow path', (artifact: Record<string, any>) => { artifact.files[0].path = '.github/workflows/release.yml'; }],
    ['Git attributes path', (artifact: Record<string, any>) => { artifact.files[0].path = 'docs/.GITATTRIBUTES'; }],
    ['Windows device name', (artifact: Record<string, any>) => { artifact.files[0].path = 'CON.txt'; }],
    ['trailing dot path', (artifact: Record<string, any>) => { artifact.files[0].path = 'docs/bad.'; }],
    ['file digest tampering', (artifact: Record<string, any>) => { artifact.files[0].content.sha256 = '0'.repeat(64); }],
    ['non-canonical path order', (artifact: Record<string, any>) => { artifact.files.reverse(); }],
    ['unknown security field', (artifact: Record<string, any>) => { artifact.validationPassed = true; }],
    ['case-insensitive collision', (artifact: Record<string, any>) => { artifact.files[1].path = 'readme.md'; }],
    ['Git LFS pointer content', (artifact: Record<string, any>) => {
      const content = artifact.files[0].content;
      const bytes = Buffer.from('version https://git-lfs.github.com/spec/v1\n' + 'oid sha256:' + 'a'.repeat(64) + '\nsize 1\n');
      content.data = bytes.toString('base64');
      content.byteLength = bytes.byteLength;
      content.sha256 = createHash('sha256').update(bytes).digest('hex');
      artifact.totalBytes = artifact.files.reduce((total: number, file: Record<string, any>) => total + (file.content?.byteLength ?? 0), 0);
    }],
  ])('rejects shared invalid contract case: %s', async (_name, mutate) => {
    const fixture = JSON.parse(fsSync.readFileSync(path.join(process.cwd(), 'tests/fixtures/kirisame-publication-request-v1.json'), 'utf8')) as {
      value: { artifact: Record<string, any> };
    };
    const artifact = globalThis.structuredClone(fixture.value.artifact);
    mutate(artifact);

    const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-kirisame-invalid-contract-'));
    try {
      await writeStoredManifest(resultDir, artifact);
      await expect(loadOrCreatePublicationManifest(resultDir, fixtureInput(artifact))).rejects.toThrow();
    } finally {
      await fs.rm(resultDir, { recursive: true, force: true });
    }
  });
});

describe('trusted workspace manifest production', () => {
  let root: string;
  let repoPath: string;
  let resultDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-kirisame-manifest-'));
    repoPath = path.join(root, 'repo');
    resultDir = path.join(root, 'results');
    await fs.mkdir(path.join(repoPath, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repoPath, 'README.md'), 'Hello\n');
    await fs.writeFile(path.join(repoPath, 'docs/guide.md'), 'Old guide\n');
    await fs.writeFile(path.join(repoPath, 'obsolete.txt'), 'Remove me\n');
    execFileSync('git', ['init', '-q'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.name', 'Kaseki Test'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.email', 'kaseki-test@example.invalid'], { cwd: repoPath });
    execFileSync('git', ['add', '--all'], { cwd: repoPath });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repoPath });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('builds sorted add, modify, and delete entries against the pinned base tree', async () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    await fs.writeFile(path.join(repoPath, 'docs/guide.md'), 'Updated guide\n');
    await fs.rm(path.join(repoPath, 'obsolete.txt'));
    await fs.writeFile(path.join(repoPath, 'new.txt'), 'New file\n');

    const manifest = await loadOrCreatePublicationManifest(resultDir, {
      repoPath,
      runId: RUN_ID,
      repositoryUrl: REPO_URL,
      baseRef: 'main',
      baseSha,
    });

    expect(manifest.artifact.files.map(({ operation, path: filePath }) => [operation, filePath])).toEqual([
      ['modify', 'docs/guide.md'],
      ['add', 'new.txt'],
      ['delete', 'obsolete.txt'],
    ]);
    const modify = manifest.artifact.files.find((file) => file.path === 'docs/guide.md');
    expect(modify).toMatchObject({ operation: 'modify', baseBlobSha: expect.stringMatching(/^[a-f0-9]{40}$/) });
    expect(manifest.artifact.artifactId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(manifest.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('does not execute an fsmonitor command configured by the untrusted workspace', async () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    const marker = path.join(root, 'fsmonitor-ran');
    const hook = path.join(root, 'fsmonitor-hook.sh');
    const quotedMarker = `'${marker.replaceAll("'", "'\\''")}'`;
    await fs.writeFile(hook, `#!/bin/sh\nprintf called > ${quotedMarker}\nprintf '\\n'\n`);
    await fs.chmod(hook, 0o700);
    execFileSync('git', ['config', 'core.fsmonitor', hook], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, 'new.txt'), 'new content\n');

    const manifest = await loadOrCreatePublicationManifest(resultDir, {
      repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha,
    });

    expect(manifest.artifact.files.map((file) => file.path)).toContain('new.txt');
    await expect(fs.access(marker)).rejects.toThrow();
  });

  test('stores an immutable manifest for retries after the workspace is removed', async () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    await fs.writeFile(path.join(repoPath, 'new.txt'), 'Retry stable\n');
    const input = { repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha };

    const initial = await loadOrCreatePublicationManifest(resultDir, input);
    await fs.rm(repoPath, { recursive: true, force: true });
    const retry = await loadOrCreatePublicationManifest(resultDir, input);

    expect(retry.artifact.artifactId).toBe(initial.artifact.artifactId);
    expect(retry.artifactDigest).toBe(initial.artifactDigest);
    expect(retry.body).toEqual(initial.body);
  });

  test('keeps one immutable manifest when concurrent callbacks race to create it', async () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    await fs.writeFile(path.join(repoPath, 'new.txt'), 'Concurrent callback\n');
    const input = { repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha };

    const [first, second] = await Promise.all([
      loadOrCreatePublicationManifest(resultDir, input),
      loadOrCreatePublicationManifest(resultDir, input),
    ]);

    expect(second.artifactDigest).toBe(first.artifactDigest);
    expect(JSON.parse(await fs.readFile(path.join(resultDir, 'soyuz-publication-manifest-v1.json'), 'utf8')).artifactDigest)
      .toBe(first.artifactDigest);
  });

  test('accepts valid Unicode format characters in publication text', async () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    const familyEmoji = 'Family 👩‍👩‍👧‍👦\n';
    await fs.writeFile(path.join(repoPath, 'new.txt'), familyEmoji);

    const manifest = await loadOrCreatePublicationManifest(resultDir, {
      repoPath,
      runId: RUN_ID,
      repositoryUrl: REPO_URL,
      baseRef: 'main',
      baseSha,
    });
    const newFile = manifest.artifact.files.find((file) => file.path === 'new.txt');
    expect(newFile?.operation).toBe('add');
    if (newFile?.operation !== 'add') throw new Error('Expected the Unicode test file in the manifest');
    expect(Buffer.from(newFile.content.data, 'base64').toString('utf8')).toBe(familyEmoji);
  });

  test('normalizes HTTPS and SSH GitHub URLs and rejects credentials or other hosts', () => {
    expect(parseGitHubRepository(REPO_URL)).toEqual({ owner: 'cyanautomation', name: 'demo-app' });
    expect(parseGitHubRepository('git@github.com:CyanAutomation/demo-app.git')).toEqual({ owner: 'cyanautomation', name: 'demo-app' });
    expect(() => parseGitHubRepository('https://user:token@github.com/org/repo')).toThrow('credential-free');
    expect(() => parseGitHubRepository('ssh://attacker@github.com/org/repo.git')).toThrow('credential-free');
    expect(() => parseGitHubRepository('https://example.test/org/repo')).toThrow('credential-free');
  });

  test('rejects executable and symlink workspace files', async () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    await fs.writeFile(path.join(repoPath, 'new.sh'), '#!/bin/sh\n');
    await fs.chmod(path.join(repoPath, 'new.sh'), 0o755);
    await expect(loadOrCreatePublicationManifest(resultDir, { repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha }))
      .rejects.toThrow('Executable files are unsupported');
    await fs.rm(path.join(repoPath, 'new.sh'));
    await fs.symlink('/etc/passwd', path.join(repoPath, 'linked.txt'));
    await expect(loadOrCreatePublicationManifest(resultDir, { repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha }))
      .rejects.toThrow('not a regular file');
  });

  test('enforces file count, per-file, and decoded-total content bounds', async () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    for (let index = 0; index < 101; index += 1) {
      await fs.writeFile(path.join(repoPath, `count-${index}.txt`), 'x');
    }
    await expect(loadOrCreatePublicationManifest(resultDir, { repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha }))
      .rejects.toThrow('100-file limit');
    for (let index = 0; index < 101; index += 1) await fs.rm(path.join(repoPath, `count-${index}.txt`));

    await fs.writeFile(path.join(repoPath, 'large-file.txt'), 'x'.repeat(1_048_577));
    await expect(loadOrCreatePublicationManifest(resultDir, { repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha }))
      .rejects.toThrow('1 MiB limit');
    await fs.rm(path.join(repoPath, 'large-file.txt'));

    for (let index = 0; index < 6; index += 1) {
      await fs.writeFile(path.join(repoPath, `total-${index}.txt`), 'x'.repeat(900_000));
    }
    await expect(loadOrCreatePublicationManifest(resultDir, { repoPath, runId: RUN_ID, repositoryUrl: REPO_URL, baseRef: 'main', baseSha }))
      .rejects.toThrow('5 MiB decoded-content limit');
  });
});

function fixtureInput(artifact: Record<string, any>) {
  return {
    repoPath: path.join(os.tmpdir(), 'unused-publication-workspace'),
    runId: artifact.runId as string,
    repositoryUrl: `https://github.com/${artifact.repository.owner}/${artifact.repository.name}`,
    baseRef: artifact.baseRef as string,
    baseSha: artifact.baseSha as string,
  };
}

async function writeStoredManifest(resultDir: string, artifact: Record<string, any>, artifactDigest?: string): Promise<void> {
  const canonicalJson = stableCanonicalJson(artifact);
  const digest = artifactDigest ?? `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`;
  await fs.mkdir(resultDir, { recursive: true });
  await fs.writeFile(path.join(resultDir, 'soyuz-publication-manifest-v1.json'), JSON.stringify({ artifact, artifactDigest: digest, canonicalJson }));
}

function stableCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
