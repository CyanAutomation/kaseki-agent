/**
 * Example: OpenClaw integration with Kaseki API
 *
 * This example shows how OpenClaw would use the Kaseki API to:
 * 1. Submit a coding task to kaseki-agent
 * 2. Monitor progress
 * 3. Retrieve and analyze results
 */

import { KasekiApiClient } from './kaseki-api-client';

/**
 * Example: Request a bug fix from kaseki-agent
 */
export async function exampleBugFixWorkflow(): Promise<void> {
  // Initialize client
  const client = new KasekiApiClient('http://kaseki-host:8080', 'sk-your-api-key');

  try {
    // 1. Verify API is healthy
    console.log('Checking API health...');
    const health = await client.getHealth();
    console.log('API health:', health.status);

    // 2. Submit a bug fix task
    console.log('\nSubmitting bug fix task...');
    const run = await client.submit({
      repoUrl: 'https://github.com/your-org/your-repo',
      ref: 'main',
      taskPrompt: 'Fix the parser bug in src/lib/parser.ts. The bug causes incorrect parsing of nested objects.',
      changedFilesAllowlist: ['src/lib/parser.ts', 'tests/parser.test.ts'],
      maxDiffBytes: 150000,
      validationCommands: ['npm run lint', 'npm run test'],
    });

    console.log(`Task submitted! Run ID: ${run.id}`);

    // 3. Monitor progress
    console.log('\nMonitoring progress...');
    const result = await client.waitForCompletion(run.id, {
      timeout: 30 * 60 * 1000, // 30 minutes
      interval: 5000, // Poll every 5 seconds
      onProgress: (status) => {
        const timeoutPercent = status.timeoutRiskPercent || 0;
        console.log(`[${status.elapsedSeconds}s] ${status.status}: ${status.progress || ''} (${timeoutPercent}% timeout risk)`);
      },
    });

    console.log(`\nRun completed with status: ${result.status}`);

    // 4. Retrieve detailed analysis
    if (result.status === 'completed') {
      console.log('\nRetrieving analysis...');
      const analysis = await client.getAnalysis(run.id);

      console.log('Changes made:');
      if (analysis.changes) {
        console.log(`  Files modified: ${analysis.changes.changedFiles.join(', ')}`);
        console.log(`  Diff size: ${analysis.changes.diffSize} bytes`);
      }

      console.log('\nValidation results:');
      if (analysis.validation) {
        console.log(`  Passed: ${analysis.validation.passed}`);
        for (const cmd of analysis.validation.commandResults) {
          console.log(`  - ${cmd.command}: exit code ${cmd.exitCode} (${cmd.elapsed}ms)`);
        }
      }

      // 5. Download the diff for review
      console.log('\nDownloading diff...');
      const diff = await client.getArtifact(run.id, 'git.diff');
      console.log('Diff preview (first 500 chars):');
      console.log(diff.substring(0, 500));

      // 6. Get full metadata
      const metadata = await client.getArtifact(run.id, 'metadata.json');
      const meta = JSON.parse(metadata);
      console.log('\nRun metadata:');
      console.log(`  Model: ${meta.model}`);
      console.log(`  Instance: ${meta.instance}`);
      console.log(`  Exit code: ${meta.exitCode}`);
    } else {
      // 7. Handle failure
      console.log(`\nRun failed with: ${result.failureClass}`);
      console.log(`Error: ${result.error}`);

      // Get stderr for debugging
      const stderr = await client.getLog(run.id, 'stderr');
      console.log('Error output:');
      console.log(stderr.substring(0, 1000));
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

/**
 * Example: Batch submit multiple tasks and wait for all to complete
 */
export async function exampleBatchWorkflow(): Promise<void> {
  const client = new KasekiApiClient('http://kaseki-host:8080', 'sk-your-api-key');

  const tasks = [
    {
      repoUrl: 'https://github.com/org/repo1',
      taskPrompt: 'Fix typo in README',
    },
    {
      repoUrl: 'https://github.com/org/repo2',
      taskPrompt: 'Update dependencies',
    },
    {
      repoUrl: 'https://github.com/org/repo3',
      taskPrompt: 'Add type annotations to JavaScript files',
    },
  ];

  console.log(`Submitting ${tasks.length} tasks...\n`);

  // Submit all tasks
  const runs = await Promise.all(
    tasks.map((task) =>
      client.submit({
        ...task,
        ref: 'main',
      })
    )
  );

  console.log(`Submitted ${runs.length} runs: ${runs.map((r) => r.id).join(', ')}\n`);

  // Wait for all to complete
  const results = await Promise.all(
    runs.map((run) =>
      client.waitForCompletion(run.id, {
        onProgress: (status) => {
          console.log(`[${run.id}] ${status.status}`);
        },
      })
    )
  );

  // Summarize results
  const succeeded = results.filter((r) => r.status === 'completed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log(`\nResults: ${succeeded} succeeded, ${failed} failed`);
}

/**
 * Example: Stream logs in real-time (polling)
 */
export async function exampleStreamLogs(runId: string): Promise<void> {
  const client = new KasekiApiClient('http://kaseki-host:8080', 'sk-your-api-key');

  let lastLineCount = 0;

  // Poll for new log lines
  const pollInterval = setInterval(async () => {
    try {
      const log = await client.getLog(runId, 'progress');
      const lines = log.split('\n');
      const newLines = lines.slice(lastLineCount);

      if (newLines.length > 0) {
        console.log(newLines.join('\n'));
        lastLineCount = lines.length;
      }

      // Check if job is done
      const status = await client.getStatus(runId);
      if (status.status !== 'running' && status.status !== 'queued') {
        clearInterval(pollInterval);
        console.log(`\nJob ${status.status}`);
      }
    } catch (err) {
      console.error('Error polling logs:', err);
      clearInterval(pollInterval);
    }
  }, 5000); // Poll every 5 seconds
}

/**
 * Example: Check queue status
 */
export async function exampleCheckQueue(): Promise<void> {
  const client = new KasekiApiClient('http://kaseki-host:8080', 'sk-your-api-key');

  const health = await client.getHealth();
  console.log('API Health:', health.status);

  if (health.status === 'healthy' || health.status === 'degraded') {
    const queue = health.errors;
    console.log(`Queue status:`);
    console.log(`  Status: ${health.status}`);
  }

  // List recent runs
  const runsList = await client.listRuns();
  console.log(`\nRecent runs (${runsList.total} total):`);
  for (const run of runsList.runs.slice(0, 5)) {
    const duration = run.completedAt
      ? Math.round((new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)
      : '?';
    console.log(`  ${run.id}: ${run.status} (${duration}s)`);
  }
}

// Run an example
if (require.main === module) {
  exampleBugFixWorkflow().catch(console.error);
}
