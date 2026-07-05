/**
 * Dependency Cache Diagnostic Extractor
 *
 * Extracts dependency cache diagnostic information from stdout logs.
 */

import * as path from 'path';
import { StatusResponse } from '../kaseki-api-types';

type DependencyCacheDiagnostic = NonNullable<StatusResponse['diagnosticSummary']>['dependencyCache'];

const DEPENDENCY_CACHE_MESSAGE_PATTERN = /^Dependency cache status:\s*(.+)$/;

/**
 * Clean diagnostic text by removing ANSI codes and normalizing whitespace
 */
function cleanDiagnosticText(value: string, ansiPattern: RegExp): string {
  return value.replace(ansiPattern, '').replace(/\s+/g, ' ').trim();
}

/**
 * Read dependency cache diagnostics from stdout
 */
export function readDependencyCacheDiagnostics(
  runDir: string,
  readSmallArtifact: (filePath: string) => string | null,
  ansiPattern: RegExp
): DependencyCacheDiagnostic | undefined {
  const stdoutPath = path.join(runDir, 'stdout.log');
  const stdout = readSmallArtifact(stdoutPath);
  if (!stdout) {
    return undefined;
  }

  const messages = stdout
    .split(/\r?\n/)
    .map((line) => cleanDiagnosticText(line, ansiPattern))
    .map((line) => line.match(DEPENDENCY_CACHE_MESSAGE_PATTERN)?.[1])
    .filter((message): message is string => Boolean(message))
    .slice(0, 8);
  if (messages.length === 0) {
    return undefined;
  }

  const validationFailed = messages.some((message) =>
    /failed npm ls validation|failed validation|validation_failed|restored dependency cache failed validation/.test(message)
  );

  return {
    restored: messages.some((message) => message.includes('restoring node_modules')),
    reinstallTriggered: messages.some((message) =>
      /failed npm ls validation|restored dependency cache failed validation|cache miss|running install/.test(message)
    ),
    ...(validationFailed ? { validationFailed } : {}),
    messages,
  };
}
