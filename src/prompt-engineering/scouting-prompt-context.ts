/**
 * Scouting-aware TASK_PROMPT context builder
 *
 * Extracts build capability and async-impact information from scouting artifacts
 * and creates context strings for embedding into the main agent's TASK_PROMPT.
 */

import type { BuildCapabilityInfo } from '../build-capability-detector';
import type { AsyncImpactAnalysis } from '../scouting/async-impact-analyzer';

export interface ScoutingPromptContext {
  buildContext: string;
  asyncContext: string;
  combinedContext: string;
  hasBuildInfo: boolean;
  hasAsyncInfo: boolean;
}

/**
 * Build context for TASK_PROMPT from scouting build discovery
 *
 * @param buildCapability - Detected build capability
 * @returns Build context string for embedding in TASK_PROMPT
 */
export function buildBuildContext(buildCapability: BuildCapabilityInfo | null): string {
  if (!buildCapability?.detected || !buildCapability.command) {
    return '';
  }

  return `🔧 **Build System**: ${buildCapability.language} (command: \`${buildCapability.command}\`)
  Your changes will be validated by running: \`${buildCapability.command}\`
  Ensure compilation succeeds with no errors or type mismatches.`;
}

/**
 * Build context for TASK_PROMPT from scouting async-impact analysis
 *
 * @param asyncImpact - Detected async impact
 * @returns Async context string for embedding in TASK_PROMPT
 */
export function buildAsyncContext(asyncImpact: AsyncImpactAnalysis | null): string {
  if (!asyncImpact?.hasAsyncChanges || asyncImpact.asyncKeywords.length === 0) {
    return '';
  }

  const sections: string[] = [];

  sections.push(
    `⚠️ **Async Changes Detected**: This task involves: ${asyncImpact.asyncKeywords.join(', ')}`,
  );

  // Mock files section
  if (asyncImpact.mockFiles.length > 0) {
    const mocks = asyncImpact.mockFiles.slice(0, 5).map((f: string) => `\`${f}\``).join(', ');
    const more = asyncImpact.mockFiles.length > 5 ? ` (and ${asyncImpact.mockFiles.length - 5} more)` : '';
    sections.push(`- **Mock Files to Update**: ${mocks}${more}`);
  }

  // Test files section
  if (asyncImpact.testFiles.length > 0) {
    const tests = asyncImpact.testFiles.slice(0, 5).map((f: string) => `\`${f}\``).join(', ');
    const more = asyncImpact.testFiles.length > 5 ? ` (and ${asyncImpact.testFiles.length - 5} more)` : '';
    sections.push(`- **Test Files to Update**: ${tests}${more}`);
    sections.push('  - Update assertions to handle async/await behavior');
    sections.push('  - Verify callbacks are converted to promise chains');
  }

  // Interface files section
  if (asyncImpact.interfaceFiles.length > 0) {
    const interfaces = asyncImpact.interfaceFiles.slice(0, 3).map((f: string) => `\`${f}\``).join(', ');
    sections.push(
      `- **Interface Files**: Review and update type signatures in ${interfaces}`,
    );
  }

  // Consumer files section
  if (asyncImpact.consumerFiles.length > 0) {
    const consumers = asyncImpact.consumerFiles.slice(0, 3).map((f: string) => `\`${f}\``).join(', ');
    sections.push(`- **Consumer Files** (may need interface updates): ${consumers}`);
  }

  sections.push('');
  sections.push(
    '**Important**: All mock and test updates must be completed before validation runs.',
  );

  return sections.join('\n');
}

/**
 * Build combined scouting context for TASK_PROMPT
 *
 * @param buildCapability - Detected build capability
 * @param asyncImpact - Detected async impact
 * @returns Complete scouting context string for embedding in TASK_PROMPT
 */
export function buildScoutingPromptContext(
  buildCapability: BuildCapabilityInfo | null,
  asyncImpact: AsyncImpactAnalysis | null,
): ScoutingPromptContext {
  const buildContext = buildBuildContext(buildCapability);
  const asyncContext = buildAsyncContext(asyncImpact);

  const sections: string[] = [];

  if (buildContext) {
    sections.push('## Validation Context (from Scouting)\n');
    sections.push(buildContext);
  }

  if (asyncContext) {
    if (sections.length > 0) {
      sections.push('');
    }
    sections.push(asyncContext);
  }

  const combinedContext = sections.length > 0 ? sections.join('\n\n') : '';

  return {
    buildContext,
    asyncContext,
    combinedContext,
    hasBuildInfo: !!buildCapability?.detected,
    hasAsyncInfo: !!asyncImpact?.hasAsyncChanges,
  };
}

/**
 * Embed scouting context into a TASK_PROMPT
 *
 * Prepends scouting-derived validation context to help the main agent understand
 * compilation requirements and async-related impacts.
 *
 * @param originalTaskPrompt - Original TASK_PROMPT text
 * @param buildCapability - Detected build capability
 * @param asyncImpact - Detected async impact
 * @returns Enhanced TASK_PROMPT with scouting context
 */
export function embedScoutingContextInTaskPrompt(
  originalTaskPrompt: string,
  buildCapability: BuildCapabilityInfo | null,
  asyncImpact: AsyncImpactAnalysis | null,
): string {
  const context = buildScoutingPromptContext(buildCapability, asyncImpact);

  if (!context.combinedContext) {
    return originalTaskPrompt;
  }

  return `${context.combinedContext}\n\n---\n\n${originalTaskPrompt}`;
}

/**
 * Create a concise summary line for scouting discoveries
 *
 * @param buildCapability - Detected build capability
 * @param asyncImpact - Detected async impact
 * @returns Single-line summary of scouting discoveries
 */
export function summarizeScoutingDiscoveries(
  buildCapability: BuildCapabilityInfo | null,
  asyncImpact: AsyncImpactAnalysis | null,
): string {
  const parts: string[] = [];

  if (buildCapability?.detected) {
    parts.push(`Build: ${buildCapability.language}`);
  }

  if (asyncImpact?.hasAsyncChanges) {
    parts.push(
      `Async: ${asyncImpact.mockFiles.length} mocks, ${asyncImpact.testFiles.length} tests`,
    );
  }

  if (parts.length === 0) {
    return 'No scouting discoveries';
  }

  return parts.join(' | ');
}
