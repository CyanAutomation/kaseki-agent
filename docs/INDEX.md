# Documentation Index

Use this page to find current user and developer guidance. Each document is
listed once, under its primary purpose. For repository-wide file ownership and
disposition, see the [documentation inventory](internal/MARKDOWN_INVENTORY.md).

## Start and connect

| Document | Use it for |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Choose a setup path and submit a first task |
| [Raspberry Pi quick start](QUICK_START.md) | Set up the supported Compose deployment on a clean host |
| [Setup guide](SETUP_GUIDE.md) | Route to the correct setup guide from an existing checkout |
| [npm setup](NPM_SETUP.md) | Install the CLI and connect it to an API |
| [Docker setup](DOCKER_SETUP.md) | Configure an existing Docker Compose host |
| [Authentication setup](AUTH_SETUP.md) | Configure API keys and GitHub App credentials |

## Operate and integrate

| Document | Use it for |
| --- | --- |
| [Deployment](DEPLOYMENT.md) | Operate, secure, and update the API service |
| [API reference](API.md) | REST endpoints, authentication, and response formats |
| [CLI reference](CLI.md) | CLI commands for task submission and run monitoring |
| [Distributed setup](DISTRIBUTED_SETUP.md) | Multi-host and Kubernetes designs |
| [CI/CD integration](CI_CD_INTEGRATION.md) | Use Kaseki from automation pipelines |
| [Soyuz integration](SOYUZ_INTEGRATION.md) | Configure and operate the Soyuz queue adapter |
| [Sentry integration](SENTRY_INTEGRATION.md) | Configure error tracking |
| [Troubleshooting](TROUBLESHOOTING.md) | Diagnose setup and run failures |
| [Exit codes](EXIT_CODES.md) | Interpret process and quality-gate results |

## Configure and tune

| Document | Use it for |
| --- | --- |
| [Environment variables](ENV_VARS.md) | Find variable names, defaults, and purposes |
| [Advanced configuration](ADVANCED_CONFIG.md) | Understand advanced settings and configuration behavior |
| [Quality gates](QUALITY_GATES.md) | Configure file allowlists and validation gates |
| [Secret scan allowlist](SECRET_SCAN_ALLOWLIST.md) | Allow intentional test fixtures in secret scans |
| [Performance tuning](PERFORMANCE_TUNING.md) | Tune execution time, caching, and resource use |
| [Cost estimation](COST_ESTIMATION.md) | Estimate and manage provider costs |
| [Suggested models](suggested_models.md) | Review model suggestions |

## Use Kaseki

| Document | Use it for |
| --- | --- |
| [Examples](EXAMPLES.md) | Common task and integration scenarios |
| [Integration example](INTEGRATION_EXAMPLE.md) | A TypeScript client integration |
| [Task prompt templates](TASK_PROMPT_TEMPLATES.md) | Write scoped task instructions |
| [Goal-setting guide](GOAL_SETTING_GUIDE.md) | Goal-setting behavior and interpretation |
| [Evaluation best practices](EVALUATION_BEST_PRACTICES.md) | Review run and goal-check evaluations |
| [Artifact schemas](ARTIFACT_SCHEMAS.md) | Inspect generated run artifacts |
| [Test isolation](TEST_ISOLATION_BEST_PRACTICES.md) | Keep tests isolated from host and shared state |

## Develop and understand the system

| Document | Use it for |
| --- | --- |
| [Development guide](DEVELOPMENT.md) | Build, test, and extend the repository |
| [Design](DESIGN.md) | Read the system design overview |
| [Code style](STYLE.md) | Follow repository coding conventions |
| [Verification guide](VERIFICATION_GUIDE.md) | Verify a change and its behavior |
| [Gateway testing](GATEWAY_TEST.md) | Run gateway connectivity checks |
| [Decision models](DECISION_MODELS.md) | Understand deterministic decisions and model integrations |
| [Scouting prompt design](SCOUTING_PROMPT_DESIGN.md) | Understand scouting prompts and outputs |
| [Lifecycle diagrams](KASEKI-AGENT-LIFECYCLE-DIAGRAMS.md) | Follow run and phase lifecycles |

## Feature and design notes

These pages explain specific implementations and experiments. Use the code and
current user guides as the source of truth for shipped behavior.

- [API assessment](API_ASSESSMENT.md)
- [Async awareness](ASYNC_AWARENESS.md)
- [Baseline test comparison](BASELINE_TEST_COMPARISON.md)
- [Compilation validation](COMPILATION_VALIDATION.md)
- [Feedback-loop integration](FEEDBACK_LOOP_INTEGRATION.md)
- [Hashline monitoring](HASHLINE_MONITORING.md)
- [Hashline rollout strategy](HASHLINE_ROLLOUT_STRATEGY.md)
- [Host setup API reference](HOST_SETUP_API_REFERENCE.md)
- [Pi hashline edit tool](PI_TOOL_HASHLINE_EDIT.md)
- [Preservation constraints](PRESERVATION_CONSTRAINTS_IMPLEMENTATION.md)
- [Run scorecard design](RUN_SCORECARD_DESIGN.md)
- [Validation causality overview](VALIDATION_CAUSALITY_ANALYSIS.md)
- [Validation causality architecture](VALIDATION_CAUSALITY_ANALYSIS_ARCHITECTURE.md)
- [Workflow hardening](WORKFLOW_HARDENING.md)

## Repository material

- [Contributing guide](../CONTRIBUTING.md)
- [Repository instructions](../CLAUDE.md)
- [Agent skills](../.agents/skills/README.md)
- [Internal engineering notes](internal/)
- [Configuration audit](configuration-audit/)
- [Historical documentation archive](archive/README.md)
- [Archived security and deployment investigations](archive/project-reports/README.md)
- [Consolidation and migration map](DOCS_CONSOLIDATION_MAP.md)
