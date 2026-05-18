/**
 * EnvironmentValidator - Detects and validates host environment prerequisites
 * Checks for Docker, Node.js, sudo availability, and /agents directory writeability
 */

import { execSync } from 'child_process';
import { accessSync, constants as fsConstants } from 'fs';
import { createLogger } from '../../logger';

const logger = createLogger('environment-validator');

export interface EnvironmentCheck {
  hasDocker: boolean;
  nodeVersion: string | null;
  hasSudo: boolean;
  agentsWritable: boolean;
}

export class EnvironmentValidator {
  /**
   * Detect the current host environment and check for required prerequisites
   */
  check(): EnvironmentCheck {
    const hasDocker = this.checkDocker();
    const nodeVersion = this.checkNodeVersion();
    const hasSudo = this.checkSudo();
    const agentsWritable = this.checkAgentsDirWritable();

    return { hasDocker, nodeVersion, hasSudo, agentsWritable };
  }

  /**
   * Check if Docker is installed and running
   */
  private checkDocker(): boolean {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      execSync('docker ps', { stdio: 'ignore' });
      return true;
    } catch {
      logger.debug('Docker not available');
      return false;
    }
  }

  /**
   * Check if Node.js is installed and get its version
   */
  private checkNodeVersion(): string | null {
    try {
      return execSync('node --version', { encoding: 'utf-8' }).trim();
    } catch {
      logger.debug('Node.js not available');
      return null;
    }
  }

  /**
   * Check if passwordless sudo is available
   */
  private checkSudo(): boolean {
    try {
      execSync('sudo -n true', { stdio: 'ignore' });
      return true;
    } catch {
      logger.debug('Passwordless sudo not available');
      return false;
    }
  }

  /**
   * Check if /agents directory exists and is writable by current user
   */
  private checkAgentsDirWritable(): boolean {
    try {
      accessSync('/agents', fsConstants.W_OK);
      return true;
    } catch {
      logger.debug('/agents directory not writable or missing');
      return false;
    }
  }

  /**
   * Print a summary of environment checks to console
   */
  printSummary(env: EnvironmentCheck): void {
    console.log(`  Docker:       ${env.hasDocker ? '✓' : '✗ not found'}`);
    console.log(`  Node.js:      ${env.nodeVersion ?? '✗ not found'}`);
    console.log(`  /agents:      ${env.agentsWritable ? '✓ writable' : '✗ missing or not writable'}`);
    console.log(`  sudo:         ${env.hasSudo ? 'available' : 'not available (may need manual step)'}`);
  }
}
