/**
 * Quickstart Command
 *
 * Single happy-path setup for the production API mode:
 *   1. Detect host environment
 *   2. Discover secrets at well-known locations
 *   3. Write ~/.kaseki/config.json
 *   4. Bootstrap /agents (with sudo if needed)
 *   5. Start kaseki-api via docker (or docker run fallback)
 *   6. Wait for /ready body to confirm the API is truly ready
 *   7. Smoke-test the authenticated /api/runs endpoint
 */

import { BaseCommand } from '../BaseCommand';
import { ConfigManager } from '../../config/ConfigManager';
import { EnvironmentValidator } from '../validators/EnvironmentValidator';
import { SecretResolver, DiscoveredSecrets } from '../resolvers/SecretResolver';
import { AgentsBootstrapper } from '../bootstrappers/AgentsBootstrapper';
import { ContainerLauncher } from '../launchers/ContainerLauncher';
import { createLogger } from '../../logger';

const logger = createLogger('quickstart-cmd');

export class QuickstartCommand extends BaseCommand {
  private environmentValidator: EnvironmentValidator;
  private secretResolver: SecretResolver;
  private agentsBootstrapper: AgentsBootstrapper;
  private containerLauncher: ContainerLauncher;

  constructor(configManager: ConfigManager) {
    super(configManager);
    this.environmentValidator = new EnvironmentValidator();
    this.secretResolver = new SecretResolver(configManager);
    this.agentsBootstrapper = new AgentsBootstrapper(configManager);
    this.containerLauncher = new ContainerLauncher(configManager);
  }

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
      const env = this.environmentValidator.check();
      this.environmentValidator.printSummary(env);

      if (!env.hasDocker) {
        console.error('\n❌ Docker is required. Install from https://docs.docker.com/install/');
        return 1;
      }

      // Step 2: Discover secrets
      console.log('\nStep 2/7: Discovering secrets...');
      const secrets = this.secretResolver.discover();
      this.secretResolver.printSummary(secrets);

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
        await this.agentsBootstrapper.writeConfig(secrets);
        console.log('  ✓ Config written to ~/.kaseki/config.json');
      } else {
        console.log('  [dry-run] would write ~/.kaseki/config.json');
      }

      // Step 4: Bootstrap /agents
      console.log('\nStep 4/7: Bootstrapping /agents directory...');
      const bootstrapResult = await this.agentsBootstrapper.bootstrap(dryRun);
      if (!bootstrapResult.ok) {
        console.error(`\n❌ Could not create /agents: ${bootstrapResult.error}`);
        console.error('\nRun manually:');
        console.error('  sudo mkdir -p /agents/kaseki-results /agents/kaseki-runs /agents/kaseki-cache');
        console.error('  sudo chown -R 10000:10000 /agents');
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
        const apiKey = this.secretResolver.readApiKey(secrets) ?? 'changeme';
        const startResult = this.containerLauncher.launch(apiKey);
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
        const readyResult = await this.containerLauncher.waitForReadiness();
        if (!readyResult.ok) {
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
        const apiKey = this.secretResolver.readApiKey(secrets);
        if (apiKey) {
          const smokeResult = await this.containerLauncher.smokeTest(apiKey);
          if (smokeResult.ok) {
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

  private printSuccess(secrets: DiscoveredSecrets, dryRun: boolean): void {
    const apiKey = this.secretResolver.readApiKey(secrets);

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
