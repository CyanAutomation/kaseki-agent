import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FINDING_GROUPS = [
  ['vulnerability', 'Vulnerabilities'],
  ['misconfiguration', 'Misconfigurations'],
  ['secret', 'Secrets'],
];

function safeField(value, fallback) {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value.replace(/[\t\r\n]+/g, ' ');
}

export function evaluateTrivyReport(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.Results)) {
    throw new TypeError('Trivy JSON must contain a Results array.');
  }

  const findings = [];
  for (const result of report.Results) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new TypeError('Every Trivy result must be an object.');
    }

    for (const [type, property] of FINDING_GROUPS) {
      const entries = result[property] ?? [];
      if (!Array.isArray(entries)) {
        throw new TypeError(`Trivy ${property} must be an array.`);
      }

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new TypeError(`Every Trivy ${property} finding must be an object.`);
        }

        const severity = safeField(entry.Severity, '').toUpperCase();
        if (severity !== 'HIGH' && severity !== 'CRITICAL') continue;

        findings.push({
          target: safeField(result.Target, 'unknown target'),
          type,
          severity,
          id: safeField(entry.VulnerabilityID ?? entry.ID ?? entry.RuleID, 'unknown finding'),
          package: safeField(entry.PkgName, 'unknown package'),
        });
      }
    }
  }

  return findings;
}

export function formatTrivyFinding(finding) {
  return [finding.target, finding.type, finding.severity, finding.id, finding.package].join(' | ');
}

export function createTrivySummary(findings) {
  if (!Array.isArray(findings)) throw new TypeError('Trivy findings must be an array.');

  const safeFindings = findings.map((finding) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      throw new TypeError('Every Trivy finding summary must be an object.');
    }

    return {
      target: safeField(finding.target, 'unknown target'),
      type: safeField(finding.type, 'unknown finding type'),
      severity: safeField(finding.severity, 'UNKNOWN').toUpperCase(),
      id: safeField(finding.id, 'unknown finding'),
      package: safeField(finding.package, 'unknown package'),
    };
  });

  return { findingCount: safeFindings.length, findings: safeFindings };
}

async function main() {
  const [reportPath, summaryFlag, summaryPath, ...extraArguments] = process.argv.slice(2);
  if (!reportPath || summaryFlag !== '--summary' || !summaryPath || extraArguments.length > 0) {
    throw new Error('Usage: node check-trivy-image-findings.mjs <trivy-json-report> --summary <safe-summary-path>');
  }
  if (resolve(reportPath) === resolve(summaryPath)) {
    throw new Error('The safe summary path must differ from the raw Trivy report path.');
  }

  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof SyntaxError ? 'invalid JSON' : 'unable to read report';
    throw new Error(`Trivy produced ${detail}.`);
  }

  const findings = evaluateTrivyReport(report);
  const summary = createTrivySummary(findings);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  if (findings.length === 0) {
    console.log('No high or critical image findings found.');
    return;
  }

  console.error(`::error title=Trivy high/critical findings::${findings.length} high or critical image findings found`);
  for (const finding of findings) console.error(`- ${formatTrivyFinding(finding)}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Trivy report validation failed.');
    process.exitCode = 1;
  }
}
