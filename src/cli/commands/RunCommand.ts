/**
 * Run Command
 * Execute kaseki agent on target repository
 */

import { BaseCommand } from '../BaseCommand';
import { DockerManager } from '../../docker/DockerManager';
import { InstanceManager } from '../../instance/InstanceManager';
import { DoctorCommand } from './DoctorCommand';
import { createLogger } from '../../logger';

const logger = createLogger('run-cmd');

export class RunCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      const { positional } = this.parseArgs(args);

      // Parse arguments
      const repoUrl = positional[0] || this.configManager.get('repo.url', '');
      const gitRef = positional[1] || this.configManager.get('repo.ref', '');
      const taskPrompt = positional[2] || this.configManager.get('repo.task_prompt', '');

      if (!repoUrl || !gitRef) {
        console.error('Usage: kaseki-agent run <REPO_URL> [GIT_REF] [TASK_PROMPT]');
        console.error('Example: kaseki-agent run https://github.com/org/repo main');
        return 1;
      }

      console.log('🚀 Kaseki Agent Runner\n');
      console.log(`Repository: ${repoUrl}`);
      console.log(`Branch: ${gitRef}\n`);

      // Load configuration
      await this.configManager.load();

      // Step 1: Pre-flight checks
      console.log('Step 1/6: Running pre-flight checks...');
      const doctorCmd = new DoctorCommand(this.configManager);
      const doctorResult = await doctorCmd.execute(['--json']);
      if (doctorResult !== 0) {
        console.error('❌ Pre-flight checks failed');
        return 1;
      }
      console.log('✓ Pre-flight checks passed\n');

      // Step 2: Pull Docker image
      console.log('Step 2/6: Preparing Docker image...');
      const image = this.configManager.get('docker.image', 'docker.io/cyanautomation/kaseki-agent:latest');
      const autoPull = this.configManager.get('docker.auto_pull', true);

      if (!DockerManager.imageExists(image)) {
        if (!autoPull) {
          console.error(`❌ Docker image not found: ${image}`);
          console.error('Enable auto-pull or pull manually: docker pull ' + image);
          return 1;
        }

        console.log('Image not found locally, pulling from registry...');
        if (!DockerManager.pullImage(image)) {
          console.error(`❌ Failed to pull Docker image: ${image}`);
          return 1;
        }
      }
      console.log(`✓ Docker image ready: ${image}\n`);

      // Step 3: Create instance
      console.log('Step 3/6: Creating instance...');
      const kasekiRoot = this.configManager.get('directories.root', '/agents');
      const instanceManager = new InstanceManager(kasekiRoot);
      const instanceId = await instanceManager.getOrCreateInstanceId();

      const { workspace, results } = await instanceManager.createDirectories();
      console.log(`✓ Instance created: ${instanceId}`);
      console.log(`  Workspace: ${workspace}`);
      console.log(`  Results: ${results}\n`);

      // Initialize metadata
      await instanceManager.initializeMetadata({
        repoUrl,
        gitRef,
        model: this.configManager.get('agent.model', 'openrouter/free'),
        provider: this.configManager.get('agent.provider', 'openrouter'),
      });

      // Step 4: Prepare environment
      console.log('Step 4/6: Preparing environment...');
      const environment = this.buildEnvironment(repoUrl, gitRef, taskPrompt);

      // Validate that required auth files are available (should have been validated by doctor)
      const apiKeyFile = this.configManager.get('auth.openrouter_api_key_file', '');
      if (!apiKeyFile) {
        console.error('❌ OpenRouter API Key File not configured. Run: kaseki-agent doctor');
        return 1;
      }

      console.log('✓ Environment prepared\n');

      // Step 5: Run agent in Docker
      console.log('Step 5/6: Running kaseki agent in Docker...\n');
      const timeout = this.configManager.get('agent.timeout_seconds', 1200);

      const stageStart = new Date();
      const containerResult = await DockerManager.runContainer({
        image,
        name: instanceId,
        workspaceDir: workspace,
        resultsDir: results,
        cacheDir: this.configManager.get('directories.cache_dir', '/agents/kaseki-cache'),
        apiKeyFile,
        environment,
        timeout,
        entrypoint: '/usr/local/bin/kaseki-entrypoint',
        command: ['agent'],
      });

      const stageEnd = new Date();
      await instanceManager.recordStage('agent-run', containerResult.exitCode, stageStart, stageEnd);

      console.log('\n✓ Agent execution completed\n');

      // Step 6: Finalize
      console.log('Step 6/6: Finalizing...');
      await instanceManager.finalize(containerResult.exitCode);

      // Report summary
      const metadata = await instanceManager.getMetadata();
      if (metadata) {
        console.log('\n📊 Run Summary');
        console.log(`Instance: ${instanceId}`);
        console.log(`Status: ${metadata.status}`);
        console.log(`Duration: ${metadata.stages?.['agent-run']?.duration?.toFixed(1)}s`);

        if (containerResult.exitCode === 0) {
          console.log('\n✅ Run completed successfully');
          console.log(`View results: kaseki-agent report ${instanceId}`);
        } else {
          console.log(`\n❌ Run failed with exit code ${containerResult.exitCode}`);

          // Provide contextual error messaging for common exit codes
          const errorContext = this.getExitCodeContext(containerResult.exitCode);
          if (errorContext) {
            console.log(`\nℹ️  ${errorContext}`);
          }

          console.log(`View logs: kaseki-agent report ${instanceId}`);
        }
      }

      return containerResult.exitCode;
    } catch (error) {
      logger.error(`Run failed: ${error}`);
      return 1;
    }
  }

  /**
   * Build environment variables for container
   */
  private buildEnvironment(repoUrl: string, gitRef: string, taskPrompt: string): Record<string, string> {
    const env: Record<string, string> = {};

    // Repo configuration
    env.REPO_URL = repoUrl;
    env.GIT_REF = gitRef;

    // Agent configuration
    const model = this.configManager.get('agent.model', '');
    if (model) env.KASEKI_MODEL = model;

    const provider = this.configManager.get('agent.provider', '');
    if (provider) env.KASEKI_PROVIDER = provider;

    const timeout = this.configManager.get('agent.timeout_seconds', 0);
    if (timeout) env.KASEKI_AGENT_TIMEOUT_SECONDS = String(timeout);

    // Task prompt
    if (taskPrompt) {
      env.TASK_PROMPT = taskPrompt;
    }

    // Validation
    const validationCommands = this.configManager.get('validation.commands', []);
    if (validationCommands.length > 0) {
      env.KASEKI_VALIDATION_COMMANDS = validationCommands.join(';');
    }

    const skipMissingScripts = this.configManager.get('validation.skip_missing_npm_scripts', false);
    if (skipMissingScripts) env.KASEKI_SKIP_MISSING_NPM_SCRIPTS = '1';

    const failFast = this.configManager.get('validation.fail_fast', false);
    if (failFast !== undefined) env.KASEKI_VALIDATION_FAIL_FAST = failFast ? '1' : '0';

    // Allowlist
    const allowlist = this.configManager.get('validation.allowlist', []);
    if (allowlist.length > 0) {
      env.KASEKI_CHANGED_FILES_ALLOWLIST = allowlist.join(' ');
    }

    const maxDiffBytes = this.configManager.get('validation.max_diff_bytes', 0);
    if (maxDiffBytes) env.KASEKI_MAX_DIFF_BYTES = String(maxDiffBytes);

    // Caching
    const cacheMode = this.configManager.get('caching.dependency_restore_mode', '');
    if (cacheMode) env.KASEKI_DEPENDENCY_RESTORE_MODE = cacheMode;

    // GitHub integration (validated by doctor command)
    const ghAppId = this.configManager.get('auth.github_app_id_file', '');
    if (ghAppId) env.GITHUB_APP_ID_FILE = ghAppId;

    const ghClientId = this.configManager.get('auth.github_app_client_id_file', '');
    if (ghClientId) env.GITHUB_APP_CLIENT_ID_FILE = ghClientId;

    const ghPrivateKey = this.configManager.get('auth.github_app_private_key_file', '');
    if (ghPrivateKey) env.GITHUB_APP_PRIVATE_KEY_FILE = ghPrivateKey;

    // API key file (never inline, validated by doctor command)
    const apiKeyFile = this.configManager.get('auth.openrouter_api_key_file', '');
    if (apiKeyFile) {
      env.OPENROUTER_API_KEY_FILE = '/run/secrets/openrouter_api_key';
    }

    // Debug flags
    const streamProgress = this.configManager.get('debug.stream_progress', true);
    if (streamProgress !== undefined) env.KASEKI_STREAM_PROGRESS = streamProgress ? '1' : '0';

    const keepWorkspace = this.configManager.get('debug.keep_workspace', false);
    if (keepWorkspace !== undefined) env.KASEKI_KEEP_WORKSPACE = keepWorkspace ? '1' : '0';

    return env;
  }

  /**
   * Get contextual error message for common exit codes
   */
  private getExitCodeContext(exitCode: number): string | null {
    const contexts: Record<number, string> = {
      1: 'General error. Check the logs for details.',
      2: 'Configuration error. Ensure all required settings are configured.',
      3: 'Empty git diff. No changes were made.',
      4: 'Diff size exceeded maximum allowed bytes. Consider adjusting max_diff_bytes.',
      5: 'Changed files are outside the allowlist. Check the changed files against allowed patterns.',
      6: 'Secret scan detected potential credentials. Ensure no secrets are included.',
      7: 'Validation phase files outside allowlist. Adjust validation allowlist patterns.',
      124: 'Agent timeout. The task took longer than the configured timeout. Increase agent.timeout_seconds.',
      127: 'Docker initialization failed. The kaseki-entrypoint script is missing from the image. Run: kaseki-agent doctor',
    };

    return contexts[exitCode] || null;
  }
}
