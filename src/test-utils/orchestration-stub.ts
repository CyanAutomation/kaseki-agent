/**
 * Lightweight orchestration stubs for testing feedback collection
 *
 * Instead of running the full kaseki-agent.sh script (40-70s per test),
 * this utility creates minimal artifact stubs to test feedback collection logic.
 * Preserves test intent while eliminating script execution overhead.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type OrchestrationScenario =
  | 'success'
  | 'pi-exit-failure'
  | 'malformed-artifact'
  | 'missing-artifact';

export interface OrchestrationStubEnv {
  tmpDir: string;
  resultsDir: string;
  fakeRepo: string;
  fakeBin: string;
  workspaceRepo: string;
  appLib: string;
  orchestratorEventsPath: string;
  artifactPaths: {
    goalSettingPath: string;
    goalCheckPath: string;
    runEvaluationPath: string;
    metadataPath: string;
    stageTimingsPath: string;
  };
}

/**
 * Create a lightweight orchestration environment for feedback collection tests
 *
 * This creates minimal artifacts that simulate a completed orchestration stage,
 * without executing the full kaseki-agent.sh script. The stub creates:
 * - Artifact stubs (goal-setting.json, goal-check.json, run-evaluation.json)
 * - Stage timings to indicate completion/failure
 * - Minimal directory structure
 *
 * @param tmpDir Base temporary directory
 * @param scenario Orchestration outcome (success/pi-exit-failure/malformed-artifact)
 * @param phase The orchestration phase being tested ('goal-check' or 'run-evaluation')
 * @returns Paths to all created artifacts
 */
export function createMinimalOrchestrationEnv(
  tmpDir: string,
  scenario: OrchestrationScenario,
  phase: 'goal-check' | 'run-evaluation'
): OrchestrationStubEnv {
  const resultsDir = path.join(tmpDir, 'results');
  const fakeRepo = path.join(tmpDir, 'fake-repo');
  const fakeBin = path.join(tmpDir, 'bin');
  const workspaceRepo = path.join(tmpDir, 'repo');
  const appLib = path.join(tmpDir, 'app', 'lib');
  const orchestratorEventsPath = path.join(tmpDir, 'orchestrator-events.jsonl');

  // Create directory structure
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(path.join(fakeRepo, 'deps', 'fake-dep'), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(workspaceRepo, { recursive: true });
  fs.mkdirSync(appLib, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });

  // Initialize event log with pi events that simulate orchestration stages
  const piEvents = [];

  // For goal-check phase tests, include goal-check pi event
  if (phase === 'goal-check') {
    piEvents.push({ event: 'pi', stage: 'goal-check', scenario, at: Date.now() });
  } else if (phase === 'run-evaluation') {
    // For run-evaluation phase tests, include both goal-check and run-evaluation pi events
    piEvents.push({ event: 'pi', stage: 'goal-check', scenario, at: Date.now() });
    piEvents.push({ event: 'pi', stage: 'run-evaluation', scenario, at: Date.now() + 1 });
  }

  const eventLog = piEvents.map(event => JSON.stringify(event)).join('\n');
  if (eventLog) {
    fs.writeFileSync(orchestratorEventsPath, eventLog + '\n');
  } else {
    fs.writeFileSync(orchestratorEventsPath, '');
  }

  // Write fake repo files
  fs.writeFileSync(
    path.join(fakeRepo, 'package.json'),
    JSON.stringify({
      name: `fake-orchestration-${scenario}`,
      version: '1.0.0',
      private: true,
      scripts: { check: 'exit 0' },
      dependencies: { 'fake-dep': 'file:deps/fake-dep' },
    })
  );

  fs.writeFileSync(
    path.join(fakeRepo, 'deps', 'fake-dep', 'package.json'),
    JSON.stringify({
      name: 'fake-dep',
      version: '1.0.0',
      private: true,
    })
  );

  fs.writeFileSync(
    path.join(fakeRepo, 'package-lock.json'),
    JSON.stringify({
      name: `fake-orchestration-${scenario}`,
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: `fake-orchestration-${scenario}`,
          version: '1.0.0',
          dependencies: { 'fake-dep': 'file:deps/fake-dep' },
        },
        'deps/fake-dep': { version: '1.0.0' },
        'node_modules/fake-dep': { resolved: 'deps/fake-dep', link: true },
      },
    })
  );

  // Create minimal fake binaries
  fs.writeFileSync(path.join(fakeBin, 'pi'), '#!/bin/bash\necho \'{"type":"message"}\'\n', { mode: 0o700 });
  fs.writeFileSync(path.join(fakeBin, 'timeout'), '#!/bin/bash\nshift 2\n"$@"\n', { mode: 0o700 });
  fs.writeFileSync(path.join(fakeBin, 'npm'), '#!/bin/bash\nmkdir -p node_modules\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(
    path.join(fakeBin, 'kaseki-pi-event-filter'),
    '#!/bin/bash\ncat "$1" > "$2"\nprintf \'{"selected_model":"test-model"}\\n\' > "$3"\n',
    { mode: 0o700 }
  );

  // Write artifacts based on phase and scenario
  const stageTimingsPath = path.join(resultsDir, 'stage-timings.tsv');
  const goalSettingPath = path.join(resultsDir, 'goal-setting.json');
  const goalCheckPath = path.join(resultsDir, 'goal-check.json');
  const runEvaluationPath = path.join(resultsDir, 'run-evaluation.json');
  const metadataPath = path.join(resultsDir, 'metadata.json');

  // Write common artifacts
  fs.writeFileSync(
    goalSettingPath,
    JSON.stringify({
      original_prompt: 'inspect then code',
      upgraded_goal: 'Upgraded: inspect then code',
      reasoning: 'test',
      key_requirements: [],
      success_criteria: ['goal-check should run'],
      quality_score: 85,
      quality_metrics: { clarity: 4, measurability: 4, specificity: 4 },
    })
  );

  fs.writeFileSync(
    metadataPath,
    JSON.stringify({
      task_mode: 'patch',
      instance: 'orchestration-instance',
      validation_passed: phase === 'run-evaluation' ? false : true,
      coding_attempts: 1,
      goal_check_met: false,
      total_duration_seconds: 30,
    })
  );

  fs.writeFileSync(path.join(resultsDir, 'validation.log'), 'npm test passed\n');
  fs.writeFileSync(path.join(resultsDir, 'progress.log'), 'orchestration complete\n');
  fs.writeFileSync(path.join(resultsDir, 'test-impact-warnings.json'), JSON.stringify({ warnings: [] }));
  fs.writeFileSync(
    path.join(resultsDir, 'restoration-report.md'),
    'No files restored during orchestration.\n'
  );

  // Write stage-timings based on phase and scenario
  if (phase === 'goal-check') {
    // Goal-check phase only writes goal-check stage-timings
    if (scenario === 'success') {
      fs.writeFileSync(
        goalCheckPath,
        JSON.stringify({
          met: true,
          confidence: 'high',
          summary: 'Goal met by orchestration stub.',
          retry_prompt: '',
          evidence: ['diff inspected'],
          missing: [],
          validation_notes: ['validation was available'],
        })
      );
      fs.writeFileSync(stageTimingsPath, 'goal check\t0\t30\n');
    } else if (scenario === 'pi-exit-failure') {
      fs.writeFileSync(goalCheckPath, JSON.stringify({ met: false, confidence: 'low' }));
      fs.writeFileSync(stageTimingsPath, 'goal check\t42\t0\n'); // Exit code 42
    } else if (scenario === 'malformed-artifact') {
      // Write malformed JSON to trigger validation error
      fs.writeFileSync(goalCheckPath, '{"met":true,"confidence":"high"');
      fs.writeFileSync(stageTimingsPath, 'goal check\t86\t0\n'); // Exit code 86
      fs.writeFileSync(path.join(resultsDir, 'goal-check-validation-reason.txt'), 'malformed_json');
    } else if (scenario === 'missing-artifact') {
      // Don't write goal-check artifact at all
      fs.writeFileSync(stageTimingsPath, 'goal check\t0\t30\n');
    }
  } else {
    // For run-evaluation phase, write goal-check artifacts but don't write stage-timings yet
    // (stage-timings will be written in run-evaluation section)
    if (scenario !== 'missing-artifact') {
      fs.writeFileSync(
        goalCheckPath,
        JSON.stringify({
          met: true,
          confidence: 'high',
          summary: 'Goal met by orchestration stub.',
          retry_prompt: '',
          evidence: ['diff inspected'],
          missing: [],
          validation_notes: ['validation was available'],
        })
      );
    }
  }

  // Write run-evaluation artifacts (for run-evaluation phase)
  if (phase === 'run-evaluation') {
    if (scenario === 'success') {
      fs.writeFileSync(
        runEvaluationPath,
        JSON.stringify({
          overall_assessment: 'good',
          reviewer_confidence: 'high',
          task_completion_score: 4,
          stage_value: 'completed',
          kaseki_improvement_opportunities: ['add_guardrails'],
        })
      );
      fs.writeFileSync(stageTimingsPath, 'run evaluation\t0\t30\n');
    } else if (scenario === 'malformed-artifact' || scenario === 'missing-artifact') {
      // Both malformed and missing scenarios write error artifact with exit code 86
      fs.writeFileSync(
        runEvaluationPath,
        JSON.stringify({
          overall_assessment: 'unknown',
          reviewer_confidence: 'low',
          task_completion_score: 1,
          warnings: ['run_evaluation_failed_exit_86'],
        })
      );
      fs.writeFileSync(stageTimingsPath, 'run evaluation\t86\t0\n');
    } else if (scenario === 'pi-exit-failure') {
      // Pi stage failed - write artifact showing failure
      fs.writeFileSync(
        runEvaluationPath,
        JSON.stringify({
          overall_assessment: 'unknown',
          reviewer_confidence: 'low',
          task_completion_score: 1,
          warnings: ['run_evaluation_failed_exit_86'],
        })
      );
      fs.writeFileSync(stageTimingsPath, 'run evaluation\t86\t0\n');
    }
  }

  return {
    tmpDir,
    resultsDir,
    fakeRepo,
    fakeBin,
    workspaceRepo,
    appLib,
    orchestratorEventsPath,
    artifactPaths: {
      goalSettingPath,
      goalCheckPath,
      runEvaluationPath,
      metadataPath,
      stageTimingsPath,
    },
  };
}

/**
 * Create goal-check specific orchestration environment
 */
export function createGoalCheckOrchestrationEnv(
  tmpDir: string,
  scenario: 'success' | 'pi-exit-failure' | 'malformed-artifact'
): OrchestrationStubEnv {
  return createMinimalOrchestrationEnv(tmpDir, scenario, 'goal-check');
}

/**
 * Create run-evaluation specific orchestration environment
 */
export function createRunEvaluationOrchestrationEnv(
  tmpDir: string,
  scenario: 'success' | 'malformed-artifact' | 'missing-artifact' | 'pi-exit-failure'
): OrchestrationStubEnv {
  return createMinimalOrchestrationEnv(tmpDir, scenario, 'run-evaluation');
}
