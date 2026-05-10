/**
 * github-operations-monitor.ts
 * 
 * Monitoring module for analyzing kaseki github operations failures.
 * Provides functions to detect, classify, and analyze github operations stage failures.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Metadata {
  current_stage?: string;
  github_push_exit_code?: number;
  github_pr_exit_code?: number;
  github_api_error_type?: string;
  github_api_error_message?: string;
  github_api_http_status?: string;
  exit_code?: number;
}

interface FailureJson {
  stage?: string;
  exit_code?: number;
  failed_command?: string;
  stderr_tail?: string;
}

interface DiagnosticResult {
  hasFailed: boolean;
  failureType: string;
  description: string;
  exitCode: number;
  stage: string;
  apiError?: {
    type: string;
    message: string;
    httpStatus: string;
  };
  logs: {
    gitPushLogTail?: string[];
    lastCommandLog?: string[];
    healthCheckLog?: string[];
  };
}

/**
 * Detect if kaseki run had a github operations failure
 */
export function isGithubOperationFailure(metadataPath: string): boolean {
  try {
    const content = fs.readFileSync(metadataPath, 'utf8');
    const metadata: Metadata = JSON.parse(content);
    return metadata.current_stage === 'github operations' && (metadata.exit_code ?? 0) !== 0;
  } catch {
    return false;
  }
}

/**
 * Analyze a kaseki run for github operations failures
 */
export function analyzeGithubOperations(resultsDir: string): DiagnosticResult {
  const metadataPath = path.join(resultsDir, 'metadata.json');
  const failurePath = path.join(resultsDir, 'failure.json');
  const gitPushLogPath = path.join(resultsDir, 'git-push.log');
  const lastCommandLogPath = path.join(resultsDir, 'last-command.log');
  const healthCheckLogPath = path.join(resultsDir, 'github-health-check.log');

  const result: DiagnosticResult = {
    hasFailed: false,
    failureType: 'unknown',
    description: 'No failure detected',
    exitCode: 0,
    stage: 'unknown',
    logs: {},
  };

  // Read metadata
  let metadata: Metadata = {};
  try {
    const content = fs.readFileSync(metadataPath, 'utf8');
    metadata = JSON.parse(content);
  } catch (e) {
    result.description = `Failed to read metadata: ${e}`;
    return result;
  }

  // Read failure.json for additional context
  let failure: FailureJson = {};
  try {
    if (fs.existsSync(failurePath)) {
      const content = fs.readFileSync(failurePath, 'utf8');
      failure = JSON.parse(content);
    }
  } catch (e) {
    // Failure.json might not exist if success
  }

  result.stage = metadata.current_stage ?? 'unknown';
  result.exitCode = metadata.exit_code ?? 0;

  // Classify failure
  if (metadata.current_stage !== 'github operations') {
    result.hasFailed = false;
    result.description = `Failure occurred in stage '${metadata.current_stage}', not github operations`;
    return result;
  }

  if (result.exitCode === 0) {
    result.hasFailed = false;
    result.description = 'GitHub operations completed successfully';
    return result;
  }

  result.hasFailed = true;

  // Determine failure type
  const pushExit = metadata.github_push_exit_code ?? 0;
  const prExit = metadata.github_pr_exit_code ?? 0;

  if (pushExit !== 0 && prExit === 0) {
    result.failureType = 'git_push_failed';
    result.description = `Git push failed with exit code ${pushExit}`;
  } else if (prExit !== 0) {
    result.failureType = 'pr_creation_failed';
    result.description = `GitHub PR creation failed with exit code ${prExit}`;

    // Include API error details
    if (metadata.github_api_error_type || metadata.github_api_error_message) {
      result.apiError = {
        type: metadata.github_api_error_type ?? 'unknown',
        message: metadata.github_api_error_message ?? '',
        httpStatus: metadata.github_api_http_status ?? '',
      };
      result.description += ` (${result.apiError.type}: ${result.apiError.message})`;
    }
  } else if (pushExit === 0 && prExit === 0) {
    result.failureType = 'post_github_ops_failure';
    result.description =
      'GitHub operations succeeded but overall exit code is non-zero (failure in cleanup/trap)';
  } else {
    result.failureType = 'unknown_failure_pattern';
    result.description = `Unknown failure pattern: push_exit=${pushExit}, pr_exit=${prExit}, overall_exit=${result.exitCode}`;
  }

  // Collect logs
  if (fs.existsSync(gitPushLogPath)) {
    const content = fs.readFileSync(gitPushLogPath, 'utf8');
    result.logs.gitPushLogTail = content.split('\n').slice(-30).filter((l) => l.trim());
  }

  if (fs.existsSync(lastCommandLogPath)) {
    const content = fs.readFileSync(lastCommandLogPath, 'utf8');
    result.logs.lastCommandLog = content.split('\n').filter((l) => l.trim());
  }

  if (fs.existsSync(healthCheckLogPath)) {
    const content = fs.readFileSync(healthCheckLogPath, 'utf8');
    result.logs.healthCheckLog = content.split('\n').filter((l) => l.trim());
  }

  return result;
}

/**
 * Format diagnostic result as human-readable markdown
 */
export function formatDiagnosticResult(result: DiagnosticResult): string {
  let output = `# GitHub Operations Diagnostic\n\n`;

  output += `**Stage:** ${result.stage}\n`;
  output += `**Exit code:** ${result.exitCode}\n`;
  output += `**Failure detected:** ${result.hasFailed ? 'Yes' : 'No'}\n`;
  output += `**Failure type:** ${result.failureType}\n\n`;

  output += `## Summary\n\n${result.description}\n\n`;

  if (result.apiError) {
    output += `## API Error Details\n\n`;
    output += `- **Type:** ${result.apiError.type}\n`;
    output += `- **Message:** ${result.apiError.message}\n`;
    output += `- **HTTP Status:** ${result.apiError.httpStatus}\n\n`;
  }

  if (result.logs.gitPushLogTail && result.logs.gitPushLogTail.length > 0) {
    output += `## Git Push Log (last 30 lines)\n\n\`\`\`\n`;
    output += result.logs.gitPushLogTail.join('\n');
    output += `\n\`\`\`\n\n`;
  }

  if (result.logs.lastCommandLog && result.logs.lastCommandLog.length > 0) {
    output += `## Last Command Log\n\n\`\`\`\n`;
    output += result.logs.lastCommandLog.join('\n');
    output += `\n\`\`\`\n\n`;
  }

  if (result.logs.healthCheckLog && result.logs.healthCheckLog.length > 0) {
    output += `## Health Check Log\n\n\`\`\`\n`;
    output += result.logs.healthCheckLog.join('\n');
    output += `\n\`\`\`\n\n`;
  }

  return output;
}

// CLI usage
if (require.main === module) {
  const resultsDir = process.argv[2];

  if (!resultsDir) {
    console.error('Usage: npx ts-node github-operations-monitor.ts <results-directory>');
    process.exit(1);
  }

  const result = analyzeGithubOperations(resultsDir);
  const formatted = formatDiagnosticResult(result);
  console.log(formatted);

  process.exit(result.hasFailed && result.failureType === 'post_github_ops_failure' ? 1 : 0);
}
