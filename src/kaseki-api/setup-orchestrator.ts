import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createEventLogger } from '../logger';

const logger = createEventLogger('setup-orchestrator');

const TEMPLATE_FALLBACK_ENTRIES = [
  'run-kaseki.sh',
  'kaseki-agent.sh',
  'scripts/kaseki-activate.sh',
  'scripts/kaseki-preflight.sh',
  'lib/pi-event-filter.js',
  'lib/pi-progress-stream.js',
  'lib/kaseki-report.js',
  'lib/github-app-token.js',
] as const;

/**
 * Context returned after successful setup initialization
 */
export interface SetupContext {
  nodeVersionValid: boolean;
  templateInitialized: boolean;
  templateDir: string;
}

/**
 * Internal test seam for setup orchestration dependencies.
 */
export interface InitializeSetupDependencies {
  assertNodeVersion?: () => void;
  ensureTemplate?: (templateDir: string) => Promise<void>;
}

/**
 * Validates that the runtime Node version meets minimum requirements
 * @throws Calls process.exit(1) if validation fails
 */
export function assertSupportedNodeVersion(
  version: string = process.versions.node,
  minimumMajor: number = 24,
): void {
  const normalizedVersion = version.trim();
  const isValidVersion = /^\d+(?:\.\d+){0,2}$/.test(normalizedVersion);
  const major = Number.parseInt(normalizedVersion.split('.')[0] ?? '', 10);

  logger.info(`Node runtime detected: v${normalizedVersion}`);

  if (!isValidVersion || !Number.isFinite(major) || major < minimumMajor) {
    logger.error(
      `Unsupported Node.js runtime v${normalizedVersion}. Kaseki API service requires Node.js >= ${minimumMajor}. Please upgrade Node or deploy the Docker image built from this repo's Dockerfile (node:24-bookworm-slim).`,
    );
    process.exit(1);
  }
}

/**
 * Phase 3: Auto-initialize /agents/kaseki-template if missing
 * This eliminates the need for manual 'kaseki-activate.sh --controller bootstrap'
 *
 * Tries three strategies in order:
 * 1. Copy from /app/kaseki-template (Docker image seed)
 * 2. Create symlink to /app/run-kaseki.sh (Docker fallback)
 * 3. Continue with warning (jobs will fail with clear error message)
 */
export async function ensureTemplateInitialized(templateDir: string): Promise<void> {
  const runScript = path.join(templateDir, 'run-kaseki.sh');
  const missingFallbackEntries = TEMPLATE_FALLBACK_ENTRIES.filter((entry) => !fs.existsSync(path.join(templateDir, entry)));

  // Check if bootstrap is already complete
  if (missingFallbackEntries.length === 0) {
    logger.info('Template directory is initialized', { templateDir, runScript });
    return;
  }

  // Template is missing - try to initialize it
  logger.info('Template directory incomplete; attempting auto-initialization...', {
    templateDir,
    missing: missingFallbackEntries,
  });

  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(templateDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true, mode: 0o755 });
      logger.info('Created parent directory', { parentDir });
    }

    // Try strategy 1: Copy from image
    // If we're running in Docker and the template exists at /app/kaseki-template, copy it
    const imageTemplateDir = '/app/kaseki-template';
    if (fs.existsSync(imageTemplateDir) && fs.existsSync(path.join(imageTemplateDir, 'run-kaseki.sh'))) {
      try {
        execSync(`cp -r "${imageTemplateDir}" "${templateDir}"`, { stdio: 'pipe' });
        logger.info('Template initialized from Docker image', { templateDir });
        return;
      } catch (err) {
        logger.warn('Failed to copy template from image; trying alternate strategy', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Try strategy 2: Create symlinks to /app (if we're in Docker)
    const imageAppDir = process.env.KASEKI_IMAGE_APP_DIR || '/app';
    if (fs.existsSync(path.join(imageAppDir, 'run-kaseki.sh'))) {
      try {
        fs.mkdirSync(templateDir, { recursive: true, mode: 0o755 });
        for (const entry of TEMPLATE_FALLBACK_ENTRIES) {
          const source = path.join(imageAppDir, entry);
          const target = path.join(templateDir, entry);
          if (!fs.existsSync(source) || fs.existsSync(target)) {
            continue;
          }
          fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
          fs.symlinkSync(source, target, 'file');
        }
        logger.info('Template initialized via symlinks to image app directory', {
          templateDir,
          imageAppDir,
        });
        return;
      } catch (err) {
        logger.warn('Failed to create symlink; trying alternate strategy', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Strategy 3 failed - log warning but continue
    // The API will start but jobs will fail with clear error message
    logger.warn(
      'Could not auto-initialize template directory. Jobs will fail until bootstrap is completed manually.',
      {
        templateDir,
        remediation: 'Run: docker exec <container> /scripts/startup-checks.sh bootstrap',
      },
    );
  } catch (err) {
    logger.error('Unexpected error during template initialization', {
      error: err instanceof Error ? err.message : String(err),
      templateDir,
    });
    // Continue anyway - jobs will fail with clear error message
  }
}

/**
 * Orchestrates setup initialization: validates Node version and initializes template directory
 *
 * @param templateDir - Path to template directory (defaults to KASEKI_TEMPLATE_DIR env var or /agents/kaseki-template)
 * @returns SetupContext with initialization status
 * @throws Calls process.exit(1) if Node version validation fails
 */
export async function initializeSetup(
  templateDir?: string,
  dependencies: InitializeSetupDependencies = {},
): Promise<SetupContext> {
  const resolvedTemplateDir = templateDir || process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';
  const assertNodeVersion = dependencies.assertNodeVersion ?? assertSupportedNodeVersion;
  const ensureTemplate = dependencies.ensureTemplate ?? ensureTemplateInitialized;

  logger.info('Starting setup orchestration', { templateDir: resolvedTemplateDir });

  // Validate Node version (will call process.exit(1) if invalid)
  assertNodeVersion();

  // Initialize template directory
  await ensureTemplate(resolvedTemplateDir);

  logger.info('Setup orchestration complete');

  return {
    nodeVersionValid: true,
    templateInitialized: true,
    templateDir: resolvedTemplateDir,
  };
}
