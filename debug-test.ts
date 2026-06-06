import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';

const kasekiAgentPath = path.resolve('kaseki-agent.sh');
const projectRoot = process.cwd();

type RunEvaluationScenario = 'success' | 'malformed-artifact' | 'missing-artifact';

const runRunEvaluationOrchestration = (scenario: RunEvaluationScenario) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `debug-run-evaluation-${scenario}-`));
  const fakeRepo = path.join(tmpDir, 'fake-repo');
  const fakeBin = path.join(tmpDir, 'bin');
  const resultsDir = path.join(tmpDir, 'results');
  const workspaceRepo = path.join(tmpDir, 'repo');
  const appLib = path.join(tmpDir, 'app', 'lib');
  const orchestratorEventsPath = path.join(tmpDir, 'orchestrator-events.jsonl');
  const runLogPath = path.join(tmpDir, 'kaseki-run.log');
  const modifiedScriptPath = path.join(tmpDir, 'kaseki-agent-modified.sh');
  const actualCollectFeedbackPath = path.join(projectRoot, 'scripts', 'collect-feedback.js');

  const writeJson = (filePath: string, value: unknown) => {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  };

  fs.writeFileSync(orchestratorEventsPath, '');
  fs.writeFileSync(runLogPath, '');

  try {
    fs.mkdirSync(path.join(fakeRepo, 'deps', 'fake-dep'), { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.mkdirSync(workspaceRepo, { recursive: true });
    fs.mkdirSync(appLib, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    fs.copyFileSync(
      path.join(projectRoot, 'scripts', 'allowlist-helper.sh'),
      path.join(tmpDir, 'scripts', 'allowlist-helper.sh')
    );
    fs.copyFileSync(
      path.join(projectRoot, 'scripts', 'scouting-allowlist.js'),
      path.join(tmpDir, 'scripts', 'scouting-allowlist.js')
    );
    for (const appLibFile of ['event-aggregator.js', 'timestamp-tracker.js', 'progress-stream-utils.js']) {
      fs.writeFileSync(path.join(appLib, appLibFile), '');
    }

    const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8')
      .replaceAll('${KASEKI_WORKSPACE_DIR}/repo', workspaceRepo)
      .replaceAll('/workspace/repo', workspaceRepo)
      .replaceAll('/results', resultsDir)
      .replaceAll('/app/lib', appLib);
    fs.writeFileSync(modifiedScriptPath, scriptContent, { mode: 0o700 });

    writeJson(path.join(fakeRepo, 'package.json'), {
      name: `fake-run-evaluation-orchestration-${scenario}`,
      version: '1.0.0',
      private: true,
      scripts: { check: 'exit 0' },
      dependencies: { 'fake-dep': 'file:deps/fake-dep' },
    });
    writeJson(path.join(fakeRepo, 'deps', 'fake-dep', 'package.json'), {
      name: 'fake-dep',
      version: '1.0.0',
      private: true,
    });
    fs.writeFileSync(
      path.join(fakeRepo, 'package-lock.json'),
      JSON.stringify({
        name: `fake-run-evaluation-orchestration-${scenario}`,
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: `fake-run-evaluation-orchestration-${scenario}`,
            version: '1.0.0',
            dependencies: { 'fake-dep': 'file:deps/fake-dep' },
          },
          'deps/fake-dep': { version: '1.0.0' },
          'node_modules/fake-dep': { resolved: 'deps/fake-dep', link: true },
        },
      })
    );
    execFileSync('git', ['-C', fakeRepo, 'init', '-q', '-b', 'main']);
    execFileSync('git', ['-C', fakeRepo, 'add', 'package.json', 'package-lock.json', 'deps/fake-dep/package.json']);
    execFileSync('git', [
      '-C', fakeRepo,
      '-c', 'user.email=kaseki-test@example.invalid',
      '-c', 'user.name=Kaseki Test',
      'commit', '-q', '-m', 'initial',
    ]);

    const piStubPath = path.join(fakeBin, 'pi');
    fs.writeFileSync(piStubPath, `#!/usr/bin/env bash
set -uo pipefail
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"
append_event() {
  node - "$ORCHESTRATOR_EVENTS" "$1" "${scenario}" <<'NODE'
const fs = require('node:fs');
const [file, stage, scenario] = process.argv.slice(2);
fs.appendFileSync(file, JSON.stringify({ event: 'pi', stage, scenario, at: Date.now() }) + '\\n');
NODE
}
if printf '%s' "$prompt" | grep -q 'goal-setting Pi agent'; then
  append_event goal-setting
  printf '%s\\n' '{"original_prompt":"inspect then code","upgraded_goal":"Upgraded: inspect then code","reasoning":"test","key_requirements":[],"success_criteria":["run-evaluation should run"],"quality_score":88,"quality_metrics":{"specificity":4}}' > "$KASEKI_RESULTS_DIR/goal-setting-candidate.json"
elif printf '%s' "$prompt" | grep -q 'read-only scouting Pi agent'; then
  append_event scouting
  printf '%s\\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}' > "$KASEKI_RESULTS_DIR/scouting-candidate.json"
elif printf '%s' "$prompt" | grep -q 'read-only goal-check Pi agent'; then
  append_event goal-check
  printf '%s\\n' '{"met":true,"confidence":"high","summary":"Goal met by orchestration stub.","retry_prompt":"","evidence":["diff inspected"],"missing":[],"validation_notes":["validation was available"]}' > "$KASEKI_RESULTS_DIR/goal-check-candidate.json"
elif printf '%s' "$prompt" | grep -q 'read-only run-evaluation Pi agent'; then
  append_event run-evaluation
  if [ "${scenario}" = "malformed-artifact" ]; then
    printf '{"overall_assessment":"good"' > "$KASEKI_RESULTS_DIR/run-evaluation-candidate.json"
  elif [ "${scenario}" = "success" ]; then
    printf '%s\\n' '{"overall_assessment":"good","reviewer_confidence":"high","task_completion_score":4,"summary":"The task was completed with strong evidence.","pr_summary":"Adds the requested behavioral assertion.","human_review_focus":["Confirm test coverage intent"],"efficiency_findings":["No repeated collection work"],"warnings":[],"stage_value":[{"stage":"scouting","value":"medium","reason":"Identified impacted files"},{"stage":"run_evaluation","value":"high","reason":"Captured evaluator output"}],"kaseki_improvement_opportunities":[{"category":"goal_setting","priority":"low","suggestion":"Keep goals specific"},{"category":"evaluation","priority":"medium","suggestion":"Keep contract tests behavioral"}]}' > "$KASEKI_RESULTS_DIR/run-evaluation-candidate.json"
  fi
else
  append_event coding
fi
printf '{"type":"message","model":"test-model"}\\n'
`);

    fs.writeFileSync(path.join(fakeBin, 'kaseki-pi-progress-stream'), `#!/usr/bin/env bash
cat
`);
    fs.writeFileSync(path.join(fakeBin, 'kaseki-pi-event-filter'), `#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
`);
    fs.writeFileSync(path.join(fakeBin, 'timeout'), `#!/usr/bin/env bash
shift 2
"$@"
`);
    fs.writeFileSync(path.join(fakeBin, 'validation-output-filter'), `#!/usr/bin/env bash
cat
`);
    for (const entry of fs.readdirSync(fakeBin)) {
      fs.chmodSync(path.join(fakeBin, entry), 0o700);
    }

    fs.writeFileSync(path.join(tmpDir, 'scripts', 'collect-feedback.js'), `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join('${projectRoot}', 'scripts', 'collect-feedback.js'), ...args], { encoding: 'utf8' });
process.exit(result.status || 0);
`, { mode: 0o700 });

    const result = spawnSync('bash', [modifiedScriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        REPO_URL: fakeRepo,
        GIT_REF: 'main',
        TASK_PROMPT: 'inspect then code',
        OPENROUTER_API_KEY: 'test',
        GITHUB_APP_ENABLED: '0',
        KASEKI_INSTANCE: 'orchestration-instance',
        KASEKI_WORKSPACE_DIR: tmpDir,
        KASEKI_GIT_CACHE_MODE: 'off',
        KASEKI_GOAL_CHECK: '0',
        KASEKI_DEPENDENCY_CACHE_DIR: path.join(tmpDir, 'dependency-cache'),
        KASEKI_IMAGE_DEPENDENCY_CACHE_DIR: path.join(tmpDir, 'image-cache'),
        KASEKI_PRE_AGENT_VALIDATION_COMMANDS: 'npm run check',
        KASEKI_VALIDATION_COMMANDS: ':',
        KASEKI_ALLOW_EMPTY_DIFF: '1',
        KASEKI_RUN_EVALUATION: '1',
        KASEKI_RESULTS_DIR: resultsDir,
        ORCHESTRATOR_EVENTS: orchestratorEventsPath,
      },
    });
    
    console.log('--- STDOUT ---');
    console.log(result.stdout);
    console.log('--- STDERR ---');
    console.log(result.stderr);
    console.log('--- EVENTS ---');
    console.log(fs.readFileSync(orchestratorEventsPath, 'utf8'));

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

runRunEvaluationOrchestration('missing-artifact');
