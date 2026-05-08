#!/usr/bin/env node

/**
 * Kaseki Agent CLI
 * 
 * Main entry point for @cyanautomation/kaseki-agent npm package
 * Provides subcommands for setup, running agents, health checks, configuration, and reporting
 */

import process from 'process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger';
import { ConfigManager } from './config/ConfigManager';
import { KasekiCLI } from './cli/KasekiCLI';

const logger = createLogger('kaseki-cli');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Main CLI entry point
 */
async function main() {
  try {
    // Parse CLI arguments and dispatch to appropriate subcommand
    const args = process.argv.slice(2);
    
    // Handle --version first (quick check)
    if (args.includes('--version') || args.includes('-v')) {
      const version = await getVersion();
      console.log(version);
      process.exit(0);
    }
    
    // Handle --help first (quick check)
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      printHelp();
      process.exit(0);
    }
    
    // Initialize CLI
    const configManager = new ConfigManager();
    const cli = new KasekiCLI(configManager);
    
    // Get subcommand (first non-flag argument)
    const subcommand = args[0];
    
    // Dispatch to appropriate command handler
    const exitCode = await cli.dispatch(subcommand, args.slice(1));
    process.exit(exitCode);
  } catch (error) {
    if (error instanceof Error) {
      logger.error(error.message);
      if (process.env.DEBUG === '1') {
        console.error(error);
      }
    } else {
      logger.error('Unknown error occurred');
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Get version from package.json
 */
async function getVersion(): Promise<string> {
  try {
    const packagePath = path.join(__dirname, '../package.json');
    const content = await fs.readFile(packagePath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Print CLI help message
 */
function printHelp(): void {
  console.log(`
kaseki-agent - Ephemeral coding-agent runner

USAGE
  kaseki-agent <command> [options]

COMMANDS
  setup                      Interactive setup wizard (first-time configuration)
  run [REPO] [REF]          Run kaseki agent on target repository
  doctor [--json] [--fix]   Health checks and dependency validation
  serve [--port N]          Start REST API service for async execution
  config [--get|--set]      Manage configuration
  list [--status STATE]     List all kaseki instances
  report <INSTANCE_ID>      Generate report for completed instance
  secrets                   Manage stored secrets (keyring/file)

COMMON OPTIONS
  --help, -h                Show this help message
  --version, -v             Show version number
  --config FILE             Use alternative config file
  --verbose                 Verbose output
  --json                    JSON output format

EXAMPLES
  # First-time setup
  kaseki-agent setup

  # Verify environment
  kaseki-agent doctor --verbose

  # Run agent on a repository
  kaseki-agent run https://github.com/CyanAutomation/crudmapper main

  # Start API service
  kaseki-agent serve --port 8080

  # List completed instances
  kaseki-agent list --status completed

DOCUMENTATION
  For more information, visit: https://github.com/CyanAutomation/kaseki-agent
  Check README.md and docs/ for detailed guides

ENVIRONMENT
  KASEKI_ROOT              Base directory for runs/results (default: /agents)
  OPENROUTER_API_KEY_FILE  Path to API key file (default: ~/.kaseki/secrets/openrouter_api_key)
  DEBUG                    Enable debug output (set to 1)
`);
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
