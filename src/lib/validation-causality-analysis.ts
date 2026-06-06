/**
 * Validation Failure Causality Analysis
 *
 * Implements three independent signals to determine if a validation failure
 * is caused by the code change or is a pre-existing issue:
 *
 * Signal 1: Comparative Test Results - Compare baseline vs post-change test output
 * Signal 2: Log Causality Markers - Detect changed code in error messages/stack traces
 * Signal 3: Code Impact Correlation - Correlate changed identifiers with failures
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TestFailure {
  command: string;
  exitCode: number;
  tests?: string[];
  stderr?: string;
  message?: string;
}

export interface ComparativeTestResults {
  newlyFailing: string[];
  newlyPassing: string[];
  consistentlyFailing: string[];
  regressionCount: number;
  improvementCount: number;
}

export interface LogMarker {
  type: 'changed_file' | 'changed_function' | 'unrelated_module' | 'infra_failure';
  pattern: string;
  found: boolean;
  context?: string;
}

export interface CodeImpactAnalysis {
  changedIdentifiers: string[];
  foundInFailure: string[];
  correlationStrength: 'high' | 'medium' | 'low' | 'none';
}

export interface CausalityAssessment {
  failureType: 'change_related' | 'pre_existing' | 'mixed' | 'inconclusive';
  confidence: number; // 0.0-1.0
  rationale: string;
  signals: {
    comparativeResults?: {
      analysis: ComparativeTestResults;
      indicatesChangeRelated: boolean;
      weight: number;
    };
    logMarkers?: {
      markers: LogMarker[];
      indicatesChangeRelated: boolean;
      weight: number;
    };
    codeImpact?: {
      analysis: CodeImpactAnalysis;
      indicatesChangeRelated: boolean;
      weight: number;
    };
  };
}

/**
 * Signal 1: Parse validation logs and extract test failures
 */
export function parseTestFailures(logContent: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const lines = logContent.split('\n');

  // Common test failure patterns
  const failurePatterns = [
    /FAIL\s+(.+?)(?:\n|$)/i,
    /✕\s+(.+?)(?:\n|$)/,
    /✗\s+(.+?)(?:\n|$)/,
    /Error:\s+(.+?)(?:\n|$)/,
    /failed to compile/i,
    /compilation failed/i,
  ];

  let currentFailure: Partial<TestFailure> | null = null;

  for (const line of lines) {
    // Check for failure patterns
    for (const pattern of failurePatterns) {
      if (pattern.test(line)) {
        if (currentFailure) failures.push({ ...currentFailure, message: currentFailure.message || '' } as TestFailure);
        currentFailure = { message: line.trim(), stderr: line };
        break;
      }
    }

    // Accumulate context for current failure
    if (currentFailure && !line.includes('---') && line.trim()) {
      currentFailure.stderr = (currentFailure.stderr || '') + '\n' + line;
    }
  }

  if (currentFailure) {
    failures.push({ ...currentFailure, message: currentFailure.message || '' } as TestFailure);
  }

  return failures;
}

/**
 * Signal 1: Compare baseline vs post-change test results
 */
export function analyzeComparativeTestResults(
  baselineLog: string,
  postChangeLog: string
): ComparativeTestResults {
  const baselineFailures = parseTestFailures(baselineLog);
  const postChangeFailures = parseTestFailures(postChangeLog);

  const baselineMessages = new Set(
    baselineFailures.map(f => f.message || '').filter(m => m.length > 0)
  );
  const postChangeMessages = new Set(
    postChangeFailures.map(f => f.message || '').filter(m => m.length > 0)
  );

  const newlyFailing: string[] = Array.from(postChangeMessages).filter(m => !baselineMessages.has(m));
  const newlyPassing: string[] = Array.from(baselineMessages).filter(m =>
    !postChangeMessages.has(m)
  );
  const consistentlyFailing: string[] = Array.from(baselineMessages).filter(m =>
    postChangeMessages.has(m)
  );

  return {
    newlyFailing,
    newlyPassing,
    consistentlyFailing,
    regressionCount: newlyFailing.length,
    improvementCount: newlyPassing.length,
  };
}

/**
 * Signal 2: Extract identifier names from diff
 */
export function extractChangedIdentifiers(gitDiff: string): string[] {
  const identifiers = new Set<string>();

  // Match function/class definitions in diff (lines starting with + or -)
  const patterns = [
    /^[+-]\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/m,
    /^[+-]\s*(?:export\s+)?class\s+(\w+)/m,
    /^[+-]\s*(?:export\s+)?interface\s+(\w+)/m,
    /^[+-]\s*(?:export\s+)?type\s+(\w+)/m,
    /^[+-].*\.(\w+)\s*=/m, // property assignments
  ];

  const lines = gitDiff.split('\n');
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        identifiers.add(match[1]);
      }
    }
  }

  return Array.from(identifiers);
}

/**
 * Signal 3: Correlate changed identifiers with error messages
 */
export function analyzeCodeImpact(
  gitDiff: string,
  failureLog: string
): CodeImpactAnalysis {
  const changedIdentifiers = extractChangedIdentifiers(gitDiff);
  const foundInFailure: string[] = [];

  for (const identifier of changedIdentifiers) {
    // Case-insensitive search for identifier in failure context
    const regex = new RegExp(`\\b${identifier}\\b`, 'i');
    if (regex.test(failureLog)) {
      foundInFailure.push(identifier);
    }
  }

  // Determine correlation strength
  let correlationStrength: 'high' | 'medium' | 'low' | 'none' = 'none';
  if (changedIdentifiers.length > 0) {
    const ratio = foundInFailure.length / changedIdentifiers.length;
    if (ratio > 0.5) {
      correlationStrength = 'high';
    } else if (ratio > 0.25) {
      correlationStrength = 'medium';
    } else if (foundInFailure.length > 0) {
      correlationStrength = 'low';
    }
  }

  return {
    changedIdentifiers,
    foundInFailure,
    correlationStrength,
  };
}

/**
 * Signal 2: Scan logs for causality markers
 */
export function detectLogMarkers(
  failureLog: string,
  changedFiles: string[]
): LogMarker[] {
  const markers: LogMarker[] = [];

  // Check for changed file names in stack traces
  for (const file of changedFiles) {
    const fileName = path.basename(file);
    const marker: LogMarker = {
      type: 'changed_file',
      pattern: fileName,
      found: failureLog.includes(fileName),
    };
    if (marker.found) {
      const context = failureLog
        .split('\n')
        .find(line => line.includes(fileName));
      if (context) marker.context = context;
    }
    markers.push(marker);
  }

  // Detect infrastructure failures
  const infraPatterns: LogMarker[] = [
    { type: 'infra_failure', pattern: 'timeout', found: /timeout/i.test(failureLog) },
    { type: 'infra_failure', pattern: 'ENOTFOUND', found: /ENOTFOUND/.test(failureLog) },
    { type: 'infra_failure', pattern: 'ECONNREFUSED', found: /ECONNREFUSED/.test(failureLog) },
    { type: 'infra_failure', pattern: 'out of memory', found: /out of memory/i.test(failureLog) },
  ];

  for (const marker of infraPatterns) {
    if (marker.found) {
      markers.push(marker);
    }
  }

  return markers;
}

/**
 * Combine all three signals into a comprehensive causality verdict
 */
export function assessCausality(
  baselineLog: string,
  postChangeLog: string,
  gitDiff: string,
  changedFiles: string[]
): CausalityAssessment {
  // Signal 1: Comparative test results
  const comparativeResults = analyzeComparativeTestResults(baselineLog, postChangeLog);
  const signal1IndicatesChangeRelated = comparativeResults.regressionCount > 0;
  const signal1Weight = 0.4; // Highest weight: regression is strong signal

  // Signal 2: Log markers
  const logMarkers = detectLogMarkers(postChangeLog, changedFiles);
  const hasChangedFileMarker = logMarkers.some(m => m.type === 'changed_file' && m.found);
  const hasInfraFailure = logMarkers.some(m => m.type === 'infra_failure' && m.found);
  const signal2IndicatesChangeRelated = hasChangedFileMarker && !hasInfraFailure;
  const signal2Weight = 0.35;

  // Signal 3: Code impact
  const codeImpact = analyzeCodeImpact(gitDiff, postChangeLog);
  const signal3IndicatesChangeRelated = codeImpact.correlationStrength !== 'none';
  const signal3Weight = 0.25;

  // Compute weighted confidence
  let confidence = 0;

  if (signal1IndicatesChangeRelated || comparativeResults.regressionCount > 0) {
    confidence += (signal1Weight * 0.9) / (signal1Weight + signal2Weight + signal3Weight);
  }

  if (signal2IndicatesChangeRelated) {
    confidence += (signal2Weight * 0.8) / (signal1Weight + signal2Weight + signal3Weight);
  }

  if (signal3IndicatesChangeRelated) {
    const impactConfidence = codeImpact.correlationStrength === 'high' ? 0.8 : 0.5;
    confidence +=
      (signal3Weight * impactConfidence) / (signal1Weight + signal2Weight + signal3Weight);
  }

  // Determine verdict
  let failureType: 'change_related' | 'pre_existing' | 'mixed' | 'inconclusive' =
    'inconclusive';
  let rationale = '';

  const signalsIndicatingChange = [
    signal1IndicatesChangeRelated,
    signal2IndicatesChangeRelated,
    signal3IndicatesChangeRelated,
  ].filter(Boolean).length;

  if (hasInfraFailure) {
    failureType = 'pre_existing';
    const infraPatterns = logMarkers
      .filter(m => m.type === 'infra_failure' && m.found)
      .map(m => m.pattern)
      .join(', ');
    rationale = `Infrastructure failure detected (${infraPatterns}); not caused by code change.`;
    confidence = 0.95;
  } else if (
    comparativeResults.regressionCount > 0 &&
    comparativeResults.newlyFailing.length > 0
  ) {
    failureType = 'change_related';
    rationale = `${comparativeResults.newlyFailing.length} new test failure(s) introduced by change.`;
    confidence = Math.min(0.95, 0.7 + comparativeResults.newlyFailing.length * 0.1);
  } else if (comparativeResults.consistentlyFailing.length > 0) {
    failureType = 'pre_existing';
    rationale = `${comparativeResults.consistentlyFailing.length} test(s) were already failing before change.`;
    confidence = 0.85;
  } else if (signalsIndicatingChange >= 2) {
    failureType = 'change_related';
    const signals = [
      signal2IndicatesChangeRelated ? 'changed code in stack trace' : '',
      signal3IndicatesChangeRelated ? 'changed identifiers in error' : '',
    ]
      .filter(Boolean)
      .join(', ');
    rationale = `Multiple signals suggest change-related failure: ${signals}`;
    confidence = 0.65;
  } else if (signalsIndicatingChange === 1) {
    failureType = 'inconclusive';
    rationale = 'One signal suggests change-related, but evidence is weak.';
    confidence = 0.45;
  } else {
    failureType = 'inconclusive';
    rationale =
      'Unable to determine causality with confidence. Check logs for more details.';
    confidence = 0.3;
  }

  return {
    failureType,
    confidence,
    rationale,
    signals: {
      comparativeResults: {
        analysis: comparativeResults,
        indicatesChangeRelated: signal1IndicatesChangeRelated,
        weight: signal1Weight,
      },
      logMarkers: {
        markers: logMarkers,
        indicatesChangeRelated: signal2IndicatesChangeRelated,
        weight: signal2Weight,
      },
      codeImpact: {
        analysis: codeImpact,
        indicatesChangeRelated: signal3IndicatesChangeRelated,
        weight: signal3Weight,
      },
    },
  };
}

/**
 * Generate validation-causality-analysis.json artifact
 */
export function generateCausalityAnalysisArtifact(
  assessment: CausalityAssessment,
  outputPath: string
): boolean {
  try {
    const artifact = {
      timestamp: new Date().toISOString(),
      assessment,
      version: '1.0',
    };

    fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and analyze validation results
 */
export function analyzeValidationFailureCausality(
  baselineLogPath: string,
  postChangeLogPath: string,
  gitDiffPath: string,
  changedFilesPath: string
): CausalityAssessment | null {
  try {
    // Check if baseline exists (it might not on first run)
    if (!fs.existsSync(baselineLogPath)) {
      return {
        failureType: 'inconclusive',
        confidence: 0,
        rationale: 'No baseline validation results available for comparison.',
        signals: {},
      };
    }

    const baselineLog = fs.readFileSync(baselineLogPath, 'utf-8');
    const postChangeLog = fs.readFileSync(postChangeLogPath, 'utf-8');
    const gitDiff = fs.readFileSync(gitDiffPath, 'utf-8');

    let changedFiles: string[] = [];
    if (fs.existsSync(changedFilesPath)) {
      const content = fs.readFileSync(changedFilesPath, 'utf-8');
      changedFiles = content
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean);
    }

    return assessCausality(baselineLog, postChangeLog, gitDiff, changedFiles);
  } catch {
    return null;
  }
}

function isDirectCliInvocation(): boolean {
  const invokedPath = process.argv[1];

  return Boolean(
    invokedPath && path.basename(invokedPath) === 'validation-causality-analysis.ts'
  );
}

function runCli(): void {
  const [, , baselineLogPath, postChangeLogPath, gitDiffPath, changedFilesPath, outputPath] =
    process.argv;

  if (!baselineLogPath || !postChangeLogPath || !gitDiffPath || !changedFilesPath || !outputPath) {
    console.error(
      'Usage: validation-causality-analysis.ts <baseline-log> <post-change-log> <git-diff> <changed-files> <output-json>'
    );
    process.exitCode = 1;
    return;
  }

  const assessment = analyzeValidationFailureCausality(
    baselineLogPath,
    postChangeLogPath,
    gitDiffPath,
    changedFilesPath
  );

  if (!assessment) {
    console.error('Failed to assess validation failure causality.');
    process.exitCode = 1;
    return;
  }

  if (!generateCausalityAnalysisArtifact(assessment, outputPath)) {
    console.error(`Failed to write validation failure causality artifact to ${outputPath}.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Causality analysis written to ${outputPath}: ${assessment.failureType} (${(
      assessment.confidence * 100
    ).toFixed(1)}% confidence)`
  );
}

if (isDirectCliInvocation()) {
  runCli();
}
