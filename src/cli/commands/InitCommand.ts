/**
 * Init Command
 * New unified setup wizard (replaces old setup command)
 *
 * Provides single entry point for all setup paths:
 * - Single-run execution
 * - Local API service
 * - Production REST API
 */

import { SetupWizard } from '../../setup/SetupWizard';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('init-cmd');

export class InitCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      // Check for command-specific flags
      const dryRun = args.includes('--dry-run');
      const importLegacy = args.includes('--import-legacy');
      const force = args.includes('--force');

      // Show help if requested
      if (args.includes('--help') || args.includes('-h')) {
        this.printHelp();
        return 0;
      }

      // Run the unified setup wizard
      const wizard = new SetupWizard();
      const context = await wizard.run({
        dryRun,
        importLegacy,
        force,
      });

      // Show path-specific guidance
      if (!dryRun) {
        this.printNextSteps(context);
      }

      return 0;
    } catch (error) {
      logger.error(`Setup failed: ${error}`);
      if (process.env.DEBUG === '1') {
        console.error(error);
      }
      return 1;
    }
  }

  /**
   * Print command help
   */
  private printHelp(): void {
    console.log(`
kaseki-agent init - Unified setup wizard for all execution paths

USAGE
  kaseki-agent init [OPTIONS]

OPTIONS
  --dry-run            Validate setup without saving configuration
  --import-legacy      Migrate configuration from old setup paths
  --force              Skip permission validation and proceed (advanced users only)
  --help, -h           Show this help message

DESCRIPTION
  Interactive wizard for first-time configuration. Guides you through:

  1. Environment detection (Docker, Node.js, permissions)
  2. Execution path selection (single-run, local API, production API)
  3. Essential 8 configuration (API key, validation, timeouts, etc)
  4. Auto-generated defaults for advanced variables
  5. Secure credential storage

  Configuration is saved to:
  - ~/.kaseki/secrets.json (API keys, mode 0600)
  - ~/.kaseki/config.json (configuration metadata)
  - .env (current directory, for Docker/source control)

EXAMPLES
  # Interactive setup
  kaseki-agent init

  # Dry-run (validate without saving)
  kaseki-agent init --dry-run

  # Migrate from old setup paths
  kaseki-agent init --import-legacy

DOCUMENTATION
  For more information:
  - Quick start: https://github.com/CyanAutomation/kaseki-agent/blob/main/docs/QUICK_START.md
  - Advanced config: https://github.com/CyanAutomation/kaseki-agent/blob/main/docs/ADVANCED_CONFIG.md
    `);
  }

  /**
   * Print next steps based on execution path
   */
  private printNextSteps(context: any): void {
    const pathGuides: Record<string, string> = {
      'single-run': `
Next steps for single-run execution:

1. Export the API key:
   export OPENROUTER_API_KEY=$(grep openrouter_api_key ~/.kaseki/secrets.json | cut -d'"' -f4)

2. Run a task:
   ./run-kaseki.sh --repo https://github.com/user/repo --ref main

3. Check results:
   ls -la /agents/kaseki-results/
      `,

      'local-api': `
Next steps for local API service:

1. Install dependencies:
   npm install

2. Start the API service:
   npx kaseki-agent serve --port 8080

3. In another terminal, submit a task:
   npx kaseki-agent run https://github.com/user/repo main

4. Check status:
   npx kaseki-agent list
   npx kaseki-agent status kaseki-1
      `,

      'production-api': `
Next steps for production REST API:

1. Start Docker Compose:
   docker-compose up -d

2. Check service health:
   curl http://localhost:8080/health
   docker-compose logs -f kaseki-api

3. Submit a task via API:
   curl -X POST http://localhost:8080/api/runs \\
     -H "Authorization: Bearer $(grep kaseki_api_keys ~/.kaseki/secrets.json | head -1)" \\
     -H "Content-Type: application/json" \\
     -d '{
       "repo_url": "https://github.com/user/repo",
       "git_ref": "main",
       "task_prompt": "Fix TypeScript errors"
     }'

4. Monitor progress:
   curl http://localhost:8080/api/runs
      `,
    };

    const guide = pathGuides[context.path] || pathGuides['single-run'];
    console.log(guide);
  }
}
