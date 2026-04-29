#!/usr/bin/env node

/**
 * kaseki-cli.demo.js
 *
 * Demonstration of kaseki-cli functionality.
 * Creates mock instances and shows CLI commands in action.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const kasekiCli = require('./kaseki-cli-lib.js');

const DEMO_DIR = '/tmp/kaseki-cli-demo';
const MOCK_RESULTS_DIR = path.join(DEMO_DIR, 'agents', 'kaseki-results');

function setup() {
  if (fs.existsSync(DEMO_DIR)) {
    execSync(`rm -rf "${DEMO_DIR}"`);
  }
  fs.mkdirSync(MOCK_RESULTS_DIR, { recursive: true });
  kasekiCli.config.KASEKI_RESULTS_DIR = MOCK_RESULTS_DIR;
}

function createDemoInstance(num, opts = {}) {
  const name = `kaseki-${num}`;
  const dir = path.join(MOCK_RESULTS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });

  const hostStart = {
    instance: name,
    repo: 'CyanAutomation/crudmapper',
    ref: 'main',
    model: 'openrouter/claude-3.5-sonnet',
    agentTimeoutSeconds: 1200,
  };
  fs.writeFileSync(path.join(dir, 'host-start.json'), JSON.stringify(hostStart, null, 2));

  const elapsed = opts.elapsed || 300;
  const exitCode = opts.exitCode || 0;

  const metadata = {
    instance: name,
    start_time: new Date(Date.now() - elapsed * 1000).toISOString(),
    duration_seconds: elapsed,
    exit_code: exitCode,
    current_stage: opts.stage || 'completed',
    model: 'openrouter/claude-3.5-sonnet',
  };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(dir, 'exit_code'), String(exitCode));

  const stdoutContent = `==> Cloning repository
Cloning into 'workspace/repo'...
==> Installing dependencies
npm WARN deprecated...
added 150 packages
==> Running Pi agent
Invoking Pi CLI with timeout...
==> Running validation
npm run check ✓ (5s)
npm run test ✓ (20s)
npm run build ✓ (15s)
==> Collecting artifacts
${opts.stage || 'Done.'}
`;
  fs.writeFileSync(path.join(dir, 'stdout.log'), stdoutContent);

  const stderrContent = opts.hasErrors ? 'Error: build failed\n' : '';
  fs.writeFileSync(path.join(dir, 'stderr.log'), stderrContent);

  fs.writeFileSync(path.join(dir, 'resource.time'), `elapsed_seconds=${elapsed}\n`);

  const piSummary = {
    model: 'openrouter/claude-3.5-sonnet',
    tool_start_count: 8,
    tool_end_count: 8,
    event_count: 65,
  };
  fs.writeFileSync(path.join(dir, 'pi-summary.json'), JSON.stringify(piSummary, null, 2));

  const validationTimings = `npm run check\t0\t5
npm run test\t0\t20
npm run build\t0\t15
`;
  fs.writeFileSync(path.join(dir, 'validation-timings.tsv'), validationTimings);

  const changedFiles = `src/parser.ts
tests/parser.test.ts
`;
  fs.writeFileSync(path.join(dir, 'changed-files.txt'), changedFiles);

  const diffContent = `diff --git a/src/parser.ts b/src/parser.ts
index abc...def 100644
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -10,5 +10,6 @@
   export const parse = () => {
+    // Fixed parsing logic
     return result;
   };
`;
  fs.writeFileSync(path.join(dir, 'git.diff'), diffContent);

  fs.writeFileSync(path.join(dir, 'validation.log'), validationTimings);
}

function demo(title, command) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`▶ ${title}`);
  console.log(`$ ${command}`);
  console.log('='.repeat(80));
  try {
    const output = execSync(`cd /workspaces/kaseki-agent && ${command}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(output);
  } catch (err) {
    console.error(err.message);
  }
}

// ============================================================================
// Main Demo
// ============================================================================

console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                      KASEKI-CLI DEMONSTRATION                                  ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════╝');

setup();

// Create demo instances
console.log('\n📦 Setting up demo instances...');
createDemoInstance(1, { elapsed: 300 });
createDemoInstance(2, { elapsed: 1100, stage: 'Running Pi agent' });
createDemoInstance(3, { elapsed: 500, exitCode: 1, hasErrors: true });
console.log('✓ Created 3 demo instances');

// Demo commands
demo('1. List all instances', 'NODE_PATH=/workspaces/kaseki-agent node -e "const kasekiCli = require(\'./lib/kaseki-cli-lib.js\'); kasekiCli.config.KASEKI_RESULTS_DIR = \'/tmp/kaseki-cli-demo/agents/kaseki-results\'; const instances = kasekiCli.listInstances(); console.log(JSON.stringify(instances, null, 2));"');

demo('2. Get status of a running instance', 'NODE_PATH=/workspaces/kaseki-agent node -e "const kasekiCli = require(\'./lib/kaseki-cli-lib.js\'); kasekiCli.config.KASEKI_RESULTS_DIR = \'/tmp/kaseki-cli-demo/agents/kaseki-results\'; const status = kasekiCli.getInstanceStatus(\'kaseki-2\'); console.log(JSON.stringify(status, null, 2));"');

demo('3. Detect errors in failed instance', 'NODE_PATH=/workspaces/kaseki-agent node -e "const kasekiCli = require(\'./lib/kaseki-cli-lib.js\'); kasekiCli.config.KASEKI_RESULTS_DIR = \'/tmp/kaseki-cli-demo/agents/kaseki-results\'; const errors = kasekiCli.detectErrors(\'kaseki-3\'); console.log(JSON.stringify({instance: \'kaseki-3\', errorCount: errors.length, errors}, null, 2));"');

demo('4. Get post-run analysis', 'NODE_PATH=/workspaces/kaseki-agent node -e "const kasekiCli = require(\'./lib/kaseki-cli-lib.js\'); kasekiCli.config.KASEKI_RESULTS_DIR = \'/tmp/kaseki-cli-demo/agents/kaseki-results\'; const analysis = kasekiCli.getAnalysis(\'kaseki-1\'); console.log(JSON.stringify(analysis, null, 2));"');

// Cleanup
execSync(`rm -rf "${DEMO_DIR}"`);

console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                           DEMO COMPLETE                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');
