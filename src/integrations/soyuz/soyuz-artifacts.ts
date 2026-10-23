import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

export const MAX_SOYUZ_ARTIFACT_BYTES = 2_000_000;
const SOYUZ_ARTIFACT_NAMESPACE = Buffer.from('d53a6a7436945ed7a108d82f89d94414', 'hex');

const ARTIFACT_FILES = [
  { name: 'result-summary.md', kind: 'report', contentType: 'text/markdown; charset=utf-8' },
  { name: 'failure.json', kind: 'report', contentType: 'application/json' },
  { name: 'git.diff', kind: 'patch', contentType: 'text/x-diff; charset=utf-8' },
  { name: 'changed-files.txt', kind: 'report', contentType: 'text/plain; charset=utf-8' },
  { name: 'run-scorecard.json', kind: 'report', contentType: 'application/json' },
  { name: 'run-evaluation.json', kind: 'report', contentType: 'application/json' },
] as const;

export interface SoyuzArtifactFile {
  artifactId: string;
  name: (typeof ARTIFACT_FILES)[number]['name'];
  kind: (typeof ARTIFACT_FILES)[number]['kind'];
  contentType: (typeof ARTIFACT_FILES)[number]['contentType'];
  body: Buffer;
}

export interface SoyuzArtifactLoadResult {
  artifacts: SoyuzArtifactFile[];
  skipped: Array<{ name: string; reason: 'unsafe_file' | 'too_large' }>;
}

export interface SoyuzTerminalOutcome {
  summary?: string;
  publishedUrl?: string;
  changedFileCount?: number;
}

export async function loadSoyuzTerminalOutcome(resultDir: string | undefined): Promise<SoyuzTerminalOutcome> {
  if (!resultDir) return {};
  const [summaryFile, metadataFile, changedFilesFile] = await Promise.all([
    readArtifactFile(path.join(resultDir, 'result-summary.md')),
    readArtifactFile(path.join(resultDir, 'metadata.json')),
    readArtifactFile(path.join(resultDir, 'changed-files.txt')),
  ]);
  const outcome: SoyuzTerminalOutcome = {};

  if (Buffer.isBuffer(summaryFile)) {
    const summary = summaryFile.toString('utf8').trim().slice(0, 2_000);
    if (summary) outcome.summary = summary;
  }

  if (Buffer.isBuffer(metadataFile)) {
    try {
      const metadata = JSON.parse(metadataFile.toString('utf8')) as Record<string, unknown>;
      const publishedUrl = safePublishedUrl(metadata.github_pr_url ?? metadata.pr_url);
      if (publishedUrl) outcome.publishedUrl = publishedUrl;
    } catch {
      // Invalid metadata does not prevent the canonical run from completing.
    }
  }

  if (Buffer.isBuffer(changedFilesFile)) {
    const changedFiles = new Set(changedFilesFile.toString('utf8').split(/\r?\n/).map((file) => file.trim()).filter(Boolean));
    if (changedFiles.size <= 100_000) outcome.changedFileCount = changedFiles.size;
  }
  return outcome;
}

export async function loadSoyuzArtifacts(
  runId: string,
  resultDir: string,
  alreadyUploaded: string[] = [],
): Promise<SoyuzArtifactLoadResult> {
  const artifacts: SoyuzArtifactFile[] = [];
  const skipped: SoyuzArtifactLoadResult['skipped'] = [];
  for (const definition of ARTIFACT_FILES) {
    if (alreadyUploaded.includes(definition.name)) continue;
    const result = await readArtifactFile(path.join(resultDir, definition.name));
    if (result === null) continue;
    if (result === 'too_large') {
      skipped.push({ name: definition.name, reason: 'too_large' });
      continue;
    }
    if (result === 'unsafe_file') {
      skipped.push({ name: definition.name, reason: 'unsafe_file' });
      continue;
    }
    if (result.byteLength === 0) continue;
    artifacts.push({
      ...definition,
      artifactId: artifactIdForSoyuzFile(runId, definition.name),
      body: result,
    });
  }
  return { artifacts, skipped };
}

export function artifactIdForSoyuzFile(runId: string, name: string): string {
  const bytes = createHash('sha1').update(SOYUZ_ARTIFACT_NAMESPACE).update(`${runId}\0${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safePublishedUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    url.search = '';
    url.hash = '';
    return url.href.length <= 2_048 ? url.href : undefined;
  } catch {
    return undefined;
  }
}

async function readArtifactFile(filePath: string): Promise<Buffer | null | 'unsafe_file' | 'too_large'> {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    return 'unsafe_file';
  }

  try {
    const before = await file.stat();
    if (!before.isFile()) return 'unsafe_file';
    if (before.size > MAX_SOYUZ_ARTIFACT_BYTES) return 'too_large';
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_SOYUZ_ARTIFACT_BYTES) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_SOYUZ_ARTIFACT_BYTES + 1 - total));
      const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_SOYUZ_ARTIFACT_BYTES) return 'too_large';
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } catch {
    return 'unsafe_file';
  } finally {
    await file.close().catch(() => undefined);
  }
}
