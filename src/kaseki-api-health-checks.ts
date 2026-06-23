/**
 * src/kaseki-api-health-checks.ts
 *
 * Health check functions extracted from kaseki-api-routes.ts to break circular dependency.
 * This module encapsulates all preflight checks and template health status logic.
 *
 * **Refactoring Note (Phase 1: Break Circular Dependency)**:
 * - Extracted from kaseki-api-routes.ts to resolve circular import with kaseki-api-routes-preflight.ts
 * - kaseki-api-routes-preflight.ts imported 10 check functions from kaseki-api-routes.ts
 * - kaseki-api-routes.ts imported buildPreflightResponse from kaseki-api-routes-preflight.ts
 * - This module breaks the cycle by centralizing all checks in one place
 * - No dependencies on kaseki-api-routes.ts or kaseki-api-routes-preflight.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  readHostSecret,
  getSecretLocations,
  resolveHostSecretPath,
} from './secrets/host-secrets-reader';
import { execDockerCommand } from './lib/subprocess-helpers';
import { readFirstLine, commandOutput } from './utils/file-helpers';
import {
  PreflightCheck,
} from './kaseki-api-types';
import { KasekiApiConfig } from './kaseki-api-config';
import { validateGitHubAppPrivateKey } from './github-app-private-key';
import { resolveGatewayApiKey, isResponsesEndpoint } from './kaseki-api-gateway-test';

// =============================================================================
// Constants
// =============================================================================

export const TEMPLATE_REMEDIATION =
  'Run scripts/kaseki-activate.sh --controller bootstrap.';
export const DEFAULT_TEMPLATE_DOCTOR_TIMEOUT_MS = 15000;
export const DEFAULT_TEMPLATE_HEALTH_CACHE_TTL_MS = 60_000;
export const TEMPLATE_DOCTOR_STDERR_TAIL_LINES = 25;
export const TEMPLATE_DOCTOR_STDOUT_TAIL_LINES = 25;
export const REQUIRED_TEMPLATE_FILES = [
  'run-kaseki.sh',
  'kaseki-agent.sh',
  'scripts/kaseki-activate.sh',
  'scripts/kaseki-preflight.sh',
  'lib/pi-event-filter.js',
  'lib/pi-progress-stream.js',
  'lib/kaseki-report.js',
  'lib/github-app-token.js',
  'lib/github-app-private-key.js',
  'lib/github-utils.js',
  'lib/logger.js',
  'lib/secrets/host-secrets-reader.js',
] as const;

// =============================================================================
// Interfaces & Types
// =============================================================================

export interface TemplateHealthStatus {
  ok: boolean;
  templateDir: string;
  runScript: string;
  checkoutDir: string;
  checkoutRef?: string;
  doctorCommand?: string;
  doctorExitCode?: number | null;
  doctorSignal?: NodeJS.Signals | null;
  doctorStderrTail?: string;
  doctorStdoutTail?: string;
  detail: string;
  remediation?: string;
}

export interface FreshnessStatus {
  ok: boolean;
  stale: boolean;
  checkoutDir: string;
  localRef?: string;
  remoteRef?: string;
  remoteUrl?: string;
  detail: string;
  remediation?: string;
}

type TemplateHealthCacheEntry = {
  checkedAt: number;
  templateDir: string;
  status: TemplateHealthStatus;
};

interface GitRefResolution {
  ref?: string;
  command: string;
  errorKind?: 'git-missing' | 'permission-denied' | 'not-a-repo' | 'unknown';
  stderrTail?: string;
}

interface TemplateVersionMetadata {
  gitRef?: string;
  supportedPublishModes?: string[];
  imageDigest?: string;
}

export interface TemplatePublishModeCompatibility {
  ok: boolean;
  metadataPath: string;
  supportedPublishModes?: string[];
  detail?: string;
  remediation?: string;
}

// =============================================================================
// Module-Level State
// =============================================================================

let templateHealthCache: TemplateHealthCacheEntry | undefined;

// =============================================================================
// Git and Checkout Helpers
// =============================================================================

function getTemplateCheckoutRef(
  checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent',
): string | undefined {
  return fs.existsSync(path.join(checkoutDir, '.git'))
    ? commandOutput('git', ['rev-parse', '--short', 'HEAD'], checkoutDir)
    : undefined;
}

function classifyGitRevParseFailure(
  stderr: string,
): GitRefResolution['errorKind'] {
  const normalized = stderr.toLowerCase();
  if (
    normalized.includes('permission denied') ||
    normalized.includes('operation not permitted')
  )
    return 'permission-denied';
  if (
    normalized.includes('not a git repository') ||
    normalized.includes('no such file or directory')
  )
    return 'not-a-repo';
  if (
    normalized.includes('command not found') ||
    normalized.includes('not recognized as an internal or external command')
  )
    return 'git-missing';
  return 'unknown';
}

function sanitizeStderrTail(
  stderr?: string,
  lineCount = 6,
): string | undefined {
  const tail = tailTextByLines(String(stderr || ''), lineCount);
  return tail.length > 0 ? tail.replace(/[\r\n\t]+/g, ' ').trim() : undefined;
}

function getTemplateCheckoutFullRef(
  checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent',
): GitRefResolution {
  const command = 'git rev-parse HEAD';
  const result = runGit(['rev-parse', 'HEAD'], checkoutDir);
  if (result.status === 0) {
    const ref = String(result.stdout || '').trim();
    return { ref: ref || undefined, command };
  }

  const stderrTail = sanitizeStderrTail(String(result.stderr || ''));
  return {
    command,
    errorKind: classifyGitRevParseFailure(String(result.stderr || '')),
    stderrTail,
  };
}

function runGit(args: string[], cwd?: string): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 5000,
    maxBuffer: 128 * 1024,
  });
}

function firstLsRemoteSha(output?: string | Buffer): string | undefined {
  const line = String(output || '')
    .split(/\r?\n/)
    .find((value) => value.trim().length > 0);
  return line?.trim().split(/\s+/)[0];
}

function refsMatch(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

// =============================================================================
// Checkout Freshness Check
// =============================================================================

function readTemplateVersionMetadata(
  templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template',
): TemplateVersionMetadata | undefined {
  const metadataPath = path.join(templateDir, '.kaseki-template-version');
  if (!fs.existsSync(metadataPath)) {
    return undefined;
  }

  const raw = fs.readFileSync(metadataPath, 'utf-8');
  const parsed = JSON.parse(raw) as TemplateVersionMetadata;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Template metadata is invalid: ${metadataPath}`);
  }
  if (
    parsed.supportedPublishModes !== undefined &&
    !Array.isArray(parsed.supportedPublishModes)
  ) {
    throw new Error(
      `Template metadata has invalid supportedPublishModes: ${metadataPath}`,
    );
  }
  return parsed;
}

export function resolveCheckoutFreshness(
  checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent',
  ref = process.env.KASEKI_REF || 'main',
  templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template',
): FreshnessStatus {
  const localRefResolution = getTemplateCheckoutFullRef(checkoutDir);
  const localRef = localRefResolution.ref;
  const metadata = readTemplateVersionMetadata(templateDir);
  const metadataRef = metadata?.gitRef;

  if (!fs.existsSync(path.join(checkoutDir, '.git'))) {
    return {
      ok: true,
      stale: false,
      checkoutDir,
      detail: `Checkout freshness skipped because ${checkoutDir} is not a git checkout.`,
    };
  }

  if (!localRef) {
    const metadataFallbackAvailable = Boolean(
      metadataRef && /^[0-9a-f]{7,40}$/i.test(metadataRef),
    );
    const reason =
      localRefResolution.errorKind === 'permission-denied'
        ? `permission denied while reading ${path.join(checkoutDir, '.git')}`
        : localRefResolution.errorKind === 'git-missing'
          ? 'git executable is unavailable'
          : localRefResolution.errorKind === 'not-a-repo'
            ? `${checkoutDir} does not contain readable git metadata`
            : 'git metadata could not be read';
    const diag = `Failed to resolve controller checkout revision via "${localRefResolution.command}" (${reason})${localRefResolution.stderrTail ? `; stderr tail: ${localRefResolution.stderrTail}` : ''}.`;

    if (metadataFallbackAvailable && metadataRef) {
      return {
        ok: true,
        stale: false,
        checkoutDir,
        localRef: metadataRef,
        detail: `${diag} Using template metadata ref ${metadataRef.substring(0, 12)} as an informational fallback only.`,
        remediation:
          'Fix ownership/permissions on the controller checkout (.git) so freshness can be enforced against origin.',
      };
    }

    return {
      ok: false,
      stale: true,
      checkoutDir,
      detail: diag,
      remediation:
        'Fix ownership/permissions on the controller checkout and rerun scripts/kaseki-activate.sh --controller bootstrap.',
    };
  }

  if (metadataRef && !refsMatch(localRef, metadataRef)) {
    return {
      ok: false,
      stale: true,
      checkoutDir,
      localRef,
      detail: `Template was deployed from ${metadataRef}, but controller checkout is ${localRef}.`,
      remediation: TEMPLATE_REMEDIATION,
    };
  }

  const remoteUrl = commandOutput(
    'git',
    ['config', '--get', 'remote.origin.url'],
    checkoutDir,
  );
  if (!remoteUrl) {
    return {
      ok: true,
      stale: false,
      checkoutDir,
      localRef,
      detail:
        'Checkout freshness skipped because no origin remote is configured.',
    };
  }

  const remoteResult = runGit([
    'ls-remote',
    remoteUrl,
    `refs/heads/${ref}`,
    ref,
  ]);
  const remoteRef = firstLsRemoteSha(remoteResult.stdout);
  if (remoteResult.status !== 0 || !remoteRef) {
    return {
      ok: true,
      stale: false,
      checkoutDir,
      localRef,
      remoteUrl,
      detail: `Checkout freshness could not resolve origin/${ref}; continuing with local checkout ${localRef.substring(0, 12)}.`,
      remediation:
        'Check network access to the origin remote if freshness warnings persist.',
    };
  }

  if (refsMatch(localRef, remoteRef)) {
    return {
      ok: true,
      stale: false,
      checkoutDir,
      localRef,
      remoteRef,
      remoteUrl,
      detail: `Controller checkout is fresh for origin/${ref} at ${localRef.substring(0, 12)}.`,
    };
  }

  const ancestor = runGit(
    ['merge-base', '--is-ancestor', localRef, remoteRef],
    checkoutDir,
  );
  const relation = ancestor.status === 0 ? 'behind' : 'different from';
  return {
    ok: false,
    stale: true,
    checkoutDir,
    localRef,
    remoteRef,
    remoteUrl,
    detail: `Controller checkout is ${relation} origin/${ref}: local ${localRef.substring(0, 12)}, remote ${remoteRef.substring(0, 12)}.`,
    remediation: TEMPLATE_REMEDIATION,
  };
}

export function shouldBlockForFreshness(publishMode: string): boolean {
  if (process.env.KASEKI_ENFORCE_FRESHNESS === '0') {
    return false;
  }
  return (
    publishMode === 'pr' ||
    publishMode === 'draft_pr' ||
    publishMode === 'branch' ||
    publishMode === 'auto'
  );
}

// =============================================================================
// Template Health Status Checks
// =============================================================================

function getTemplateDoctorTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env.KASEKI_TEMPLATE_DOCTOR_TIMEOUT_MS || '',
    10,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TEMPLATE_DOCTOR_TIMEOUT_MS;
}

function tailTextByLines(content: string, lineCount: number): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return lines.slice(-lineCount).join('\n').trim();
}

function validateTemplateRunScript(
  templateDir: string,
  runScript: string,
  templateRef: string | undefined,
  checkoutDir: string,
): TemplateHealthStatus | null {
  if (!fs.existsSync(runScript)) {
    return {
      ok: false,
      templateDir,
      runScript,
      checkoutDir,
      checkoutRef: templateRef,
      detail: `Missing template runner: ${runScript}`,
      remediation: TEMPLATE_REMEDIATION,
    };
  }
  return null;
}

function validateTemplateFiles(
  templateDir: string,
  runScript: string,
  templateRef: string | undefined,
  checkoutDir: string,
): TemplateHealthStatus | null {
  const missingFiles = REQUIRED_TEMPLATE_FILES.filter(
    (file) => !fs.existsSync(path.join(templateDir, file)),
  );
  if (missingFiles.length > 0) {
    return {
      ok: false,
      templateDir,
      runScript,
      checkoutDir,
      checkoutRef: templateRef,
      detail: `Template is incomplete at ${templateDir}; missing ${missingFiles.join(', ')}.`,
      remediation:
        'Run scripts/kaseki-activate.sh --controller bootstrap, or scripts/kaseki-setup-host.sh --fix before starting the API.',
    };
  }
  return null;
}

function hashFile(filePath: string): string | undefined {
  try {
    return crypto
      .createHash('sha256')
      .update(fs.readFileSync(filePath))
      .digest('hex');
  } catch {
    return undefined;
  }
}

export function checkTemplateActivatorParity(
  templateDir: string,
  checkoutDir: string,
): PreflightCheck {
  const checkoutActivator = path.join(checkoutDir, 'scripts', 'kaseki-activate.sh');
  const templateActivator = path.join(templateDir, 'scripts', 'kaseki-activate.sh');
  const checkoutHash = hashFile(checkoutActivator);
  const templateHash = hashFile(templateActivator);

  if (!checkoutHash || !templateHash) {
    return {
      name: 'template-activator-parity',
      ok: false,
      detail: !checkoutHash
        ? `Checkout activator is not readable: ${checkoutActivator}`
        : `Template activator is not readable: ${templateActivator}`,
      remediation: TEMPLATE_REMEDIATION,
      checkoutActivator,
      templateActivator,
    };
  }

  if (checkoutHash !== templateHash) {
    return {
      name: 'template-activator-parity',
      ok: false,
      detail: 'Template activator differs from checkout activator; deployed template may be stale.',
      remediation: TEMPLATE_REMEDIATION,
      checkoutActivator,
      templateActivator,
      checkoutHash,
      templateHash,
    };
  }

  return {
    name: 'template-activator-parity',
    ok: true,
    detail: 'Template activator matches checkout activator.',
    checkoutActivator,
    templateActivator,
    checksum: checkoutHash,
  };
}

function runTemplateDoctor(runScript: string, checkoutDir: string) {
  const activateScript = path.join(
    checkoutDir,
    'scripts',
    'kaseki-activate.sh',
  );
  const doctorArgs = fs.existsSync(activateScript)
    ? ['bash', activateScript, '--json', 'doctor']
    : ['bash', runScript, '--doctor'];

  return spawnSync(doctorArgs[0], doctorArgs.slice(1), {
    cwd: fs.existsSync(checkoutDir) ? checkoutDir : undefined,
    encoding: 'utf-8',
    timeout: getTemplateDoctorTimeoutMs(),
    maxBuffer: 128 * 1024,
  });
}

function validateTemplateDoctor(
  doctorResult: ReturnType<typeof spawnSync>,
  templateDir: string,
  runScript: string,
  templateRef: string | undefined,
  checkoutDir: string,
): TemplateHealthStatus | null {
  const stderr = `${doctorResult.stderr || ''}${doctorResult.error ? `\n${doctorResult.error.message}` : ''}`;
  const stdout = `${doctorResult.stdout || ''}`;
  const doctorStderrTail = tailTextByLines(
    stderr,
    TEMPLATE_DOCTOR_STDERR_TAIL_LINES,
  );
  const doctorStdoutTail = tailTextByLines(
    stdout,
    TEMPLATE_DOCTOR_STDOUT_TAIL_LINES,
  );
  const doctorArgs = fs.existsSync(
    path.join(checkoutDir, 'scripts', 'kaseki-activate.sh'),
  )
    ? `${path.join(checkoutDir, 'scripts', 'kaseki-activate.sh')} --json doctor`
    : `${runScript} --doctor`;

  if (doctorResult.error || doctorResult.status !== 0) {
    const timedOut =
      doctorResult.error?.message.toLowerCase().includes('timeout') ||
      doctorResult.signal === 'SIGTERM';
    return {
      ok: false,
      templateDir,
      runScript,
      checkoutDir,
      checkoutRef: templateRef,
      doctorCommand: doctorArgs,
      doctorExitCode: doctorResult.status,
      doctorSignal: doctorResult.signal,
      doctorStderrTail,
      doctorStdoutTail,
      detail: timedOut
        ? `Template doctor timed out after ${getTemplateDoctorTimeoutMs()}ms: ${doctorArgs}`
        : `Template doctor failed: ${doctorArgs} exited with ${doctorResult.status ?? 'unknown'}`,
      remediation: TEMPLATE_REMEDIATION,
    };
  }
  return null;
}

export function buildTemplateHealthStatus(
  templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template',
): TemplateHealthStatus {
  const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';
  const checkoutRef = getTemplateCheckoutRef(checkoutDir);
  const runScript = path.join(templateDir, 'run-kaseki.sh');

  // Check 1: Validate run script exists
  let validation = validateTemplateRunScript(
    templateDir,
    runScript,
    checkoutRef,
    checkoutDir,
  );
  if (validation) return validation;

  // Check 2: Validate all required files exist
  validation = validateTemplateFiles(
    templateDir,
    runScript,
    checkoutRef,
    checkoutDir,
  );
  if (validation) return validation;

  // Check 3: Run doctor check
  const doctorResult = runTemplateDoctor(runScript, checkoutDir);
  validation = validateTemplateDoctor(
    doctorResult,
    templateDir,
    runScript,
    checkoutRef,
    checkoutDir,
  );
  if (validation) return validation;

  // All checks passed
  const doctorArgs = fs.existsSync(
    path.join(checkoutDir, 'scripts', 'kaseki-activate.sh'),
  )
    ? `${path.join(checkoutDir, 'scripts', 'kaseki-activate.sh')} --json doctor`
    : `${runScript} --doctor`;

  return {
    ok: true,
    templateDir,
    runScript,
    checkoutDir,
    checkoutRef,
    doctorCommand: doctorArgs,
    doctorExitCode: doctorResult.status,
    doctorSignal: doctorResult.signal,
    doctorStderrTail: '',
    doctorStdoutTail: tailTextByLines(
      `${doctorResult.stdout || ''}`,
      TEMPLATE_DOCTOR_STDOUT_TAIL_LINES,
    ),
    detail: `Template runner passed doctor check: ${runScript}`,
  };
}

function getTemplateHealthCacheTtlMs(): number {
  const raw = process.env.KASEKI_TEMPLATE_HEALTH_CACHE_TTL_MS;
  if (!raw) return DEFAULT_TEMPLATE_HEALTH_CACHE_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_TEMPLATE_HEALTH_CACHE_TTL_MS;
}

function getCachedTemplateHealthStatus(
  templateDir: string,
): TemplateHealthStatus | undefined {
  if (!templateHealthCache) return undefined;
  if (templateHealthCache.templateDir !== templateDir) {
    return undefined;
  }
  if (
    Date.now() - templateHealthCache.checkedAt >
    getTemplateHealthCacheTtlMs()
  ) {
    templateHealthCache = undefined;
    return undefined;
  }
  return templateHealthCache.status;
}

function cacheTemplateHealthStatus(status: TemplateHealthStatus): void {
  templateHealthCache = {
    checkedAt: Date.now(),
    templateDir: status.templateDir,
    status,
  };
}

export function isTemplateDoctorTimeout(status: TemplateHealthStatus): boolean {
  return Boolean(
    status.doctorCommand &&
    (status.detail.toLowerCase().includes('timed out') ||
      status.doctorStderrTail?.toLowerCase().includes('etimedout') ||
      status.doctorSignal === 'SIGTERM'),
  );
}

export function getSubmissionTemplateHealthStatus(
  templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template',
): { status: TemplateHealthStatus; fromCache: boolean } {
  const cached = getCachedTemplateHealthStatus(templateDir);
  if (cached?.ok) {
    return { status: cached, fromCache: true };
  }

  const status = buildTemplateHealthStatus(templateDir);
  if (status.ok) {
    cacheTemplateHealthStatus(status);
  }
  return { status, fromCache: false };
}

export function checkTemplatePublishModeCompatibility(
  publishMode: string,
  templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template',
): TemplatePublishModeCompatibility {
  const metadataPath = path.join(templateDir, '.kaseki-template-version');
  const metadata = readTemplateVersionMetadata(templateDir);

  // Legacy templates do not have this metadata file. Allow them to continue so
  // operators can roll the API and template in either order; once present, the
  // metadata becomes authoritative for compatibility checks.
  if (!metadata?.supportedPublishModes) {
    return { ok: true, metadataPath };
  }

  if (metadata.supportedPublishModes.includes(publishMode)) {
    return {
      ok: true,
      metadataPath,
      supportedPublishModes: metadata.supportedPublishModes,
    };
  }

  return {
    ok: false,
    metadataPath,
    supportedPublishModes: metadata.supportedPublishModes,
    detail: `Template does not support publish mode \`${publishMode}\`; redeploy kaseki-agent.`,
    remediation: 'Redeploy kaseki-agent.',
  };
}

// =============================================================================
// Preflight Checks
// =============================================================================

function parseMountInfo(): Array<{ root: string; mountPoint: string }> {
  try {
    const mountInfoPath =
      process.env.KASEKI_MOUNTINFO_PATH || '/proc/self/mountinfo';
    const content = fs.readFileSync(mountInfoPath, 'utf-8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const fields = line.split(' ');
        return {
          root: fields[3] || '',
          mountPoint: fields[4] || '',
        };
      });
  } catch {
    return [];
  }
}

export function checkDeletedBindMounts(paths: string[]): PreflightCheck {
  const mountInfo = parseMountInfo();
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const deletedMounts = mountInfo.filter((mount) => {
    const root = mount.root.toLowerCase();
    if (!root.includes('deleted')) {
      return false;
    }
    return uniquePaths.some(
      (targetPath) =>
        targetPath === mount.mountPoint ||
        targetPath.startsWith(`${mount.mountPoint}/`),
    );
  });

  if (deletedMounts.length === 0) {
    return {
      name: 'bind-mounts',
      ok: true,
      detail: 'No deleted bind mounts detected for Kaseki paths.',
    };
  }

  const details = deletedMounts
    .map(
      (mount) =>
        `${mount.mountPoint} is backed by deleted source ${mount.root}`,
    )
    .join('; ');

  return {
    name: 'bind-mounts',
    ok: false,
    detail: details,
    remediation:
      'Run: sudo kaseki-agent host setup --fix --recreate-api. If the npm CLI is unavailable, run the packaged scripts/kaseki-setup-host.sh with KASEKI_HOST_SECRETS_DIR set to the host secrets directory.',
  };
}

export function checkWritableDirectory(
  name: string,
  dirPath: string,
  remediation: string,
): PreflightCheck {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return {
      name,
      ok: true,
      detail: `${dirPath} is readable and writable.`,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `${dirPath} is not readable and writable: ${(err as Error).message}`,
      remediation,
    };
  }
}

export function checkLLMGatewayKey(): PreflightCheck {
  if (!isGatewayProviderEnabled()) {
    return {
      name: 'llm-gateway-connectivity',
      ok: true,
      detail: `LLM Gateway URL/key connectivity is not required for KASEKI_PROVIDER=${process.env.KASEKI_PROVIDER || 'gateway'}. Set KASEKI_PROVIDER=gateway to use the primary gateway provider.`,
    };
  }

  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const keyValue = readHostSecret('llm_gateway_api_key');
  const gatewayUrlError = validateGatewayRuntimeUrl(gatewayUrl);

  if (gatewayUrl && !gatewayUrlError && keyValue) {
    return {
      name: 'llm-gateway-connectivity',
      ok: true,
      detail: 'Gateway URL/key connectivity prerequisites are configured for the API container.',
    };
  }

  const locations = getSecretLocations('llm_gateway_api_key');
  const missingParts = [];
  if (!gatewayUrl) missingParts.push('LLM_GATEWAY_URL');
  if (gatewayUrlError) missingParts.push(gatewayUrlError);
  if (!keyValue) missingParts.push('LLM_GATEWAY_API_KEY or LLM_GATEWAY_API_KEY_FILE');

  return {
    name: 'llm-gateway-connectivity',
    ok: false,
    detail: `Gateway URL/key connectivity prerequisites are missing: ${missingParts.join(', ')}`,
    remediation: `Set environment variables:\n  LLM_GATEWAY_URL=<your-gateway-base-endpoint, e.g. https://gateway.example/v1>\n  LLM_GATEWAY_API_KEY_FILE=${locations.primary}\n  or LLM_GATEWAY_API_KEY=<inline-key>`,
  };
}

function validateGatewayRuntimeUrl(gatewayUrl: string | undefined): string | undefined {
  if (!gatewayUrl) return undefined;
  try {
    const parsed = new URL(gatewayUrl);
    if (!parsed.protocol.startsWith('http')) {
      return 'LLM_GATEWAY_URL must use HTTP or HTTPS';
    }
    if (!isResponsesEndpoint(parsed)) {
      return 'LLM_GATEWAY_URL must point to a versioned OpenAI API endpoint (/v1, /v2, etc.)';
    }
    return undefined;
  } catch {
    return 'LLM_GATEWAY_URL must be a valid URL';
  }
}

function isGatewayProviderEnabled(): boolean {
  return (process.env.KASEKI_PROVIDER || 'gateway') === 'gateway';
}

export function checkWorkerGatewayConfig(): PreflightCheck {
  if (!isGatewayProviderEnabled()) {
    return {
      name: 'worker-gateway-secret-mount',
      ok: true,
      detail: `Worker gateway secret mounting is not required for KASEKI_PROVIDER=${process.env.KASEKI_PROVIDER || 'gateway'}.`,
    };
  }

  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewaySecret = resolveGatewayApiKey();
  const hostSecretPath =
    process.env.LLM_GATEWAY_API_KEY_FILE ||
    resolveHostSecretPath('llm_gateway_api_key') ||
    path.join(
      process.env.KASEKI_SECRETS_DIR || '/run/secrets/kaseki',
      'llm_gateway_api_key',
    );
  const missingParts: string[] = [];
  const gatewayUrlError = validateGatewayRuntimeUrl(gatewayUrl);

  if (!gatewayUrl) {
    missingParts.push('LLM_GATEWAY_URL in the API environment');
  } else if (gatewayUrlError) {
    missingParts.push(gatewayUrlError);
  }

  if (!gatewaySecret.configured) {
    missingParts.push('a readable gateway key source for the API gateway test');
  }

  try {
    fs.accessSync(hostSecretPath, fs.constants.R_OK);
  } catch (err) {
    missingParts.push(
      `readable worker-mounted llm_gateway_api_key host path at ${hostSecretPath}: ${(err as Error).message}`,
    );
  }

  if (missingParts.length === 0) {
    return {
      name: 'worker-gateway-secret-mount',
      ok: true,
      detail: `Worker launch has LLM_GATEWAY_URL and a readable llm_gateway_api_key host mount source at ${hostSecretPath}. Worker startup preflight will also verify that pi --list-models reports provider gateway before goal-setting/scouting/coding runs.`,
    };
  }

  return {
    name: 'worker-gateway-secret-mount',
    ok: false,
    detail: `Worker gateway secret mounting configuration is incomplete: ${missingParts.join('; ')}.`,
    remediation:
      'Gateway test passed for the API container only when the API can resolve LLM_GATEWAY_URL and a key; worker containers also require LLM_GATEWAY_URL, a mounted llm_gateway_api_key, and a Pi installation whose extension registry includes provider gateway. Set LLM_GATEWAY_URL in the API environment and create a readable llm_gateway_api_key file at the host path mounted by run-kaseki.sh (or KASEKI_SECRETS_DIR/llm_gateway_api_key), then recreate/restart the API container if mounts changed. If worker-smoke fails at provider capability, rebuild the worker image or install the gateway Pi extension so pi --list-models includes gateway.',
  };
}

export function checkGatewayTestSecretConsistency(): PreflightCheck {
  if (!isGatewayProviderEnabled()) {
    return {
      name: 'gateway-api-secret-consistency',
      ok: true,
      detail: `Gateway API secret consistency is not required for KASEKI_PROVIDER=${process.env.KASEKI_PROVIDER || 'gateway'}.`,
    };
  }

  const preflightSecret = readHostSecret('llm_gateway_api_key');
  const gatewaySecret = resolveGatewayApiKey();

  if (preflightSecret && gatewaySecret.configured) {
    return {
      name: 'gateway-api-secret-consistency',
      ok: true,
      detail: `Gateway Test and preflight can both resolve the LLM Gateway API key (${gatewaySecret.source}).`,
    };
  }

  if (!preflightSecret && !gatewaySecret.configured) {
    return {
      name: 'gateway-api-secret-consistency',
      ok: false,
      detail: 'Neither preflight nor Gateway Test can resolve the LLM Gateway API key.',
      remediation:
        'Set LLM_GATEWAY_API_KEY or create a readable llm_gateway_api_key file in the configured Kaseki secrets directory.',
    };
  }

  return {
    name: 'gateway-api-secret-consistency',
    ok: false,
    detail: `Preflight secret visibility and Gateway Test secret resolution disagree: preflight=${preflightSecret ? 'configured' : 'missing'}, gatewayTest=${gatewaySecret.source}.`,
    remediation:
      'Ensure Gateway Test and preflight use the same secret source: set LLM_GATEWAY_API_KEY consistently or provide a readable llm_gateway_api_key file in KASEKI_SECRETS_DIR.',
  };
}

/**
 * Read a secret from host secrets (no inline env var fallback).
 * Returns undefined if the secret is not found.
 */
function readHostSecretValue(secretName: string): string | undefined {
  const value = readHostSecret(secretName);
  return value || undefined;
}

export function checkGitHubAppCredentials(): PreflightCheck {
  // Check if any GitHub App credentials are present in host secrets
  const appId = readHostSecretValue('github_app_id');
  const clientId = readHostSecretValue('github_app_client_id');
  const privateKey = readHostSecretValue('github_app_private_key');

  if (!appId && !clientId && !privateKey) {
    const idLocations = getSecretLocations('github_app_id');
    const clientLocations = getSecretLocations('github_app_client_id');
    const keyLocations = getSecretLocations('github_app_private_key');
    return {
      name: 'github-app',
      ok: false,
      detail:
        'GitHub App credentials are not configured; default PR creation cannot run.',
      remediation: [
        'Create one secret file per GitHub App credential:',
        `  github_app_id: ${idLocations.primary} or ${idLocations.secondary}`,
        `  github_app_client_id: ${clientLocations.primary} or ${clientLocations.secondary}`,
        `  github_app_private_key: ${keyLocations.primary} or ${keyLocations.secondary}`,
      ].join('\n'),
    };
  }

  const missing: string[] = [];
  if (!appId) {
    missing.push('github_app_id');
  }
  if (!clientId) {
    missing.push('github_app_client_id');
  }
  if (!privateKey) {
    missing.push('github_app_private_key');
  }

  if (missing.length > 0) {
    const secretLocations = missing
      .map((name) => {
        const locations = getSecretLocations(name);
        return `${name}: ${locations.primary} or ${locations.secondary}`;
      })
      .join('; ');
    return {
      name: 'github-app',
      ok: false,
      detail: `GitHub App credentials are incomplete: missing ${missing.join(', ')}.`,
      remediation: `Create the missing secret files:\n${secretLocations}`,
    };
  }
  if (!/^\d+$/.test(appId as string)) {
    return {
      name: 'github-app',
      ok: false,
      detail: 'GitHub App ID is present but is not numeric.',
      remediation:
        'The github_app_id secret file must contain only the numeric GitHub App ID.',
    };
  }
  const privateKeyValidation = validateGitHubAppPrivateKey(
    privateKey as string,
  );
  if (!privateKeyValidation.ok) {
    return {
      name: 'github-app',
      ok: false,
      detail:
        privateKeyValidation.error || 'GitHub App private key is not valid.',
      remediation: privateKeyValidation.remediation,
    };
  }

  return {
    name: 'github-app',
    ok: true,
    detail:
      'GitHub App credentials are readable and structurally valid for PR creation.',
  };
}

function resolveWorkerHostSecretsDir(): string {
  if (process.env.KASEKI_HOST_SECRETS_DIR) {
    return process.env.KASEKI_HOST_SECRETS_DIR;
  }

  const secretFile =
    resolveHostSecretPath('llm_gateway_api_key') ||
    process.env.LLM_GATEWAY_API_KEY_FILE ||
    '/run/secrets/kaseki/llm_gateway_api_key';
  const secretsDir = path.dirname(secretFile);
  return resolveDockerBindSource(secretsDir) || secretsDir;
}

function resolveDockerBindSource(containerPath: string): string | null {
  const containerCandidates = [
    process.env.HOSTNAME,
    readFirstLine('/etc/hostname'),
    process.env.KASEKI_API_CONTAINER_NAME,
    'kaseki-api',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const containerName of [...new Set(containerCandidates)]) {
    const result = execDockerCommand(
      ['inspect', '--format', '{{json .Mounts}}', containerName],
      5000,
    );

    if (!result.ok || !result.stdout) {
      continue;
    }

    try {
      const mounts = JSON.parse(result.stdout) as Array<{
        Destination?: string;
        Source?: string;
        Type?: string;
      }>;
      const match = mounts.find(
        (mount) =>
          mount.Type === 'bind' &&
          mount.Destination === containerPath &&
          typeof mount.Source === 'string' &&
          mount.Source.length > 0,
      );
      if (match?.Source) {
        return match.Source;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractLLMGatewayPathFromStartupDetail(detail: string): string | undefined {
  const patterns = [
    /LLM_GATEWAY_API_KEY_FILE:\s*([^\s]+)/i,
    /LLM_GATEWAY_API_KEY_FILE\s+(?:at|to)\s+([^\s.]+)/i,
    /OPENROUTER_API_KEY_FILE:\s*([^\s]+)/i,
    /OPENROUTER_API_KEY_FILE\s+(?:at|to)\s+([^\s.]+)/i,
    /Create:\s*([^\s]+llm_gateway_api_key)/i,
    /Create:\s*([^\s]+openrouter_api_key)/i,
  ];

  for (const pattern of patterns) {
    const match = detail.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function workerSmokeStartupSecretsRemediation(
  detail: string | undefined,
): string | undefined {
  if (!detail) {
    return undefined;
  }

  const normalized = detail.toLowerCase();
  const includesStartupSecretsWarning = [
    'no openrouter api key configured',
    'github app credentials are incomplete',
    'openrouter_api_key_file',
    'openrouter_api_key',
    'llm_gateway_api_key',
  ].some((warning) => normalized.includes(warning));

  if (!includesStartupSecretsWarning) {
    return undefined;
  }

  const isOpenRouter = normalized.includes('openrouter');
  const keyName = isOpenRouter ? 'openrouter_api_key' : 'llm_gateway_api_key';
  const effectivePath =
    extractLLMGatewayPathFromStartupDetail(detail) ||
    `/run/secrets/kaseki/${keyName}`;

  return `The API can read host secrets, but the nested worker smoke test did not receive the same files. The effective LLM Gateway API key path reported by startup checks is ${effectivePath}. /run/secrets/kaseki/${keyName} is the API container and nested worker secret mount used by /api/preflight and run-kaseki.sh. Ensure the API container bind-mounts the host secrets directory, for example /home/pi/secrets:/run/secrets/kaseki:ro. If this persists, set KASEKI_HOST_SECRETS_DIR to the host path and recreate the API container.`;
}

function workerSmokeStartupResultsRemediation(
  detail: string | undefined,
): string | undefined {
  if (!detail) {
    return undefined;
  }

  const normalized = detail.toLowerCase();
  const includesStartupResultsWarning = [
    '/agents/kaseki-results is not mounted',
    '/results is not mounted',
    'error detected; startup blocked',
  ].some((warning) => normalized.includes(warning));

  if (!includesStartupResultsWarning) {
    return undefined;
  }

  return 'The worker smoke container reached startup checks, but its results directory bind mount is missing or not writable. Ensure KASEKI_RESULTS_DIR=/results is passed to the worker smoke container and bind-mount the configured results directory to that path with write access. If KASEKI_RESULTS_DIR is changed, the smoke container must mount that configured results directory writable.';
}

export function checkWorkerSmokeTest(
  config: KasekiApiConfig,
  image: string,
): PreflightCheck {
  const hostSecretsDir = resolveWorkerHostSecretsDir();
  const smokeRoot = path.join(
    config.resultsDir,
    `.preflight-worker-${randomUUID()}`,
  );
  const workspaceDir = path.join(smokeRoot, 'workspace');
  const resultsDir = path.join(smokeRoot, 'results');
  const cacheDir = path.join(smokeRoot, 'cache');

  try {
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    const result = execDockerCommand(
      [
        'run',
        '--rm',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,nosuid,nodev,size=64m',
        '--security-opt',
        'no-new-privileges:true',
        '--cap-drop',
        'ALL',
        '-u',
        `${process.getuid?.() || 10000}:${process.getgid?.() || 10000}`,
        '-e',
        'LLM_GATEWAY_API_KEY_FILE=/run/secrets/kaseki/llm_gateway_api_key',
        '-e',
        `KASEKI_PROVIDER=${process.env.KASEKI_PROVIDER || 'gateway'}`,
        '-e',
        `LLM_GATEWAY_URL=${process.env.LLM_GATEWAY_URL || ''}`,
        '-e',
        'LLM_GATEWAY_API_KEY_FILE=/run/secrets/kaseki/llm_gateway_api_key',
        '-e',
        'KASEKI_SECRETS_DIR=/run/secrets/kaseki',
        '-e',
        'KASEKI_RESULTS_DIR=/results',
        '-e',
        'TMPDIR=/workspace/tmp',
        '-e',
        'PI_EXTENSIONS_DIR=/opt/kaseki/pi-extensions',
        '-v',
        `${workspaceDir}:/workspace:rw`,
        '-v',
        `${resultsDir}:/results:rw`,
        '-v',
        `${cacheDir}:/cache:rw`,
        '-v',
        `${hostSecretsDir}:/run/secrets/kaseki:ro`,
        '--entrypoint',
        '/bin/sh',
        image,
        '-c',
        'for file in /usr/local/bin/kaseki-agent /usr/local/bin/scripts/agent-prompt.sh /usr/local/bin/scripts/allowlist-helper.sh /usr/local/bin/scripts/dependency-cache-helpers.sh /usr/local/bin/scripts/lib/json.sh; do if [ ! -r "$file" ]; then echo "missing packaged worker helper: $file" >&2; exit 66; fi; done; if [ ! -x /usr/local/bin/kaseki-agent ]; then echo "packaged worker agent is not executable: /usr/local/bin/kaseki-agent" >&2; exit 66; fi; exec /scripts/startup-checks.sh worker',
      ],
      30000,
    );

    if (result.ok) {
      return {
        name: 'worker-smoke',
        ok: true,
        detail:
          'Worker container can start with workspace, results, cache, LLM secret mounts, packaged agent helpers, and a worker TMPDIR path that may need runtime creation.',
      };
    }

    const startupSecretsRemediation = workerSmokeStartupSecretsRemediation(
      result.detail,
    );
    const startupResultsRemediation = workerSmokeStartupResultsRemediation(
      result.detail,
    );
    const classified = result.classification || {
      detail: result.detail || 'Worker container smoke test failed.',
      remediation:
        'Check worker bind mounts, file ownership, Docker socket access, the LLM secret files, and packaged /usr/local/bin/scripts helper files.',
    };
    return {
      name: 'worker-smoke',
      ok: false,
      detail: classified.detail,
      remediation:
        startupSecretsRemediation ||
        startupResultsRemediation ||
        classified.remediation,
    };
  } catch (err) {
    return {
      name: 'worker-smoke',
      ok: false,
      detail: `Worker smoke test could not prepare temporary directories: ${(err as Error).message}`,
      remediation:
        'Ensure KASEKI_RESULTS_DIR is writable by the API container user.',
    };
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}
