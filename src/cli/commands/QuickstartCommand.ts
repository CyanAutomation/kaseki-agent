/**
 * Quickstart Command
 *
 * Single happy-path setup for the production API mode:
 *   1. Detect host environment
 *   2. Discover secrets at well-known locations
 *   3. Write ~/.kaseki/config.json
 *   4. Bootstrap /agents (with sudo if needed)
 *   5. Start kaseki-api via docker-compose (or docker run fallback)
 *   6. Wait for /ready body to confirm the API is truly ready
 *   7. Smoke-test the authenticated /api/runs endpoint
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, accessSync, readFileSync, constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('quickstart-cmd');

const AGENTS_SUBDIRS = ['kaseki-results', 'kaseki-runs', 'kaseki-cache'];
const CONTAINER_UID = 10000;
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 2_000;

interface SecretLocation {
  filePath: string;
  source: string;
}

interface DiscoveredSecrets {
  openrouterKeyFile: SecretLocation | null;
  githubAppIdFile: SecretLocation | null;
  githubAppClientIdFile: SecretLocation | null;
  githubAppPrivateKeyFile: SecretLocation | null;
  kasekiApiKeysFile: SecretLocation | null;
}

export class QuickstartCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
      this.printHelp();
      return 0;
    }

    const dryRun = args.includes('--dry-run');
    if (dryRun) {
      console.log('[dry-run] No changes will be made.\n');
    }

    try {
      await this.configManager.load();

      // Step 1: Detect environment
      console.log('Step 1/7: Detecting environment...');
      const env = this.detectEnvironment();
      this.printEnvSummary(env);

      if (!env.hasDocker) {
        console.error('\n❌ Docker is required. Install from https://docs.docker.com/install/');
        return 1;
      }

      // Step 2: Discover secrets
      console.log('\nStep 2/7: Discovering secrets...');
      const secrets = this.discoverSecrets();
      this.printSecretsSummary(secrets);

      if (!secrets.openrouterKeyFile) {
        console.error('\n❌ OpenRouter API key not found.');
        console.error('   Place it at ~/secrets/openrouter_api_key  OR');
        console.error('   set OPENROUTER_API_KEY_FILE in your environment.');
        return 1;
      }
      const missingGithubSecrets = [
        ['GitHub App ID', secrets.githubAppIdFile, 'github_app_id', 'GITHUB_APP_ID_FILE'],
        ['GitHub App Client ID', secrets.githubAppClientIdFile, 'github_app_client_id', 'GITHUB_APP_CLIENT_ID_FILE'],
        ['GitHub App private key', secrets.githubAppPrivateKeyFile, 'github_app_private_key', 'GITHUB_APP_PRIVATE_KEY_FILE'],
      ].filter(([, location]) => !location);

      if (missingGithubSecrets.length > 0) {
        console.error('\n❌ GitHub App credentials are incomplete.');
        console.error('   Default Kaseki runs create GitHub PRs, so these secrets are required:');
        for (const [label, , filename, envVar] of missingGithubSecrets) {
          console.error(`   - ${label}: place it at ~/secrets/${filename} OR set ${envVar}`);
        }
        return 1;
      }

      // Step 3: Write config
      console.log('\nStep 3/7: Writing ~/.kaseki/config.json...');
      if (!dryRun) {
        await this.writeConfig(secrets);
        console.log('  ✓ Config written to ~/.kaseki/config.json');
      } else {
        console.log('  [dry-run] would write ~/.kaseki/config.json');
      }

      // Step 4: Bootstrap /agents
      console.log('\nStep 4/7: Bootstrapping /agents directory...');
      const bootstrapResult = this.bootstrapAgentsDir(dryRun);
      if (!bootstrapResult.ok) {
        console.error(`\n❌ Could not create /agents: ${bootstrapResult.error}`);
        console.error('\nRun manually:');
        console.error('  sudo mkdir -p /agents/kaseki-results /agents/kaseki-runs /agents/kaseki-cache');
        console.error(`  sudo chown -R ${CONTAINER_UID}:${CONTAINER_UID} /agents`);
        console.error('  sudo chmod 755 /agents');
        console.error('\nThen re-run: kaseki-agent quickstart');
        return 1;
      }
      if (bootstrapResult.message) {
        console.log(`  ${bootstrapResult.message}`);
      }

      // Step 5: Start container
      console.log('\nStep 5/7: Starting kaseki-api container...');
      if (!dryRun) {
        const startResult = this.startContainer(secrets);
        if (!startResult.ok) {
          console.error(`\n❌ Failed to start container: ${startResult.error}`);
          return 1;
        }
        console.log('  ✓ Container started');
      } else {
        console.log('  [dry-run] would start kaseki-api container');
      }

      // Step 6: Wait for /ready
      console.log('\nStep 6/7: Waiting for API to become ready...');
      if (!dryRun) {
        const readyResult = await this.waitForReady();
        if (!readyResult) {
          console.error('\n❌ API did not become ready within 60s.');
          console.error('   Check: docker logs kaseki-api');
          console.error('   Verify: /agents is writable by UID 10000 (ls -la /agents)');
          return 1;
        }
        console.log('  ✓ API is ready at http://localhost:8080');
      } else {
        console.log('  [dry-run] would wait for http://localhost:8080/ready');
      }

      // Step 7: Smoke test
      console.log('\nStep 7/7: Verifying authenticated access...');
      if (!dryRun) {
        const apiKey = this.readApiKey(secrets);
        if (apiKey) {
          const smokeResult = await this.smokeTest(apiKey);
          if (smokeResult) {
            console.log('  ✓ Authenticated access confirmed (GET /api/runs succeeded)');
          } else {
            console.warn('  ⚠️  Auth smoke test failed — check KASEKI_API_KEYS in your container env');
          }
        } else {
          console.warn('  ⚠️  No API key found to test with; skipping auth check');
        }
      } else {
        console.log('  [dry-run] would POST to /api/runs to confirm auth');
      }

      this.printSuccess(secrets, dryRun);
      return 0;
    } catch (error) {
      logger.error(`Quickstart failed: ${error}`);
      console.error(`\n❌ Quickstart error: ${(error as Error).message}`);
      if (process.env.DEBUG === '1') {
        console.error(error);
      }
      return 1;
    }
  }

  // ── Environment detection ─────────────────────────────────────────────────

  private detectEnvironment(): { hasDocker: boolean; nodeVersion: string | null; hasSudo: boolean; agentsWritable: boolean } {
    let hasDocker = false;
    try {
      execSync('docker --version', { stdio: 'ignore' });
      execSync('docker ps', { stdio: 'ignore' });
      hasDocker = true;
    } catch { /* docker unavailable */ }

    let nodeVersion: string | null = null;
    try {
      nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
    } catch { /* node unavailable */ }

    let hasSudo = false;
    try {
      execSync('sudo -n true', { stdio: 'ignore' });
      hasSudo = true;
    } catch { /* no passwordless sudo */ }

    let agentsWritable = false;
    try {
      accessSync('/agents', fsConstants.W_OK);
      agentsWritable = true;
    } catch { /* not writable or missing */ }

    return { hasDocker, nodeVersion, hasSudo, agentsWritable };
  }

  private printEnvSummary(env: ReturnType<QuickstartCommand['detectEnvironment']>): void {
    console.log(`  Docker:       ${env.hasDocker ? '✓' : '✗ not found'}`);
    console.log(`  Node.js:      ${env.nodeVersion ?? '✗ not found'}`);
    console.log(`  /agents:      ${env.agentsWritable ? '✓ writable' : '✗ missing or not writable'}`);
    console.log(`  sudo:         ${env.hasSudo ? 'available' : 'not available (may need manual step)'}`);
  }

  // ── Secret discovery ──────────────────────────────────────────────────────

  private discoverSecrets(): DiscoveredSecrets {
    const home = os.homedir();

    const resolve = (configKey: string, envVar: string, filename: string): SecretLocation | null => {
      const candidates: Array<{ filePath: string; source: string }> = [
        { filePath: this.configManager.get(configKey, ''), source: `~/.kaseki/config.json (${configKey})` },
        { filePath: process.env[envVar] ?? '', source: `$${envVar}` },
        { filePath: path.join(home, '.kaseki', 'secrets', filename), source: `~/.kaseki/secrets/${filename}` },
        { filePath: path.join(home, 'secrets', filename), source: `~/secrets/${filename}` },
      ];
      for (const c of candidates) {
        if (c.filePath && existsSync(c.filePath)) {
          return c;
        }
      }
      return null;
    };

    return {
      openrouterKeyFile:      resolve('auth.openrouter_api_key_file', 'OPENROUTER_API_KEY_FILE', 'openrouter_api_key'),
      githubAppIdFile:        resolve('auth.github_app_id_file', 'GITHUB_APP_ID_FILE', 'github_app_id'),
      githubAppClientIdFile:  resolve('auth.github_app_client_id_file', 'GITHUB_APP_CLIENT_ID_FILE', 'github_app_client_id'),
      githubAppPrivateKeyFile: resolve('auth.github_app_private_key_file', 'GITHUB_APP_PRIVATE_KEY_FILE', 'github_app_private_key'),
      kasekiApiKeysFile:      resolve('api.key_file', 'KASEKI_API_KEYS_FILE', 'kaseki_api_keys'),
    };
  }

  private printSecretsSummary(secrets: DiscoveredSecrets): void {
    const show = (label: string, loc: SecretLocation | null): void => {
      if (loc) {
        console.log(`  ✓ ${label}: ${loc.source}`);
      } else {
        console.log(`  ✗ ${label}: not found`);
      }
    };
    show('OpenRouter key      ', secrets.openrouterKeyFile);
    show('GitHub App ID       ', secrets.githubAppIdFile);
    show('GitHub App Client ID', secrets.githubAppClientIdFile);
    show('GitHub App key      ', secrets.githubAppPrivateKeyFile);
    show('Kaseki API keys     ', secrets.kasekiApiKeysFile);
  }

  // ── Config write ─────────────────────────────────────────────────────────

  private async writeConfig(secrets: DiscoveredSecrets): Promise<void> {
    const kasekiDir = path.join(os.homedir(), '.kaseki');
    await fs.mkdir(kasekiDir, { recursive: true, mode: 0o700 });

    const auth: Record<string, string> = {};
    if (secrets.openrouterKeyFile) auth.openrouter_api_key_file = secrets.openrouterKeyFile.filePath;
    if (secrets.githubAppIdFile) auth.github_app_id_file = secrets.githubAppIdFile.filePath;
    if (secrets.githubAppClientIdFile) auth.github_app_client_id_file = secrets.githubAppClientIdFile.filePath;
    if (secrets.githubAppPrivateKeyFile) auth.github_app_private_key_file = secrets.githubAppPrivateKeyFile.filePath;

    const config = {
      auth,
      api: {
        url: 'http://localhost:8080/api',
        ...(secrets.kasekiApiKeysFile ? { key_file: secrets.kasekiApiKeysFile.filePath } : {}),
      },
    };

    await fs.writeFile(
      path.join(kasekiDir, 'config.json'),
      JSON.stringify(config, null, 2),
      { mode: 0o600 }
    );
  }

  // ── /agents bootstrap ─────────────────────────────────────────────────────

  private bootstrapAgentsDir(dryRun: boolean): { ok: boolean; error?: string; message?: string } {
    const allReady = ['/agents', ...AGENTS_SUBDIRS.map((d) => `/agents/${d}`)].every(
      (p) => existsSync(p)
    );

    if (allReady) {
      return { ok: true, message: '✓ /agents already set up' };
    }

    if (dryRun) {
      return { ok: true, message: '[dry-run] would create /agents with UID 10000 ownership' };
    }

    // Create directories individually with array-based arguments (prevents injection)
    const dirsToCreate = ['/agents', ...AGENTS_SUBDIRS.map((d) => `/agents/${d}`)];

    for (const dir of dirsToCreate) {
      const mkdirResult = spawnSync('mkdir', ['-p', dir], { stdio: 'pipe' });
      if (mkdirResult.status !== 0) {
        const sudoResult = spawnSync('sudo', ['mkdir', '-p', dir], { stdio: 'inherit' });
        if (sudoResult.status !== 0) {
          return { ok: false, error: `Failed to create directory: ${dir}` };
        }
      }
    }

    // Set ownership
    const chownResult = spawnSync('chown', ['-R', `${CONTAINER_UID}:${CONTAINER_UID}`, '/agents'], { stdio: 'pipe' });
    if (chownResult.status !== 0) {
      const sudoResult = spawnSync('sudo', ['chown', '-R', `${CONTAINER_UID}:${CONTAINER_UID}`, '/agents'], { stdio: 'inherit' });
      if (sudoResult.status !== 0) {
        return { ok: false, error: 'Failed to set ownership on /agents' };
      }
    }

    // Set permissions
    const chmodResult = spawnSync('chmod', ['755', '/agents'], { stdio: 'pipe' });
    if (chmodResult.status !== 0) {
      const sudoResult = spawnSync('sudo', ['chmod', '755', '/agents'], { stdio: 'inherit' });
      if (sudoResult.status !== 0) {
        return { ok: false, error: 'Failed to set permissions on /agents' };
      }
    }

    return { ok: true, message: '✓ /agents created with UID 10000 ownership' };
  }

  // ── Container start ───────────────────────────────────────────────────────

  private startContainer(secrets: DiscoveredSecrets): { ok: boolean; error?: string } {
    // Remove any existing (broken) container first
    spawnSync('docker', ['rm', '-f', 'kaseki-api'], { stdio: 'ignore' });

    const image = this.configManager.get('docker.image', 'docker.io/cyanautomation/kaseki-agent:latest');
    const secretsDir = path.join(os.homedir(), 'secrets');
    const apiKey = this.readApiKey(secrets) ?? 'changeme';

    // Get docker GID for socket access
    let dockerGid = '985';
    try {
      const result = execSync('getent group docker | cut -d: -f3', { encoding: 'utf-8' }).trim();
      if (result) dockerGid = result;
    } catch { /* use default */ }

    const args = [
      'run', '-d',
      '--name', 'kaseki-api',
      '--restart', 'unless-stopped',
      '--user', `${CONTAINER_UID}:${CONTAINER_UID}`,
      '--group-add', dockerGid,
      '-p', '8080:8080',
      '-e', 'KASEKI_API_PORT=8080',
      '-e', 'KASEKI_API_LOG_LEVEL=info',
      '-e', 'KASEKI_API_MAX_CONCURRENT_RUNS=3',
      '-e', 'KASEKI_RESULTS_DIR=/agents/kaseki-results',
      '-e', 'KASEKI_SECRETS_DIR=/run/secrets/kaseki',
      '-e', `KASEKI_HOST_SECRETS_DIR=${secretsDir}`,
      '-e', `KASEKI_CONTAINER_USER=${CONTAINER_UID}:${CONTAINER_UID}`,
      '-e', `KASEKI_CONTAINER_UID=${CONTAINER_UID}`,
      '-e', `KASEKI_CONTAINER_GID=${CONTAINER_UID}`,
      '-e', 'KASEKI_AGENT_TIMEOUT_SECONDS=3600',
      '-e', 'KASEKI_MAX_DIFF_BYTES=400000',
      '-e', `KASEKI_API_KEYS=${apiKey}`,
      '-e', 'OPENROUTER_API_KEY_FILE=/run/secrets/kaseki/openrouter_api_key',
      '-e', 'GITHUB_APP_ID_FILE=/run/secrets/kaseki/github_app_id',
      '-e', 'GITHUB_APP_CLIENT_ID_FILE=/run/secrets/kaseki/github_app_client_id',
      '-e', 'GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/kaseki/github_app_private_key',
      '-v', '/agents:/agents:rw',
      '-v', `${secretsDir}:/run/secrets/kaseki:ro`,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--read-only',
      '--tmpfs', '/tmp',
      '--tmpfs', '/var/tmp',
      '--tmpfs', '/run',
      '--tmpfs', '/results',
      image,
      'api',
    ];

    const result = spawnSync('docker', args, { stdio: 'pipe', encoding: 'utf-8' });
    if (result.status !== 0) {
      return { ok: false, error: result.stderr?.trim() || 'docker run failed' };
    }
    return { ok: true };
  }

  private readApiKey(secrets: DiscoveredSecrets): string | null {
    if (secrets.kasekiApiKeysFile) {
      try {
        const content = readFileSync(secrets.kasekiApiKeysFile.filePath, 'utf-8').trim();
        const firstKey = content.split(/\r?\n/).find((l) => l.trim());
        return firstKey ?? null;
      } catch { /* fall through */ }
    }
    // Check env
    const envKey = process.env.KASEKI_API_KEYS ?? process.env.KASEKI_API_KEY;
    return envKey ?? null;
  }

  // ── Readiness wait ────────────────────────────────────────────────────────

  private async waitForReady(): Promise<boolean> {
    const url = 'http://127.0.0.1:8080/ready';
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        const body = await res.json() as { status?: string };
        if (body.status === 'ready') {
          return true;
        }
      } catch { /* container still starting */ }

      await new Promise((r) => setTimeout(r, READY_POLL_MS));
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    return false;
  }

  // ── Smoke test ────────────────────────────────────────────────────────────

  private async smokeTest(apiKey: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('http://127.0.0.1:8080/api/runs', {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Output helpers ────────────────────────────────────────────────────────

  private printSuccess(secrets: DiscoveredSecrets, dryRun: boolean): void {
    const apiKey = this.readApiKey(secrets);

    console.log('\n✅ Kaseki quickstart complete!\n');
    console.log('  Config:   ~/.kaseki/config.json');
    console.log('  API:      http://localhost:8080');
    console.log('  Docs:     http://localhost:8080/docs');
    console.log('');

    if (!dryRun && apiKey) {
      console.log('Submit your first task:');
      console.log(`  export KASEKI_API_KEY=${apiKey}`);
      console.log('  kaseki-agent run https://github.com/CyanAutomation/crudmapper main "List all public methods"');
      console.log('  kaseki-agent list');
      console.log('  kaseki-agent status kaseki-1');
    } else {
      console.log('Submit your first task:');
      console.log('  export KASEKI_API_KEY=<your-bearer-token>');
      console.log('  kaseki-agent run <repo-url> <branch> "<task>"');
    }

    console.log('');
    console.log('Verify health:');
    console.log('  kaseki-agent doctor');
    console.log('  kaseki-agent host preflight');
  }

  private printHelp(): void {
    console.log(`
kaseki-agent quickstart - one-command setup for the production API mode

USAGE
  kaseki-agent quickstart [--dry-run]

OPTIONS
  --dry-run    Detect and plan without making any changes

WHAT IT DOES
  1. Detects Docker, Node.js, sudo access
  2. Discovers secrets at ~/.kaseki/secrets/, ~/secrets/, or $ENV_VAR
  3. Writes ~/.kaseki/config.json with resolved secret paths
  4. Creates /agents/{kaseki-results,kaseki-runs,kaseki-cache} owned by UID 10000
     (uses sudo if needed; prints exact commands if sudo is unavailable)
  5. Starts the kaseki-api container via docker run
  6. Waits for http://localhost:8080/ready body to confirm ready status
  7. Smoke-tests authenticated access to /api/runs

SECRETS DISCOVERY ORDER
  For each secret, checks in priority order:
    1. ~/.kaseki/config.json auth.* field
    2. Environment variable ($OPENROUTER_API_KEY_FILE, etc.)
    3. ~/.kaseki/secrets/<filename>
    4. ~/secrets/<filename>
`);
  }
}
