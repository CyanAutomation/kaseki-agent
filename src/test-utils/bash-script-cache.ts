/**
 * Bash script caching and extraction utilities
 *
 * Provides module-level caching for kaseki-agent.sh and optimized
 * bash function extraction to avoid repeated file I/O and regex compilation.
 */

import * as fs from 'fs';
import * as path from 'path';

// Module-level cache for script content
let cachedScriptContent: string | null = null;

// Cache for extracted bash functions
const functionCache = new Map<string, string>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get cached kaseki-agent.sh content, reading file only once per process
 */
export function getCachedScriptContent(): string {
  if (cachedScriptContent === null) {
    const kasekiAgentPath = path.join(process.cwd(), 'kaseki-agent.sh');
    if (!fs.existsSync(kasekiAgentPath)) {
      throw new Error(`kaseki-agent.sh not found at ${kasekiAgentPath}`);
    }
    cachedScriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
  }
  return cachedScriptContent;
}

/**
 * Extract a bash function block from the cached script content
 *
 * @param startFunction Function name marking the start (e.g., 'build_goal_check_prompt')
 * @param endFunction Function name marking the end (e.g., 'run_goal_check')
 * @returns The extracted function block including the function definition
 * @throws If function markers not found or extraction fails
 */
export function extractBashFunctionWithCache(startFunction: string, endFunction: string): string {
  const cacheKey = `${startFunction}..${endFunction}`;

  if (functionCache.has(cacheKey)) {
    return functionCache.get(cacheKey)!;
  }

  const scriptContent = getCachedScriptContent();
  const lines = scriptContent.split('\n');

  const startPattern = new RegExp(`^${escapeRegExp(startFunction)}\\(\\) \\{$`);
  const endPattern = new RegExp(`^${escapeRegExp(endFunction)}\\(\\) \\{$`);

  const startLineIndexes = lines.flatMap((line, index) => (startPattern.test(line) ? [index] : []));

  if (startLineIndexes.length !== 1) {
    throw new Error(
      `Expected exactly 1 occurrence of '${startFunction}() {', found ${startLineIndexes.length}`
    );
  }

  const startLineIndex = startLineIndexes[0];
  const endLineIndex = lines.findIndex(
    (line, index) => index > startLineIndex && endPattern.test(line)
  );

  if (endLineIndex <= startLineIndex) {
    throw new Error(
      `Could not find '${endFunction}() {' after '${startFunction}() {' in kaseki-agent.sh`
    );
  }

  const functionText = lines.slice(startLineIndex, endLineIndex).join('\n');

  // Validate extraction
  if (!functionText.startsWith(`${startFunction}() {`)) {
    throw new Error(`Extracted function has unexpected start boundary: ${startFunction}`);
  }
  if (!functionText.includes('}') || !functionText.trim().endsWith('}')) {
    throw new Error(`Extracted function has unexpected end boundary: ${startFunction}`);
  }

  const nestedFunctionDefinitions = functionText.match(/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/gm) ?? [];
  if (
    nestedFunctionDefinitions.length !== 1 ||
    nestedFunctionDefinitions[0] !== `${startFunction}() {`
  ) {
    throw new Error(
      `Extracted function for ${startFunction} includes unexpected nested function definitions`
    );
  }

  functionCache.set(cacheKey, functionText);
  return functionText;
}

/**
 * Clear caches (useful for test isolation if needed)
 */
export function clearCaches(): void {
  cachedScriptContent = null;
  functionCache.clear();
}
