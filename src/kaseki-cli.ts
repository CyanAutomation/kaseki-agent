#!/usr/bin/env node

/**
 * kaseki-cli.ts
 *
 * Command-line interface for querying and monitoring kaseki instances.
 * Provides commands for listing, status polling, log streaming, error detection,
 * and post-run analysis.
 *
 * NOTE: Repo specification (URL, branch) is handled at invocation time via run-kaseki.sh.
 * This tool monitors and analyzes instances after they are created.
 *
 * Usage:
 *   kaseki-cli list
 *   kaseki-cli status <instance>
 *   kaseki-cli logs <instance> [--tail=N]
 *   kaseki-cli progress <instance> [--tail=N]
 *   kaseki-cli errors <instance>
 *   kaseki-cli analysis <instance>
 *   kaseki-cli watch <instance> [--interval=S]
 *   kaseki-cli follow <instance> [--tail=<log_name>]
 */

import * as kasekiCliLib from './kaseki-cli-lib';
import fs from 'fs';
import path from 'path';
import { Stats } from 'fs';

interface FileStats extends Stats {}

interface FollowCallbacks {
  onInfo?: (message: string) => void;
  onData?: (chunk: string) => void;
  onError?: (error: Error) => void;
}

interface FollowPoller {
  poll: () => void;
  close: () => void;
}

function statsIdentity(stats: FileStats): string {
  if (typeof stats.ino === 'number' && stats.ino > 0) {
    return `ino:${stats.ino}`;
  }

  // Fallback for filesystems that do not expose stable inode numbers.
  return `mtime-size:${stats.mtimeMs}:${stats.size}`;
}

function createFollowPoller(
  fsModule: typeof fs,
  logPath: string,
  callbacks: FollowCallbacks = {}
): FollowPoller {
  const onInfo = callbacks.onInfo || (() => {});
  const onData = callbacks.onData || (() => {});
  const onError = callbacks.onError || (() => {});

  let fd: number | null = null;
  let lastPosition = 0;
  let isReading = false;
  let hasQueuedPoll = false;
  let lastPathIdentity: string | null = null;
  let retryTimer: NodeJS.Timeout | null = null;

  function isRecoverableError(err: any): boolean {
    if (!err || typeof err !== 'object') {
      return false;
    }

    if (err.code === 'ENOENT' || err.code === 'ESTALE') {
      return true;
    }

    return (
      err.code === 'EIO' || err.code === 'EBUSY' || err.code === 'EMFILE' || err.code === 'ENFILE'
    );
  }

  function scheduleRetry(): void {
    if (retryTimer !== null) {
      return;
    }

    retryTimer = setTimeout(() => {
      retryTimer = null;
      poll();
    }, 200);
  }

  function closeFd(): void {
    if (fd === null) {
      return;
    }

    try {
      fsModule.closeSync(fd);
    } catch {
      // Ignore close failures; next open/read will surface actionable errors.
    }
    fd = null;
  }

  function openFd(): void {
    fd = fsModule.openSync(logPath, 'r');
  }

  function resetCursor(reason: string): void {
    lastPosition = 0;
    onInfo(`[follow] ${reason}; resetting cursor.`);
  }

  function poll(): void {
    if (isReading) {
      hasQueuedPoll = true;
      return;
    }

    let pathStats: FileStats;
    try {
      pathStats = fsModule.statSync(logPath) as FileStats;
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.code === 'ESTALE') {
        closeFd();
        return;
      }
      onError(err);
      return;
    }

    const currentIdentity = statsIdentity(pathStats);

    if (lastPathIdentity !== null && currentIdentity !== lastPathIdentity) {
      closeFd();
      resetCursor('log file replaced/rotated');
    }
    lastPathIdentity = currentIdentity;

    if (fd === null) {
      try {
        openFd();
      } catch (err: any) {
        if (err.code !== 'ENOENT' && err.code !== 'ESTALE') {
          onError(err);
        }
        return;
      }
    }

    let fdStats: FileStats;
    try {
      fdStats = fsModule.fstatSync(fd as number) as FileStats;
    } catch (err: any) {
      closeFd();
      if (err.code !== 'ENOENT' && err.code !== 'ESTALE') {
        onError(err);
      }
      return;
    }

    if (statsIdentity(fdStats) !== currentIdentity) {
      closeFd();
      resetCursor('underlying file descriptor became stale');
      return;
    }

    if (pathStats.size < lastPosition) {
      resetCursor('log file truncated');
    }

    if (pathStats.size <= lastPosition) {
      return;
    }

    const start = lastPosition;
    const end = pathStats.size - 1;
    if (end < start) {
      return;
    }

    isReading = true;
    const stream = fsModule.createReadStream(logPath, {
      fd: fd as number,
      autoClose: false,
      start,
      end,
    });

    let data = '';
    let bytesRead = 0;
    stream.on('data', (chunk: any) => {
      bytesRead += (chunk as Buffer).length;
      data += chunk;
    });

    stream.on('end', () => {
      if (data.length > 0) {
        onData(data);
      }
      lastPosition += bytesRead;
      isReading = false;
      if (hasQueuedPoll) {
        hasQueuedPoll = false;
        poll();
      }
    });

    stream.on('error', (err: Error) => {
      isReading = false;
      closeFd();
      onError(err);
      if (isRecoverableError(err)) {
        scheduleRetry();
      } else if (hasQueuedPoll) {
        hasQueuedPoll = false;
        poll();
      }
    });
  }

  function close(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    closeFd();
  }

  return {
    poll,
    close,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function printJson(obj: any): void {
  console.log(JSON.stringify(obj, null, 2));
}

function printError(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parsePositiveIntOption(name: string, raw: any, min: number = 1): number {
  if (raw === undefined || raw === null || raw === '') {
    printError(`Invalid value for --${name}: expected an integer >= ${min}, got empty value`);
  }

  if (!/^-?\d+$/.test(raw)) {
    printError(`Invalid value for --${name}: expected an integer >= ${min}, got "${raw}"`);
  }

  const parsed = Number(raw);
  if (parsed < min) {
    printError(`Invalid value for --${name}: expected an integer >= ${min}, got ${parsed}`);
  }

  return parsed;
}

interface TableRow {
  [key: string]: any;
}

function printTable(data: TableRow[]): void {
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }

  // Determine column widths
  const headers = Object.keys(data[0]);
  const widths: Record<string, number> = {};
  for (const header of headers) {
    widths[header] = Math.max(
      header.length,
      ...data.map((row) => String(row[header] ?? '').length)
    );
  }

  // Print header
  const headerRow = headers.map((h) => h.padEnd(widths[h])).join('  ');
  console.log(headerRow);
  console.log(headers.map((h) => '='.repeat(widths[h])).join('  '));

  // Print rows
  for (const row of data) {
    const values = headers
      .map((h) => String(row[h] ?? '').padEnd(widths[h]))
      .join('  ');
    console.log(values);
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * List all kaseki instances with basic status
 */
function cmdList(_args: string[]): void {
  const instances = kasekiCliLib.listInstances();

  if (instances.length === 0) {
    console.log('No kaseki instances found.');
    return;
  }

  const data = instances.map((inst) => ({
    Instance: inst.name,
    Status: inst.status,
    Stage: inst.stage,
    'Elapsed (s)': inst.elapsedSeconds !== null ? inst.elapsedSeconds : '—',
    'Exit Code': inst.exitCode !== null ? inst.exitCode : '—',
    Model: inst.model.substring(0, 30),
  }));

  printTable(data);
}

/**
 * Get status of a specific instance
 */
function cmdStatus(args: string[]): void {
  if (args.length < 1) {
    printError('status requires instance name argument');
  }

  const instance = args[0];
  const status = kasekiCliLib.getInstanceStatus(instance);

  if (status.error) {
    printError(status.error.message);
  }

  printJson(status);
}

/**
 * Read and display log file
 */
function cmdLogs(args: string[]): void {
  if (args.length < 1) {
    printError('logs requires instance name argument');
  }

  const instance = args[0];
  let tailLines = 50;
  let logFile = 'stdout.log';

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--tail=')) {
      tailLines = parsePositiveIntOption('tail', args[i].split('=')[1]);
    } else if (args[i].startsWith('--file=')) {
      logFile = args[i].split('=')[1];
    }
  }

  const logs = kasekiCliLib.readLiveLog(instance, logFile, tailLines);
  if (logs === null) {
    printError(`Log file not found: ${logFile}`);
  }

  console.log(logs);
}

/**
 * Display sanitized progress events.
 */
function cmdProgress(args: string[]): void {
  if (args.length < 1) {
    printError('progress requires instance name argument');
  }

  const instance = args[0];
  let tailLines = 20;

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--tail=')) {
      tailLines = parsePositiveIntOption('tail', args[i].split('=')[1]);
    }
  }

  const events = kasekiCliLib.readProgressEvents(instance, tailLines);
  if (events === null) {
    printError('Progress file not found: progress.jsonl');
  }

  for (const event of events) {
    const timestamp = event.timestamp || 'unknown-time';
    const stage = event.stage || 'progress';
    const message = event.message || '';
    console.log(`[${timestamp}] ${stage}: ${message}`);
  }
}

/**
 * Detect and display errors in an instance
 */
function cmdErrors(args: string[]): void {
  if (args.length < 1) {
    printError('errors requires instance name argument');
  }

  const instance = args[0];
  const errors = kasekiCliLib.detectErrors(instance);

  if (errors.length === 0) {
    console.log('No errors detected.');
    return;
  }

  const output = {
    instance,
    errorCount: errors.length,
    errors: errors.map((e) => ({
      severity: e.severity,
      source: e.source,
      message: e.message,
      line: e.line || null,
    })),
  };

  printJson(output);
}

/**
 * Get comprehensive post-run analysis
 */
function cmdAnalysis(args: string[]): void {
  if (args.length < 1) {
    printError('analysis requires instance name argument');
  }

  const instance = args[0];
  const analysis = kasekiCliLib.getAnalysis(instance);

  if (analysis.error) {
    printError(analysis.error.message);
  }

  printJson(analysis);
}

/**
 * Watch an instance in real-time with periodic status updates
 */
function cmdWatch(args: string[]): void {
  if (args.length < 1) {
    printError('watch requires instance name argument');
  }

  const instance = args[0];
  let interval = 5; // Default 5 seconds

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--interval=')) {
      interval = parsePositiveIntOption('interval', args[i].split('=')[1]);
    }
  }

  console.log(`Watching ${instance} (updating every ${interval}s, Ctrl+C to stop)...\n`);

  const watch = (): void => {
    const status = kasekiCliLib.getInstanceStatus(instance);

    if (status.error) {
      console.error(`Error: ${status.error}`);
      process.exit(1);
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Stage: ${status.stage}`);
    console.log(`             Elapsed: ${status.elapsedSeconds}s / ${status.timeoutSeconds}s`);

    if (status.timeoutRiskPercent !== undefined && status.timeoutRiskPercent >= 0) {
      console.log(`             Timeout: ${status.timeoutRiskPercent.toFixed(1)}%`);
    }

    if (status.running) {
      console.log('             Status: RUNNING');
    } else if (status.status === 'pending') {
      console.log('             Status: PENDING (exit code: —)');
    } else {
      console.log(
        `             Status: ${(status.status || '').toUpperCase()} (exit code: ${status.exitCode})`
      );
    }

    // Show recent errors
    const errors = kasekiCliLib.detectErrors(instance);
    if (errors.length > 0) {
      const criticalErrors = errors.filter((e) => e.severity === kasekiCliLib.ErrorSeverity.CRITICAL);
      if (criticalErrors.length > 0) {
        console.log(`             ✗ ${criticalErrors.length} critical error(s) detected`);
      }
    }

    console.log('');

    if (!status.running && status.exitCode !== null) {
      console.log('Instance completed. Exiting watch mode.');
      process.exit(status.exitCode === 0 ? 0 : 1);
    }
  };

  // Initial display
  watch();

  // Periodic updates
  const timer = setInterval(watch, interval * 1000);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('\nWatch mode stopped.');
    process.exit(0);
  });
}

/**
 * Follow/stream logs from an instance in real-time
 */
function cmdFollow(args: string[]): void {
  if (args.length < 1) {
    printError('follow requires instance name argument');
  }

  const instance = args[0];
  let logFile = 'stdout.log';

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--tail=')) {
      logFile = args[i].split('=')[1];
    }
  }

  const logPath = path.join(kasekiCliLib.config.KASEKI_RESULTS_DIR, instance, logFile);

  if (!fs.existsSync(logPath)) {
    printError(`Log file not found: ${logFile}`);
  }

  console.log(`Following ${logFile}...\n`);

  const poller = createFollowPoller(fs, logPath, {
    onInfo: (message) => console.log(message),
    onData: (chunk) => process.stdout.write(chunk),
    onError: (err) => console.error(`Error reading log: ${err.message}`),
  });

  // Initial read
  poller.poll();

  // Poll for new data
  const timer = setInterval(() => poller.poll(), 1000);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(timer);
    poller.close();
    console.log('\n\nFollow mode stopped.');
    process.exit(0);
  });
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  const help = `
kaseki-cli - Kaseki Agent instance monitoring and analysis

USAGE:
  kaseki-cli <command> [args] [options]

COMMANDS:
  list                           List all instances with status
  status <instance>              Get status of a specific instance (JSON)
  logs <instance>                Display recent log lines (tail)
                                 Options: --tail=N --file=<name>
  progress <instance>            Display sanitized progress events
                                 Options: --tail=N
  errors <instance>              Detect and list errors (JSON)
  analysis <instance>            Get post-run analysis (JSON)
  watch <instance>               Live monitor instance with status updates
                                 Options: --interval=S
  follow <instance>              Stream logs in real-time
                                 Options: --tail=<log_name>

OPTIONS:
  --tail=N                       Number of lines to display (default: 50)
  --file=<name>                  Log file name (stdout.log, validation.log, etc.)
  --tail=<name>                  For follow: which log to stream
  --interval=S                   For watch: polling interval in seconds (default: 5)

EXAMPLES:
  # Start a kaseki run with custom repo (see run-kaseki.sh for more options)
  ./run-kaseki.sh https://github.com/org/repo feature/branch

  # Monitor the instance
  kaseki-cli list
  kaseki-cli status kaseki-1
  kaseki-cli status kaseki-1 | jq .timeoutRiskPercent
  kaseki-cli logs kaseki-1 --tail=100
  kaseki-cli progress kaseki-1 --tail=25
  kaseki-cli errors kaseki-1
  kaseki-cli analysis kaseki-1
  kaseki-cli watch kaseki-1 --interval=2
  kaseki-cli follow kaseki-1
  kaseki-cli follow kaseki-1 --tail=validation.log

SEE ALSO:
  ./run-kaseki.sh --help          Invocation options for kaseki-agent (repo, ref, etc.)
`;
  console.log(help);
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '-h' || args[0] === '--help') {
    showHelp();
    process.exit(0);
  }

  const command = args[0];
  const cmdArgs = args.slice(1);

  try {
    switch (command) {
    case 'list':
      cmdList(cmdArgs);
      break;
    case 'status':
      cmdStatus(cmdArgs);
      break;
    case 'logs':
      cmdLogs(cmdArgs);
      break;
    case 'progress':
      cmdProgress(cmdArgs);
      break;
    case 'errors':
      cmdErrors(cmdArgs);
      break;
    case 'analysis':
      cmdAnalysis(cmdArgs);
      break;
    case 'watch':
      cmdWatch(cmdArgs);
      break;
    case 'follow':
      cmdFollow(cmdArgs);
      break;
    default:
      printError(`Unknown command: ${command}`);
    }
  } catch (err) {
    printError((err as Error).message);
  }
}

if (require.main === module) {
  main();
}

export { createFollowPoller, printTable };
