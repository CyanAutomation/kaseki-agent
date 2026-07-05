# Documentation Index

**Complete guide to kaseki-agent documentation.**

---

## Quick Start

**[GETTING_STARTED.md](GETTING_STARTED.md)** — install, run `quickstart`, submit your first task (45 minutes).

**[EXAMPLES.md](EXAMPLES.md)** — 10+ real-world scenarios (15 minutes).

Everything else is for deeper reading after you have a working setup.

---

## Core Concepts

Understand kaseki-agent fundamentals.

| Document | Purpose |
|---------|---------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture and API service |
| [EXIT_CODES.md](EXIT_CODES.md) | Exit code meanings |
| [QUALITY_GATES.md](QUALITY_GATES.md) | Quality validation and allowlists |
| [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) | Effective task prompts |
| [GOAL_SETTING_GUIDE.md](GOAL_SETTING_GUIDE.md) | Goal-setting phase guide |
| [AUTH_SETUP.md](AUTH_SETUP.md) | GitHub App credential setup |

---

## Setup & Installation

| Document | Purpose |
|---------|---------|
| [NPM_SETUP.md](NPM_SETUP.md) | Install via npm |
| [DOCKER_SETUP.md](DOCKER_SETUP.md) | Docker and Docker Compose setup |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deploy API service (Docker, Node.js) |

---

## Operations & Deployment

| Document | Purpose |
|---------|---------|
| [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) | Multi-host and Kubernetes |
| [CI_CD_INTEGRATION.md](CI_CD_INTEGRATION.md) | GitHub Actions, GitLab CI, Jenkins |
| [CLI.md](CLI.md) | kaseki-cli monitoring and analysis tool |

---

## Optimization & Cost

| Document | Purpose |
|---------|---------|
| [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) | Timeout, cache, allowlist optimization |
| [COST_ESTIMATION.md](COST_ESTIMATION.md) | Cost analysis and budgeting |
| [ENV_VARS.md](ENV_VARS.md) | Environment variable reference |

---

## Troubleshooting & Support

| Document | Purpose |
|---------|---------|
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common failures and fixes |
| [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) | Recovery procedures |

---

## Use Cases

### I want to fix a bug

1. GETTING_STARTED.md — get kaseki-agent running
2. EXAMPLES.md — example: Bug Fix in a Single File
3. TASK_PROMPT_TEMPLATES.md — write a clear prompt
4. QUALITY_GATES.md — set allowlist to restrict changes
5. TROUBLESHOOTING.md — if something goes wrong

### I want to deploy for my team

1. DEPLOYMENT.md — choose Docker Compose or Node.js
2. AUTH_SETUP.md — set up API keys and credentials
3. DISTRIBUTED_SETUP.md — plan for HA or multi-region
4. CI_CD_INTEGRATION.md — automate in CI/CD
5. DISASTER_RECOVERY.md — set up backup/failover

### I want to automate in CI/CD

1. CI_CD_INTEGRATION.md — platform-specific workflows
2. DEPLOYMENT.md — deploy the API service
3. EXAMPLES.md — example: Multi-Repo Batch Processing
4. TROUBLESHOOTING.md — handle failures in CI/CD

### I want to optimize cost and performance

1. PERFORMANCE_TUNING.md — timeout, cache, allowlist tuning
2. COST_ESTIMATION.md — understand and predict costs
3. ENV_VARS.md — configure tuning parameters
4. EXAMPLES.md — optimization patterns

### My kaseki-agent run failed

1. TROUBLESHOOTING.md — diagnosis flowchart
2. EXIT_CODES.md — look up the exit code
3. CLI.md — use kaseki-cli to inspect the run
4. DISASTER_RECOVERY.md — if recovery is needed

### I need to scale across regions

1. DISTRIBUTED_SETUP.md — multi-host and Kubernetes
2. DEPLOYMENT.md — deploy API service on multiple hosts
3. DISASTER_RECOVERY.md — set up replication and failover
4. PERFORMANCE_TUNING.md — load balancing and concurrency

---

## Recommended Reading Order

### First Time Users

```
1. GETTING_STARTED.md       (10 min)  — install, quickstart, first task
2. EXAMPLES.md              (15 min)  — see what it does
3. AUTH_SETUP.md            (10 min)  — set up GitHub App credentials
4. QUALITY_GATES.md         (10 min)  — understand safety features
```

**Estimated: 45 minutes** to get started

### Production Deployment

```
1. DEVELOPMENT.md           (15 min)  — understand architecture
2. DEPLOYMENT.md            (30 min)  — choose deployment method
3. AUTH_SETUP.md            (15 min)  — secure credentials
4. DISTRIBUTED_SETUP.md     (20 min)  — plan for HA/scale
5. CI_CD_INTEGRATION.md     (20 min)  — automate in CI/CD
6. DISASTER_RECOVERY.md     (20 min)  — plan for failures
7. TROUBLESHOOTING.md       (15 min)  — familiarize with diagnosis
```

**Estimated: 2-3 hours** to deploy production-ready

### Optimization & Cost Management

```
1. PERFORMANCE_TUNING.md    (20 min)  — understand tuning options
2. COST_ESTIMATION.md       (15 min)  — estimate costs
3. ENV_VARS.md              (10 min)  — review configuration
4. EXAMPLES.md              (20 min)  — see optimization patterns
```

**Estimated: 1 hour** to optimize

---

## Search Tips

**Looking for...** → **Start here**

- How to get started → GETTING_STARTED.md
- Old setup guide → SETUP_GUIDE.md
- How to deploy production → DEPLOYMENT.md
- How to fix a failed run → TROUBLESHOOTING.md
- How to reduce costs → COST_ESTIMATION.md
- How to write better prompts → TASK_PROMPT_TEMPLATES.md
- How to integrate with GitHub Actions → CI_CD_INTEGRATION.md
- How to set up multi-region → DISTRIBUTED_SETUP.md
- How to recover from disasters → DISASTER_RECOVERY.md
- What does exit code X mean → EXIT_CODES.md
- What environment variables do → ENV_VARS.md
- Real-world examples → EXAMPLES.md
- API monitoring → CLI.md
- Architecture details → DEVELOPMENT.md

---

## Documentation Statistics

| Metric | Value |
|--------|-------|
| **Total documents** | 22 |
| **Setup guides** | 4 |
| **Concepts & reference** | 5 |
| **Deployment & operations** | 4 |
| **Usage & examples** | 2 |
| **Optimization** | 2 |
| **Troubleshooting** | 2 |
| **Total pages** | ~200 |
| **Total examples** | 30+ |

---

## Contributing to Docs

To improve documentation:

1. Identify gaps or outdated sections
2. Submit pull requests with improvements
3. Keep examples executable and tested
4. Update this INDEX.md if adding new documents

**Maintenance:** Docs are reviewed quarterly for accuracy and relevance.

---

## Last Updated

May 2026

---

## See Also

| Document | Purpose |
|---------|---------|
| [README.md](../README.md) | Project overview |
| [CLAUDE.md](../CLAUDE.md) | AI coding agent guidance |
| [CHANGELOG.md](../CHANGELOG.md) | Release notes & archived docs |

## Internal / Developer Documentation

These documents are for contributors and maintainers. They are not needed for using kaseki-agent.

| Document | Purpose |
|---------|---------|
| [internal/DEVELOPMENT.md](internal/DEVELOPMENT.md) | Architecture, coding conventions |
| [internal/BUILD_STRATEGY.md](internal/BUILD_STRATEGY.md) | Build pipeline and CI/CD |
| [internal/BACKLOG.md](internal/BACKLOG.md) | Planned improvements |
| [internal/IMPLEMENTATION_SUMMARY.md](internal/IMPLEMENTATION_SUMMARY.md) | Phase completion notes |
| [internal/DUPLICATION_AUDIT.md](internal/DUPLICATION_AUDIT.md) | Code quality audits |
| [internal/PHASE1_COMPLETION.md](internal/PHASE1_COMPLETION.md) | Phase 1 implementation notes |
| [internal/PHASE2_COMPLETION.md](internal/PHASE2_COMPLETION.md) | Phase 2 implementation notes |
| [internal/PHASE6_MIGRATION.md](internal/PHASE6_MIGRATION.md) | Phase 6 migration notes |