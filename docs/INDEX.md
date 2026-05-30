# Documentation Index

**Complete guide to kaseki-agent documentation.**

---

## For First-Time Users → Start Here

**[GETTING_STARTED.md](GETTING_STARTED.md)** — install, run `quickstart`, submit your first task.

Everything else in this index is for deeper reading after you have a working setup.

---

## Quick Navigation

### 🚀 Getting Started

| Document | Purpose |
|---------|---------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | **Single canonical entry point** — install, quickstart, first task |
| [AUTH_SETUP.md](AUTH_SETUP.md) | Detailed GitHub App credential setup |
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | Legacy path selector (npm / Docker / script) |

### 📚 Core Concepts

Understand how kaseki-agent works.

| Document | Purpose |
|---------|---------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture, API service components |
| [EXIT_CODES.md](EXIT_CODES.md) | Understand exit codes and what they mean |
| [QUALITY_GATES.md](QUALITY_GATES.md) | Quality validation, allowlists, diff size limits |
| [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) | Writing effective task prompts |
| [GOAL_SETTING_GUIDE.md](GOAL_SETTING_GUIDE.md) | Goal-setting phase: upgrade prompts into mature goals |
| [GOAL_SETTING_IMPROVEMENTS.md](GOAL_SETTING_IMPROVEMENTS.md) | **New (May 2026):** OpenAI best practices improvements (SMART criteria, anti-patterns, feedback loops) |
| [GOAL_SETTING_PRACTICAL_GUIDE.md](GOAL_SETTING_PRACTICAL_GUIDE.md) | **New:** Hands-on guide to leveraging goal-setting improvements |

### 🔧 Operations & Deployment

Run and manage kaseki-agent in production.

| Document | Purpose |
|---------|---------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deploy API service (Docker, Node.js, systemd) |
| [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) | Multi-host and Kubernetes deployments |
| [CI_CD_INTEGRATION.md](CI_CD_INTEGRATION.md) | Integrate with GitHub Actions, GitLab CI, Jenkins |
| [CLI.md](CLI.md) | Use kaseki-cli for monitoring and analysis |

### � Monitoring & Observability

Monitor and debug kaseki-agent in production.

| Document | Purpose |
|---------|---------|
| [SENTRY_INTEGRATION.md](SENTRY_INTEGRATION.md) | Error tracking with Sentry (setup, config, alerts) |

### �🛠️ Usage & Examples

Learn by example.

| Document | Purpose |
|---------|---------|
| [EXAMPLES.md](EXAMPLES.md) | 10+ real-world scenarios (bug fixes, features, tests) |
| [INTEGRATION_EXAMPLE.md](INTEGRATION_EXAMPLE.md) | TypeScript/OpenClaw integration pattern |
| [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) | Template prompts for common tasks |

### ⚡ Optimization & Performance

Tune for speed and cost.

| Document | Purpose |
|---------|---------|
| [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) | Timeout, cache, allowlist optimization |
| [COST_ESTIMATION.md](COST_ESTIMATION.md) | Understand and manage costs |
| [ENV_VARS.md](ENV_VARS.md) | Complete environment variable reference |

### 🔍 Troubleshooting & Support

Diagnose and fix issues.

| Document | Purpose |
|---------|---------|
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Decision trees for common failures |
| [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) | Recovery procedures and backups |
| [EXIT_CODES.md](EXIT_CODES.md) | Exit code meanings and fixes |

---

## Documentation by Audience

### For Developers

**Getting started:**

| Document | Purpose |
|---------|---------|
| [NPM_SETUP.md](NPM_SETUP.md) | Install via npm |
| [EXAMPLES.md](EXAMPLES.md) | Real-world use cases |
| [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) | Write better prompts |

**Troubleshooting:**

| Document | Purpose |
|---------|---------|
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues and fixes |
| [EXIT_CODES.md](EXIT_CODES.md) | Understand failures |

**Advanced:**

| Document | Purpose |
|---------|---------|
| [INTEGRATION_EXAMPLE.md](INTEGRATION_EXAMPLE.md) | Programmatic integration |
| [CI_CD_INTEGRATION.md](CI_CD_INTEGRATION.md) | Automate in CI/CD pipelines |

### For DevOps / Site Reliability Engineers

**Setup & deployment:**

| Document | Purpose |
|---------|---------|
| [DOCKER_SETUP.md](DOCKER_SETUP.md) | Container deployment |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production API service setup |
| [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) | Multi-host & Kubernetes |

**Operations:**

| Document | Purpose |
|---------|---------|
| [CLI.md](CLI.md) | Monitoring with kaseki-cli |
| [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) | Backup and failure recovery |

**Optimization:**

| Document | Purpose |
|---------|---------|
| [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) | Scaling and optimization |
| [COST_ESTIMATION.md](COST_ESTIMATION.md) | Budget planning |

### For Team Leads / Architects

**Understanding scope:**

| Document | Purpose |
|---------|---------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture overview |
| [repo-maturity.md](repo-maturity.md) | Production readiness assessment |
| [QUALITY_GATES.md](QUALITY_GATES.md) | Quality & governance model |

**Decision-making:**

| Document | Purpose |
|---------|---------|
| [COST_ESTIMATION.md](COST_ESTIMATION.md) | Cost analysis and budgeting |
| [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) | Deployment architecture options |

**Governance:**

| Document | Purpose |
|---------|---------|
| [AUTH_SETUP.md](AUTH_SETUP.md) | Security & credential management |
| [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) | Prompt guidelines |

---

## Documentation by Use Case

### Use Case: "I want to fix a bug with kaseki-agent"

1. [SETUP_GUIDE.md](SETUP_GUIDE.md) — Get kaseki-agent running
2. [EXAMPLES.md](EXAMPLES.md) — Example 1: Bug Fix in a Single File
3. [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — Write a clear prompt
4. [QUALITY_GATES.md](QUALITY_GATES.md) — Set allowlist to restrict changes
5. [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — If something goes wrong

### Use Case: "I want to deploy kaseki-agent for my team"

1. [DEPLOYMENT.md](DEPLOYMENT.md) — Choose: Docker Compose or Node.js
2. [AUTH_SETUP.md](AUTH_SETUP.md) — Set up API keys and credentials
3. [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) — If you need HA or multi-region
4. [CI_CD_INTEGRATION.md](CI_CD_INTEGRATION.md) — Integrate with your CI/CD
5. [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) — Set up backup/failover

### Use Case: "I want to automate kaseki-agent in my CI/CD pipeline"

1. [CI_CD_INTEGRATION.md](CI_CD_INTEGRATION.md) — Platform-specific workflows
2. [DEPLOYMENT.md](DEPLOYMENT.md) — Deploy the API service first
3. [EXAMPLES.md](EXAMPLES.md) — Example 8: Multi-Repo Batch Processing
4. [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Handle failures in CI/CD

### Use Case: "I want to optimize cost and performance"

1. [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) — Timeout, cache, allowlist tuning
2. [COST_ESTIMATION.md](COST_ESTIMATION.md) — Understand and predict costs
3. [ENV_VARS.md](ENV_VARS.md) — Configure all tuning parameters
4. [EXAMPLES.md](EXAMPLES.md) — Real scenarios with costs

### Use Case: "My kaseki-agent run failed"

1. [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Diagnosis flowchart
2. [EXIT_CODES.md](EXIT_CODES.md) — Look up the exit code
3. [CLI.md](CLI.md) — Use kaseki-cli to inspect the run
4. [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) — If recovery is needed

### Use Case: "I need to scale kaseki-agent across regions"

1. [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) — Multi-host and Kubernetes patterns
2. [DEPLOYMENT.md](DEPLOYMENT.md) — Deploy API service on multiple hosts
3. [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) — Set up replication and failover
4. [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) — Load balancing and concurrency

---

## All Documents

### Setup & Installation

| Document | Purpose |
|----------|---------|
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | Entry point router for getting started |
| [NPM_SETUP.md](NPM_SETUP.md) | Install via npm package |
| [DOCKER_SETUP.md](DOCKER_SETUP.md) | Docker and Docker Compose setup |
| [AUTH_SETUP.md](AUTH_SETUP.md) | Credential and API key configuration |

### Core Concepts & Reference

| Document | Purpose |
|----------|---------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture and development guide |
| [EXIT_CODES.md](EXIT_CODES.md) | Exit code meanings and troubleshooting |
| [QUALITY_GATES.md](QUALITY_GATES.md) | Allowlists, diff limits, pattern syntax |
| [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) | Writing effective prompts |
| [ENV_VARS.md](ENV_VARS.md) | Complete environment variable reference |

### Deployment & Operations

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | API service deployment (Docker, Node.js, systemd) |
| [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) | Multi-host, regional, Kubernetes deployments |
| [CI_CD_INTEGRATION.md](CI_CD_INTEGRATION.md) | GitHub Actions, GitLab CI, Jenkins integration |
| [CLI.md](CLI.md) | kaseki-cli monitoring and analysis tool |

### Usage & Learning

| Document | Purpose |
|----------|---------|
| [EXAMPLES.md](EXAMPLES.md) | 10+ real-world scenarios with code |
| [INTEGRATION_EXAMPLE.md](INTEGRATION_EXAMPLE.md) | TypeScript client integration |

### Optimization & Cost

| Document | Purpose |
|----------|---------|
| [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) | Timeout, cache, allowlist optimization |
| [COST_ESTIMATION.md](COST_ESTIMATION.md) | Cost analysis and budgeting |

### Troubleshooting & Recovery

| Document | Purpose |
|----------|---------|
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Diagnosis flowcharts and fixes |
| [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) | Backup, failover, and incident recovery |

### Status & Metadata

| Document | Purpose |
|----------|---------|
| [repo-maturity.md](repo-maturity.md) | Production readiness assessment (96/100) |

---

## Recommended Reading Order

### First Time Users

```
1. GETTING_STARTED.md       (10 min)  — Install, quickstart, first task
2. EXAMPLES.md              (15 min)  — See what it does
3. AUTH_SETUP.md            (10 min)  — Set up GitHub App credentials (optional)
4. QUALITY_GATES.md         (10 min)  — Understand safety features
```

**Estimated total: 45 minutes** to get started

### Production Deployment

```
1. DEVELOPMENT.md           (15 min)  — Understand architecture
2. DEPLOYMENT.md            (30 min)  — Choose deployment method
3. AUTH_SETUP.md            (15 min)  — Secure credentials
4. DISTRIBUTED_SETUP.md     (20 min)  — Plan for HA/scale (if needed)
5. CI_CD_INTEGRATION.md     (20 min)  — Automate in CI/CD
6. DISASTER_RECOVERY.md     (20 min)  — Plan for failures
7. TROUBLESHOOTING.md       (15 min)  — Familiarize with diagnosis
```

**Estimated total: 2-3 hours** to deploy production-ready

### Optimization & Cost Management

```
1. PERFORMANCE_TUNING.md    (20 min)  — Understand tuning options
2. COST_ESTIMATION.md       (15 min)  — Estimate costs
3. ENV_VARS.md              (10 min)  — Review configuration
4. EXAMPLES.md              (20 min)  — See optimization patterns
```

**Estimated total: 1 hour** to optimize

---

## Search Tips

**Looking for...** → **Start here**

- How to get started → [GETTING_STARTED.md](GETTING_STARTED.md)
- Old setup guide → [SETUP_GUIDE.md](SETUP_GUIDE.md)
- How to deploy to production → [DEPLOYMENT.md](DEPLOYMENT.md)
- How to fix a failed run → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- How to reduce costs → [COST_ESTIMATION.md](COST_ESTIMATION.md)
- How to write better prompts → [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md)
- How to integrate with GitHub Actions → [CI_CD_INTEGRATION.md](CI_CD_INTEGRATION.md)
- How to set up multi-region → [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md)
- How to recover from disasters → [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)
- What does exit code X mean → [EXIT_CODES.md](EXIT_CODES.md)
- What environment variables do → [ENV_VARS.md](ENV_VARS.md)
- Real-world examples → [EXAMPLES.md](EXAMPLES.md)
- API monitoring → [CLI.md](CLI.md)
- Architecture details → [DEVELOPMENT.md](DEVELOPMENT.md)

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
| **Status & metadata** | 1 |
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

---

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
