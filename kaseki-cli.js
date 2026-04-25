#!/usr/bin/env node

/**
 * kaseki-cli.js
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
 *   kaseki-cli errors <instance>
 *   kaseki-cli analysis <instance>
 *   kaseki-cli watch <instance> [--interval=S]
 *   kaseki-cli follow <instance> [--tail=<log_name>]
 */

const kasekiCli = require('./kaseki-cli-lib.js');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Utilities
// ============================================================================

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function printError(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function printTable(data) {
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }

  // Determine column widths
  const headers = Object.keys(data[0]);
  const widths = {};
  for (const header of headers) {
    widths[header] = Math.max(header.length, ...data.map((row) => String(row[header] || '').length));
  }

  // Print header
  const headerRow = headers.map((h) => h.padEnd(widths[h])).join('  ');
  console.log(headerRow);
  console.log(headers.map((h) => '='.repeat(widths[h])).join('  '));

  // Print rows
  for (const row of data) {
    const values = headers.map((h) => String(row[h] || '').padEnd(widths[h])).join('  ');
    console.log(values);
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * List all kaseki instances with basic status
 */
function cmdList(args) {
  const instances = kasekiCli.listInstances();

  if (instances.length === 0) {
    console.log('No kaseki instances found.');
    return;
  }

  const data = instances.map((inst) => ({
    'Instance': inst.name,
    'Status': inst.status,
    'Stage': inst.stage,
    'Elapsed (s)': inst.elapsedSeconds !== null ? inst.elapsedSeconds : '—',
    'Exit Code': inst.exitCode !== null ? inst.exitCode : '—',
    'Model': inst.model.substring(0, 30),
  }));

  printTable(data);
}

/**
 * Get status of a specific instance
 */
function cmdStatus(args) {
  if (args.length < 1) {
    printError('status requires instance name argument');
  }

  const instance = args[0];
  const status = kasekiCli.getInstanceStatus(instance);

  if (status.error) {
    printError(status.error);
  }

  const anomalies = kasekiCli.detectAnomalies(instance);

  const output = {
    ...status,
    anomalies,
  };

  printJson(output);
}

/**
 * Read and display log file
 */
function cmdLogs(args) {
  if (args.length < 1) {
    printError('logs requires instance name argument');
  }

  const instance = args[0];
  let tailLines = 50;
  let logFile = 'stdout.log';

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--tail=')) {
      tailLines = parseInt(args[i].split('=')[1], 10);
    } else if (args[i].startsWith('--file=')) {
      logFile = args[i].split('=')[1];
    }
  }

  const logs = kasekiCli.readLiveLog(instance, logFile, tailLines);
  if (!logs) {
    printError(`Log file not found: ${logFile}`);
  }

  console.log(logs);
}

/**
 * Detect and display errors in an instance
 */
function cmdErrors(args) {
  if (args.length < 1) {
    printError('errors requires instance name argument');
  }

  const instance = args[0];
  const errors = kasekiCli.detectErrors(instance);

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
function cmdAnalysis(args) {
  if (args.length < 1) {
    printError('analysis requires instance name argument');
  }

  const instance = args[0];
  const analysis = kasekiCli.getAnalysis(instance);

  if (analysis.error) {
    printError(analysis.error);
  }

  printJson(analysis);
}

/**
 * Watch an instance in real-time with periodic status updates
 */
function cmdWatch(args) {
  if (args.length < 1) {
    printError('watch requires instance name argument');
  }

  const instance = args[0];
  let interval = 5; // Default 5 seconds

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--interval=')) {
      interval = parseInt(args[i].split('=')[1], 10);
    }
  }

  console.log(`Watching ${instance} (updating every ${interval}s, Ctrl+C to stop)...\n`);

  const watch = () => {
    const status = kasekiCli.getInstanceStatus(instance);

    if (status.error) {
      console.error(`Error: ${status.error}`);
      process.exit(1);
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Stage: ${status.stage}`);
    console.log(`             Elapsed: ${status.elapsedSeconds}s / ${status.timeoutSeconds}s`);

    if (status.timeoutRiskPercent >= 0) {
      console.log(`             Timeout: ${status.timeoutRiskPercent.toFixed(1)}%`);
    }

    if (status.running) {
      console.log('             Status: RUNNING');
    } else {
      console.log(`             Status: ${status.exitCode === 0 ? 'COMPLETED' : 'FAILED'} (exit code: ${status.exitCode})`);
    }

    // Show anomalies
    const anomalies = kasekiCli.detectAnomalies(instance);
    for (const anomaly of anomalies) {
      console.log(`             ⚠ [${anomaly.severity.toUpperCase()}] ${anomaly.message}`);
    }

    // Show recent errors
    const errors = kasekiCli.detectErrors(instance);
    if (errors.length > 0) {
      const criticalErrors = errors.filter((e) => e.severity === kasekiCli.ErrorSeverity.CRITICAL);
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
function cmdFollow(args) {
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

  const logPath = path.join(kasekiCli.config.KASEKI_RESULTS_DIR, instance, logFile);

  if (!fs.existsSync(logPath)) {
    printError(`Log file not found: ${logFile}`);
  }

  console.log(`Following ${logFile}...\n`);

  let lastSize = 0;
  let lastPosition = 0;

  const follow = () => {
    try {
      const stats = fs.statSync(logPath);
      const currentSize = stats.size;

      if (currentSize > lastPosition) {
        const stream = fs.createReadStream(logPath, {
          start: lastPosition,
          end: currentSize - 1,
        });

        let data = '';
        stream.on('data', (chunk) => {
          data += chunk;
        });

        stream.on('end', () => {
          if (data.length > 0) {
            process.stdout.write(data);
          }
          lastPosition = currentSize;
        });

        stream.on('error', (err) => {
          console.error(`Error reading log: ${err.message}`);
        });
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  };

  // Initial read
  follow();

  // Poll for new data
  const timer = setInterval(follow, 1000);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('\n\nFollow mode stopped.');
    process.exit(0);
  });
}

// ============================================================================
// Help
// ============================================================================

function showHelp() {
  const help = `
kaseki-cli - Kaseki Agent instance monitoring and analysis

USAGE:
  kaseki-cli <command> [args] [options]

COMMANDS:
  list                           List all instances with status
  status <instance>              Get status of a specific instance (JSON)
  logs <instance>                Display recent log lines (tail)
                                 Options: --tail=N --file=<name>
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

function main() {
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
    printError(err.message);
  }
}

main();
