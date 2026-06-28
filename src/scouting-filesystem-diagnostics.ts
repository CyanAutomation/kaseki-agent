export interface ResultsDirectoryDiagnosticOptions {
  resultsDir?: string;
  containerUid?: number;
}

export function buildResultsDirectoryNotWritableMessage({
  resultsDir = '/results',
  containerUid,
}: ResultsDirectoryDiagnosticOptions = {}): string {
  const lines = [
    '[SCOUTING PREREQUISITE FAILED] /results is not writable',
    `  Directory: ${resultsDir}`,
    '  Status: READ-ONLY',
  ];

  if (typeof containerUid === 'number') {
    lines.push(`  Container UID: ${containerUid}`);
  }

  lines.push(
    '',
    'Root cause: Docker volume mounted with :ro flag or container --read-only',
    '',
    'Impact:',
    '  - Scouting Pi agent will fail to write scouting-candidate.json',
  '  - This causes exit code 83 (scouting prerequisite failure)',
    '',
    'Fix: Remount /results as read-write',
    '  docker run -v /path/to/results:/results:rw kaseki-agent',
    '  (note the :rw flag at the end of the volume mount)',
  );

  return lines.join('\n');
}
