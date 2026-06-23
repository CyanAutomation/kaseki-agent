/**
 * src/kaseki-api-routes-preflight.ts
 *
 * High-complexity preflight response builder extracted from kaseki-api-routes.ts.
 * This module encapsulates the preflight check collection and response building logic,
 * reducing cognitive complexity in the main routes file.
 *
 * **Cognitive Complexity Reduction (Fallow)**:
 * - Extracted from kaseki-api-routes.ts (cognitive: 51 in main function)
 * - Organized preflight checks into logical phases
 * - Separated environment resolution from check collection
 */

import * as fs from 'fs';
import * as path from 'path';
import { PreflightCheck, PreflightResponse } from './kaseki-api-types';
import { KasekiApiConfig } from './kaseki-api-config';
import { execDockerCommand } from './lib/subprocess-helpers';
import { readFirstLine, commandOutput } from './utils/file-helpers';

/**
 * Imported check functions from main routes file.
 * These are exported by kaseki-api-routes for internal use by preflight builder.
 */
import {
  checkDeletedBindMounts,
  checkWritableDirectory,
  checkLLMGatewayKey,
  checkGatewayTestSecretConsistency,
  checkWorkerGatewayConfig,
  checkGitHubAppCredentials,
  checkWorkerSmokeTest,
  buildTemplateHealthStatus,
  resolveCheckoutFreshness,
  checkTemplateActivatorParity,
} from './kaseki-api-routes';

/**
 * Builds a comprehensive preflight response by collecting health checks for:
 * - Docker daemon and image availability
 * - Template health (files, doctor check, freshness)
 * - LLM gateway connectivity and secrets
 * - GitHub App credentials
 * - Worker smoke test
 *
 * The response includes detailed failure information and remediation steps.
 * Non-critical checks that fail result in 'degraded' status; critical failures result in 'error' status.
 *
 * @param config - API configuration with results directory and runtime settings
 * @returns PreflightResponse with check results, runtime info, and Docker/template metadata
 */
export function buildPreflightResponse(config: KasekiApiConfig): PreflightResponse {
  const templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';
  const secretsDir = process.env.KASEKI_SECRETS_DIR || '/run/secrets/kaseki';
  const image = readKasekiImage(templateDir);
  const templateImageDigest =
    readFirstLine(path.join(templateDir, '.kaseki-image-digest')) ||
    inspectImageDigest(image);
  const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';
  const templateRef = getTemplateCheckoutRef(checkoutDir);
  const checks: PreflightCheck[] = [];

  // Phase 1: Basic environment checks
  checks.push(
    checkDeletedBindMounts([
      config.resultsDir,
      templateDir,
      checkoutDir,
      secretsDir,
    ]),
  );

  checks.push(
    checkWritableDirectory(
      'results-dir',
      config.resultsDir,
      'Create the results directory and make it writable by the API container user. If /api/preflight reports a deleted bind mount, recreate the API container.',
    ),
  );

  // Phase 2: LLM and GitHub credentials
  checks.push(checkLLMGatewayKey());
  checks.push(checkGatewayTestSecretConsistency());
  checks.push(checkWorkerGatewayConfig());
  checks.push(checkGitHubAppCredentials());

  // Phase 3: Docker daemon and image checks
  const dockerVersion = execDockerCommand([
    'version',
    '--format',
    '{{.Client.Version}} -> {{.Server.Version}}',
  ]);
  if (dockerVersion.ok) {
    checks.push({
      name: 'docker-daemon',
      ok: true,
      detail: dockerVersion.stdout,
    });
  } else {
    const classified = dockerVersion.classification || {
      detail: 'Docker command failed',
      remediation: 'Check Docker daemon',
    };
    checks.push({ name: 'docker-daemon', ok: false, ...classified });
  }

  const imageInspect = execDockerCommand(['image', 'inspect', image]);
  let imageReady = false;
  if (imageInspect.ok) {
    imageReady = true;
    checks.push({
      name: 'docker-image',
      ok: true,
      detail: `Image is present: ${image}`,
    });
  } else {
    const classified = imageInspect.classification || {
      detail: 'Docker command failed',
      remediation: 'Check Docker daemon',
    };
    const daemonFailed = checks.some(
      (check) => check.name === 'docker-daemon' && !check.ok,
    );
    checks.push({
      name: 'docker-image',
      ok: false,
      detail: daemonFailed
        ? classified.detail
        : `Docker image is not present locally: ${image}`,
      remediation: daemonFailed
        ? classified.remediation
        : `Pull ${image} or set KASEKI_IMAGE to an available image.`,
    });
  }

  // Phase 4: Worker smoke test (conditional on Docker checks)
  const canRunWorkerSmoke =
    imageReady &&
    checks.some((check) => check.name === 'docker-daemon' && check.ok);
  if (canRunWorkerSmoke) {
    checks.push(checkWorkerSmokeTest(config, image));
  } else {
    checks.push({
      name: 'worker-smoke',
      ok: false,
      detail:
        'Worker smoke test skipped because Docker daemon or image checks failed.',
      remediation: 'Fix docker-daemon and docker-image preflight checks first.',
    });
  }

  // Phase 5: Template health and freshness
  const templateHealth = buildTemplateHealthStatus(templateDir);
  const freshness = resolveCheckoutFreshness(
    checkoutDir,
    process.env.KASEKI_REF || 'main',
    templateDir,
  );
  checks.push({
    name: 'template',
    ok: templateHealth.ok,
    detail: templateHealth.detail,
    remediation: templateHealth.remediation,
    templatePath: templateHealth.templateDir,
    checkoutRef: templateHealth.checkoutRef,
    doctorCommand: templateHealth.doctorCommand,
    doctorStderrTail: templateHealth.doctorStderrTail,
    doctorStdoutTail: templateHealth.doctorStdoutTail,
  });
  checks.push(checkTemplateActivatorParity(templateDir, checkoutDir));
  checks.push({
    name: 'checkout-freshness',
    ok: freshness.ok,
    detail: freshness.detail,
    remediation: freshness.remediation,
    templatePath: templateDir,
    checkoutRef: freshness.localRef?.substring(0, 12),
    localRef: freshness.localRef,
    remoteRef: freshness.remoteRef,
    remoteUrl: freshness.remoteUrl,
  });

  // Determine overall status based on check results
  const status = checks.every((check) => check.ok)
    ? 'ok'
    : checks.some((check) => check.name === 'docker-daemon' && !check.ok)
      ? 'error'
      : 'degraded';
  const failedChecks = checks.filter((check) => !check.ok);

  return {
    status,
    timestamp: new Date().toISOString(),
    checkCount: checks.length,
    failedChecks,
    checks,
    image,
    imageDigest: templateImageDigest,
    templateImage: image,
    templateImageDigest,
    templateDir,
    templateRef: freshness.localRef || templateRef,
    resultsDir: config.resultsDir,
    runtime: {
      nodeVersion: process.version,
      uid: process.getuid?.(),
      gid: process.getgid?.(),
      groups: process.getgroups?.(),
    },
    docker: {
      version: dockerVersion.stdout,
      clientVersion: dockerVersion.stdout?.split(' -> ')[0],
      serverVersion: dockerVersion.stdout?.split(' -> ')[1],
    },
  };
}

/**
 * Helper: Read Kaseki image name from env or template file.
 * Falls back to default registry image if not configured.
 */
function readKasekiImage(templateDir = '/agents/kaseki-template'): string {
  if (process.env.KASEKI_IMAGE) {
    return process.env.KASEKI_IMAGE;
  }
  const imageFile = path.join(templateDir, '.kaseki-image');
  try {
    const value = fs.readFileSync(imageFile, 'utf-8').trim();
    if (value) {
      return value;
    }
  } catch {
    // Fall through to the registry default.
  }
  return 'docker.io/cyanautomation/kaseki-agent:latest';
}

/**
 * Helper: Inspect Docker image to get its digest.
 */
function inspectImageDigest(image: string): string | undefined {
  return commandOutput('docker', [
    'image',
    'inspect',
    image,
    '--format',
    '{{range .RepoDigests}}{{println .}}{{end}}',
  ])
    ?.split(/\r?\n/)
    .find((line: string) => line.trim().length > 0);
}

/**
 * Helper: Get template checkout ref (short SHA).
 */
function getTemplateCheckoutRef(
  checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent',
): string | undefined {
  return fs.existsSync(path.join(checkoutDir, '.git'))
    ? commandOutput('git', ['rev-parse', '--short', 'HEAD'], checkoutDir)
    : undefined;
}
