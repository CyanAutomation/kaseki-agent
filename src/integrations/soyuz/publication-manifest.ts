import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_PUBLICATION_FILES = 100;
const MAX_PUBLICATION_FILE_BYTES = 1_048_576;
const MAX_PUBLICATION_TOTAL_BYTES = 5_242_880;
const MAX_PUBLICATION_CANONICAL_BYTES = 8 * 1024 * 1024;
export const MAX_PUBLICATION_REQUEST_BYTES = 9 * 1024 * 1024;

const GIT_SHA = /^[a-f0-9]{40}$/;
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE_REF = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,61}[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,61}[A-Za-z0-9])?)*$/;
const unsafeUnicode = /[\p{Cc}\p{Cf}\p{Cs}\p{Cn}]/u;
const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type PublicationFileChange =
  | { operation: 'add'; path: string; content: PublicationContent }
  | { operation: 'modify'; path: string; baseBlobSha: string; content: PublicationContent }
  | { operation: 'delete'; path: string; baseBlobSha: string };

export interface PublicationContent {
  mediaType: 'text/plain; charset=utf-8';
  encoding: 'base64';
  byteLength: number;
  sha256: string;
  data: string;
}

export interface PublicationManifest {
  contractVersion: '1';
  artifactId: string;
  runId: string;
  repository: { owner: string; name: string };
  baseRef: string;
  baseSha: string;
  fileCount: number;
  totalBytes: number;
  files: PublicationFileChange[];
}

export interface BuiltPublicationManifest {
  artifact: PublicationManifest;
  artifactDigest: string;
  canonicalJson: string;
  body: Buffer;
}

export interface PublicationManifestInput {
  repoPath: string;
  runId: string;
  repositoryUrl: string;
  baseRef: string;
  baseSha: string;
}

interface GitChange {
  filePath: string;
  operation: 'add' | 'modify' | 'delete';
  baseBlobSha?: string;
  oldMode?: string;
  newMode?: string;
}

async function buildPublicationManifest(input: PublicationManifestInput): Promise<BuiltPublicationManifest> {
  validateManifestInput(input);
  const repository = parseGitHubRepository(input.repositoryUrl);
  const repoPath = path.resolve(input.repoPath);
  const changes = collectGitChanges(repoPath, input.baseSha);
  if (changes.length === 0) throw new Error('Publication manifest cannot be empty');
  if (changes.length > MAX_PUBLICATION_FILES) throw new Error('Publication manifest exceeds the 100-file limit');
  const { files, totalBytes } = await materializeGitChanges(repoPath, changes);
  files.sort((left, right) => Buffer.compare(encoder.encode(left.path), encoder.encode(right.path)));
  validatePathSet(files.map((file) => file.path));
  const artifact: PublicationManifest = {
    contractVersion: '1',
    artifactId: artifactIdForRun(input.runId),
    runId: input.runId,
    repository,
    baseRef: input.baseRef,
    baseSha: input.baseSha,
    fileCount: files.length,
    totalBytes,
    files,
  };
  return validatePublicationManifest(artifact);
}

export async function loadOrCreatePublicationManifest(
  resultDir: string,
  input: PublicationManifestInput,
): Promise<BuiltPublicationManifest> {
  const filePath = path.join(resultDir, 'soyuz-publication-manifest-v1.json');
  const stored = await readSavedManifest(filePath);
  if (stored) return validateSavedManifest(stored, input);
  const built = await buildPublicationManifest(input);
  if (await persistNewManifest(filePath, resultDir, built)) return built;
  return loadOrCreatePublicationManifest(resultDir, input);
}

async function readSavedManifest(filePath: string): Promise<BuiltPublicationManifest | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as BuiltPublicationManifest;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function validateSavedManifest(stored: BuiltPublicationManifest, input: PublicationManifestInput): BuiltPublicationManifest {
  assertSavedManifestIdentity(stored, input);
  const validated = validatePublicationManifest(stored.artifact);
  if (stored.artifactDigest !== validated.artifactDigest
    || stored.canonicalJson !== validated.canonicalJson
    || stored.body !== undefined) {
    throw new Error('Saved publication manifest failed its digest or size check');
  }
  return validated;
}

function assertSavedManifestIdentity(stored: BuiltPublicationManifest, input: PublicationManifestInput): void {
  const expectedRepo = parseGitHubRepository(input.repositoryUrl);
  if (stored.artifact?.runId !== input.runId
    || stored.artifact?.repository?.owner !== expectedRepo.owner
    || stored.artifact?.repository?.name !== expectedRepo.name
    || stored.artifact?.baseRef !== input.baseRef
    || stored.artifact?.baseSha !== input.baseSha
    || !UUID7.test(stored.artifact?.artifactId ?? '')
    || typeof stored.artifactDigest !== 'string'
    || stored.canonicalJson !== canonicalPublicationJson(stored.artifact)) {
    throw new Error('Saved publication manifest does not match this Soyuz run');
  }
}

async function persistNewManifest(filePath: string, resultDir: string, built: BuiltPublicationManifest): Promise<boolean> {
  await mkdir(resultDir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify({ ...built, body: undefined }), { flag: 'wx', mode: 0o600 });
  try {
    await rename(tempPath, filePath);
    return true;
  } catch (error) {
    await import('node:fs/promises').then(({ unlink }) => unlink(tempPath).catch(() => undefined));
    if (isAlreadyExists(error)) return false;
    throw error;
  }
}

function validateManifestInput(input: PublicationManifestInput): void {
  if (!UUID7.test(input.runId)) throw new Error('Publication run ID must be a UUIDv7');
  if (!GIT_SHA.test(input.baseSha)) throw new Error('Publication base commit must be a lower-case Git SHA-1');
  if (!isSafeBaseRef(input.baseRef)) throw new Error('Publication base ref is invalid');
}

function collectGitChanges(repoPath: string, baseSha: string): GitChange[] {
  const changes = readGitChanges(repoPath, baseSha);
  const filePaths = new Set(changes.map((change) => change.filePath));
  for (const filePath of readUntrackedPaths(repoPath)) {
    if (filePaths.has(filePath)) continue;
    changes.push({ filePath, operation: 'add', newMode: '100644' });
    filePaths.add(filePath);
  }
  return changes;
}

async function materializeGitChanges(repoPath: string, changes: GitChange[]): Promise<{ files: PublicationFileChange[]; totalBytes: number }> {
  const files: PublicationFileChange[] = [];
  let totalBytes = 0;
  for (const change of changes) {
    const file = await materializeGitChange(repoPath, change);
    files.push(file);
    if ('content' in file) totalBytes += file.content.byteLength;
    if (totalBytes > MAX_PUBLICATION_TOTAL_BYTES) throw new Error('Publication manifest exceeds the 5 MiB decoded-content limit');
  }
  return { files, totalBytes };
}

async function materializeGitChange(repoPath: string, change: GitChange): Promise<PublicationFileChange> {
  validateRepositoryPath(change.filePath);
  if (change.operation !== 'add' && change.oldMode !== '100644') throw new Error(`Unsupported base Git mode for ${change.filePath}`);
  if (change.operation === 'delete') return { operation: 'delete', path: change.filePath, baseBlobSha: change.baseBlobSha! };
  if (change.newMode !== '100644') throw new Error(`Unsupported working tree Git mode for ${change.filePath}`);
  const content = await loadPublicationContent(repoPath, change.filePath);
  if (change.operation === 'modify') return { operation: 'modify', path: change.filePath, baseBlobSha: change.baseBlobSha!, content };
  return { operation: 'add', path: change.filePath, content };
}

async function loadPublicationContent(repoPath: string, filePath: string): Promise<PublicationContent> {
  const absolutePath = await safeWorkspaceFile(repoPath, filePath);
  const bytes = await readFile(absolutePath);
  if (bytes.byteLength > MAX_PUBLICATION_FILE_BYTES) throw new Error(`Publication file exceeds the 1 MiB limit: ${filePath}`);
  const text = decoder.decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new Error(`Publication file contains unsupported control characters: ${filePath}`);
  }
  if (text.startsWith('version https://git-lfs.github.com/spec/v1\n')) {
    throw new Error(`Git LFS pointer content is unsupported: ${filePath}`);
  }
  return {
    mediaType: 'text/plain; charset=utf-8',
    encoding: 'base64',
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    data: bytes.toString('base64'),
  };
}

function artifactIdForRun(runId: string): string {
  if (!UUID7.test(runId)) throw new Error('Publication run ID must be a UUIDv7');
  const digest = createHash('sha256').update(`soyuz-kirisame-artifact:${runId}`).digest('hex');
  const variant = ((Number.parseInt(digest[0]!, 16) & 0x03) | 0x08).toString(16);
  return `${runId.slice(0, 13)}-7${digest.slice(0, 3)}-${variant}${digest.slice(3, 6)}-${digest.slice(6, 18)}`;
}

function canonicalPublicationJson(value: unknown): string {
  assertSafeCanonicalValues(value);
  return stableStringify(value);
}

function validatePublicationManifest(value: unknown): BuiltPublicationManifest {
  const artifact = validateManifestIdentity(value);
  const files = validateManifestFiles(artifact);
  const totalBytes = totalContentBytes(files);
  if (totalBytes > MAX_PUBLICATION_TOTAL_BYTES || artifact.totalBytes !== totalBytes) throw new Error('Publication total content bytes are invalid');
  const canonicalJson = canonicalPublicationJson(value);
  const canonicalBytes = encoder.encode(canonicalJson);
  if (canonicalBytes.byteLength > MAX_PUBLICATION_CANONICAL_BYTES) throw new Error('Publication manifest exceeds the 8 MiB canonical JSON limit');
  if (canonicalBytes.byteLength > MAX_PUBLICATION_REQUEST_BYTES) throw new Error('Publication request exceeds the 9 MiB body limit');
  return {
    artifact: value as PublicationManifest,
    artifactDigest: `sha256:${sha256(canonicalBytes)}`,
    canonicalJson,
    body: Buffer.from(canonicalBytes),
  };
}

function validateManifestIdentity(value: unknown): Record<string, unknown> {
  const artifact = asRecord(value);
  exactKeys(artifact, ['artifactId', 'baseRef', 'baseSha', 'contractVersion', 'fileCount', 'files', 'repository', 'runId', 'totalBytes']);
  if (artifact.contractVersion !== '1' || typeof artifact.artifactId !== 'string' || !UUID7.test(artifact.artifactId)
    || typeof artifact.runId !== 'string' || !UUID7.test(artifact.runId)) throw new Error('Publication manifest identity is invalid');
  const repository = asRecord(artifact.repository);
  exactKeys(repository, ['name', 'owner']);
  if (typeof repository.owner !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(repository.owner)
    || typeof repository.name !== 'string' || !/^[a-z0-9](?:[a-z0-9._-]{0,97}[a-z0-9])?$/.test(repository.name)) {
    throw new Error('Publication repository identity is invalid');
  }
  if (typeof artifact.baseRef !== 'string' || !isSafeBaseRef(artifact.baseRef)
    || typeof artifact.baseSha !== 'string' || !GIT_SHA.test(artifact.baseSha)) throw new Error('Publication base is invalid');
  return artifact;
}

function validateManifestFiles(artifact: Record<string, unknown>): PublicationFileChange[] {
  if (!Array.isArray(artifact.files) || artifact.files.length < 1 || artifact.files.length > MAX_PUBLICATION_FILES
    || artifact.fileCount !== artifact.files.length) throw new Error('Publication file count is invalid');
  const files = artifact.files.map(validateFileChange);
  const sorted = [...files].sort((left, right) => Buffer.compare(encoder.encode(left.path), encoder.encode(right.path)));
  if (files.some((file, index) => file.path !== sorted[index]?.path)) throw new Error('Publication files are not in canonical path order');
  validatePathSet(files.map((file) => file.path));
  return files;
}

function totalContentBytes(files: PublicationFileChange[]): number {
  return files.reduce((total, file) => total + ('content' in file ? file.content.byteLength : 0), 0);
}

export function parseGitHubRepository(repositoryUrl: string): { owner: string; name: string } {
  let owner: string | undefined;
  let name: string | undefined;
  const scp = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(repositoryUrl);
  if (scp) {
    owner = scp[1];
    name = scp[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(repositoryUrl);
    } catch {
      throw new Error('Publication repository must be a GitHub URL');
    }
    if (!['https:', 'ssh:'].includes(parsed.protocol)
      || parsed.hostname.toLowerCase() !== 'github.com'
      || parsed.port || parsed.search || parsed.hash
      || (parsed.protocol === 'https:' && (parsed.username || parsed.password))
      || (parsed.protocol === 'ssh:' && (parsed.username !== 'git' || parsed.password))) {
      throw new Error('Publication repository must be a credential-free GitHub URL');
    }
    const parts = parsed.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parts.length !== 2) throw new Error('Publication repository URL must identify one GitHub repository');
    [owner, name] = parts;
  }
  if (!owner || !name || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(owner)
    || !/^[a-z0-9](?:[a-z0-9._-]{0,97}[a-z0-9])?$/i.test(name)) {
    throw new Error('Publication repository owner or name is invalid');
  }
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

export async function resolveGitHubBaseSha(repositoryUrl: string, baseRef: string): Promise<string> {
  parseGitHubRepository(repositoryUrl);
  if (!isSafeBaseRef(baseRef)) throw new Error('Publication base ref is invalid');
  const ref = `refs/heads/${baseRef}`;
  const stdout = await new Promise<string>((resolve, reject) => {
    import('node:child_process').then(({ execFile }) => {
      execFile('git', ['ls-remote', '--exit-code', '--heads', repositoryUrl, ref], {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        encoding: 'utf8',
      }, (error, output) => error ? reject(error) : resolve(output));
    }).catch(reject);
  });
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error('GitHub base ref did not resolve to exactly one commit');
  const [sha, resolvedRef] = lines[0]!.split(/\s+/);
  if (!sha || !GIT_SHA.test(sha) || resolvedRef !== ref) throw new Error('GitHub base ref returned an invalid commit');
  return sha;
}

function readGitChanges(repoPath: string, baseSha: string): Array<{
  filePath: string;
  operation: 'add' | 'modify' | 'delete';
  baseBlobSha?: string;
  oldMode?: string;
  newMode?: string;
}> {
  const output = execFileSync('git', ['diff', '--raw', '--no-abbrev', '--no-renames', '-z', baseSha, '--'], {
    cwd: repoPath,
    encoding: null,
    maxBuffer: MAX_PUBLICATION_REQUEST_BYTES,
  });
  const tokens = decodeNulSeparated(output);
  const changes: Array<{ filePath: string; operation: 'add' | 'modify' | 'delete'; baseBlobSha?: string; oldMode?: string; newMode?: string }> = [];
  for (let index = 0; index < tokens.length;) {
    const header = tokens[index++];
    if (!header?.startsWith(':')) throw new Error('Git returned malformed change metadata');
    const [oldMode, newMode, oldSha, , status] = header.slice(1).split(/\s+/);
    const filePath = tokens[index++];
    if (!filePath || !oldMode || !newMode || !status) throw new Error('Git returned incomplete change metadata');
    if (!['A', 'M', 'D'].includes(status)) throw new Error(`Unsupported Git change type for ${filePath}`);
    if (status === 'D' || newMode === '000000') {
      changes.push({ filePath, operation: 'delete', baseBlobSha: oldSha, oldMode, newMode });
    } else if (oldMode === '000000' || status === 'A') {
      changes.push({ filePath, operation: 'add', newMode });
    } else {
      changes.push({ filePath, operation: 'modify', baseBlobSha: oldSha, oldMode, newMode });
    }
  }
  return changes;
}

function readUntrackedPaths(repoPath: string): string[] {
  const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repoPath,
    encoding: null,
    maxBuffer: MAX_PUBLICATION_REQUEST_BYTES,
  });
  return decodeNulSeparated(output);
}

function decodeNulSeparated(value: Buffer): string[] {
  const text = decoder.decode(value);
  return text.split('\0').filter(Boolean);
}

async function safeWorkspaceFile(repoPath: string, relativePath: string): Promise<string> {
  const absolutePath = path.resolve(repoPath, ...relativePath.split('/'));
  if (!absolutePath.startsWith(`${repoPath}${path.sep}`)) throw new Error(`Publication path escapes the workspace: ${relativePath}`);
  let parent = repoPath;
  for (const segment of relativePath.split('/').slice(0, -1)) {
    parent = path.join(parent, segment);
    const info = await lstat(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Publication path traverses an unsupported directory: ${relativePath}`);
  }
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Publication path is not a regular file: ${relativePath}`);
  if ((info.mode & 0o111) !== 0) throw new Error(`Executable files are unsupported in publication v1: ${relativePath}`);
  return absolutePath;
}

function validateRepositoryPath(filePath: string): void {
  const bytes = encoder.encode(filePath);
  const segments = filePath.split('/');
  if (filePath !== filePath.normalize('NFC') || bytes.byteLength < 1 || bytes.byteLength > 1_024
    || filePath.startsWith('/') || filePath.includes('\\') || filePath.includes(':')
    || unsafeUnicode.test(filePath)
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.toLowerCase() === '.git'
      || /[. ]$/.test(segment) || windowsDeviceName.test(segment))
    || segments.some((segment) => segment.toLowerCase() === '.gitattributes')) {
    throw new Error(`Publication path is unsupported: ${filePath}`);
  }
  const foldedPath = filePath.toLowerCase().normalize('NFC');
  if (foldedPath === '.github/workflows' || foldedPath.startsWith('.github/workflows/')) {
    throw new Error(`GitHub workflow changes are unsupported: ${filePath}`);
  }
}

function validateFileChange(value: unknown): PublicationFileChange {
  const file = asRecord(value);
  if (file.operation === 'add') {
    exactKeys(file, ['content', 'operation', 'path']);
    if (typeof file.path !== 'string') throw new Error('Publication file path is invalid');
    validateRepositoryPath(file.path);
    return { operation: 'add', path: file.path, content: validateContent(file.content) };
  }
  if (file.operation === 'modify') {
    exactKeys(file, ['baseBlobSha', 'content', 'operation', 'path']);
    if (typeof file.path !== 'string' || typeof file.baseBlobSha !== 'string' || !GIT_SHA.test(file.baseBlobSha)) {
      throw new Error('Publication modification is invalid');
    }
    validateRepositoryPath(file.path);
    return { operation: 'modify', path: file.path, baseBlobSha: file.baseBlobSha, content: validateContent(file.content) };
  }
  if (file.operation === 'delete') {
    exactKeys(file, ['baseBlobSha', 'operation', 'path']);
    if (typeof file.path !== 'string' || typeof file.baseBlobSha !== 'string' || !GIT_SHA.test(file.baseBlobSha)) {
      throw new Error('Publication deletion is invalid');
    }
    validateRepositoryPath(file.path);
    return { operation: 'delete', path: file.path, baseBlobSha: file.baseBlobSha };
  }
  throw new Error('Publication operation is invalid');
}

function validateContent(value: unknown): PublicationContent {
  const content = asRecord(value);
  exactKeys(content, ['byteLength', 'data', 'encoding', 'mediaType', 'sha256']);
  if (content.mediaType !== 'text/plain; charset=utf-8' || content.encoding !== 'base64'
    || typeof content.byteLength !== 'number' || !Number.isInteger(content.byteLength)
    || content.byteLength < 0 || content.byteLength > MAX_PUBLICATION_FILE_BYTES
    || typeof content.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(content.sha256)
    || typeof content.data !== 'string' || content.data.length > 1_398_104
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.data)) {
    throw new Error('Publication file content descriptor is invalid');
  }
  const bytes = Buffer.from(content.data, 'base64');
  if (bytes.byteLength !== content.byteLength || bytes.toString('base64') !== content.data || sha256(bytes) !== content.sha256) {
    throw new Error('Publication file content digest or length is invalid');
  }
  const text = decoder.decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error('Publication text has unsupported controls');
  if (text.startsWith('version https://git-lfs.github.com/spec/v1\n')) throw new Error('Git LFS pointer content is unsupported');
  return value as PublicationContent;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Publication manifest object is invalid');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join(',') !== expected.sort().join(',')) throw new Error('Publication manifest has unknown or missing fields');
}

function validatePathSet(paths: string[]): void {
  const exact = new Set<string>();
  const folded = new Set<string>();
  const allPaths = new Set(paths);
  for (const filePath of paths) {
    const lower = filePath.toLowerCase().normalize('NFC');
    if (exact.has(filePath) || folded.has(lower)) throw new Error(`Publication manifest has duplicate or case-colliding paths: ${filePath}`);
    exact.add(filePath);
    folded.add(lower);
    const segments = filePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join('/');
      if (allPaths.has(ancestor)) throw new Error(`Publication manifest has a file path that is also a directory: ${ancestor}`);
    }
  }
}

function isSafeBaseRef(value: string): boolean {
  return BASE_REF.test(value) && !value.includes('..') && !/\.lock(?:\/|$)/.test(value) && !value.includes('@{');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function assertSafeCanonicalValues(value: unknown): void {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || Object.is(value, -0))) {
    throw new TypeError('Publication manifest numbers must be safe integers');
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeCanonicalValues(entry);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) assertSafeCanonicalValues(entry);
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}
