# Documentation Index

**Comprehensive guide to kaseki‑agent**

## Quick Start
- **GETTING_STARTED.md** – Install, run quickstart, submit first task (≈45 min)
- **EXAMPLES.md** – Real‑world scenarios (≈15 min)

## Core Concepts
| Document | Focus |
|----------|-------|
| DEVELOPMENT.md | Architecture, API service |
| EXIT_CODES.md | Exit‑code semantics |
| QUALITY_GATES.md | Validation, allowlists |
| TASK_PROMPT_TEMPLATES.md | Prompt design |
| GOAL_SETTING_GUIDE.md | Goal‑setting phase |
| AUTH_SETUP.md | GitHub App credentials |

## Setup & Installation
| Document | Focus |
|----------|-------|
| NPM_SETUP.md | npm installation |
| DOCKER_SETUP.md | Docker & Compose |
| DEPLOYMENT.md | Production deployment |

## Operations & Deployment
| Document | Focus |
|----------|-------|
| DISTRIBUTED_SETUP.md | Multi‑host, Kubernetes |
| CI_CD_INTEGRATION.md | CI workflows (GitHub, GitLab, Jenkins) |
| CLI.md | kaseki‑cli monitoring |

## Optimization & Cost
| Document | Focus |
|----------|-------|
| PERFORMANCE_TUNING.md | Timeouts, cache, allowlist tuning |
| COST_ESTIMATION.md | Cost analysis, budgeting |
| ENV_VARS.md | Environment variable reference |

## Troubleshooting & Support
| Document | Focus |
|----------|-------|
| TROUBLESHOOTING.md | Common failures, fixes |
| DISASTER_RECOVERY.md | Backup and recovery |

## Use Cases
- **Bug fix**: GETTING_STARTED → EXAMPLES → TASK_PROMPT_TEMPLATES → QUALITY_GATES → TROUBLESHOOTING
- **Team deployment**: DEPLOYMENT → AUTH_SETUP → DISTRIBUTED_SETUP → CI_CD_INTEGRATION → DISASTER_RECOVERY
- **CI/CD automation**: CI_CD_INTEGRATION → DEPLOYMENT → EXAMPLES → TROUBLESHOOTING
- **Cost & performance**: PERFORMANCE_TUNING → COST_ESTIMATION → ENV_VARS → EXAMPLES
- **Run failure**: TROUBLESHOOTING → EXIT_CODES → CLI → DISASTER_RECOVERY
- **Scale across regions**: DISTRIBUTED_SETUP → DEPLOYMENT → DISASTER_RECOVERY → PERFORMANCE_TUNING

## Recommended Reading Order
### First‑time users
1. GETTING_STARTED.md – install, quickstart, first task
2. EXAMPLES.md – overview of capabilities
3. AUTH_SETUP.md – configure GitHub App
4. QUALITY_GATES.md – safety controls

### Production deployment
1. DEVELOPMENT.md – architecture overview
2. DEPLOYMENT.md – choose deployment method
3. AUTH_SETUP.md – secure credentials
4. DISTRIBUTED_SETUP.md – HA/scale planning
5. CI_CD_INTEGRATION.md – automate pipelines
6. DISASTER_RECOVERY.md – failure mitigation
7. TROUBLESHOOTING.md – familiarise with diagnostics

### Optimization & cost management
1. PERFORMANCE_TUNING.md – tuning options
2. COST_ESTIMATION.md – cost modelling
3. ENV_VARS.md – configuration details
4. EXAMPLES.md – optimisation patterns

## Search Tips
| Need | Document |
|------|----------|
| Get started | GETTING_STARTED.md |
| Old setup guide | SETUP_GUIDE.md |
| Deploy production | DEPLOYMENT.md |
| Fix failed run | TROUBLESHOOTING.md |
| Reduce costs | COST_ESTIMATION.md |
| Write better prompts | TASK_PROMPT_TEMPLATES.md |
| CI integration | CI_CD_INTEGRATION.md |
| Multi‑region setup | DISTRIBUTED_SETUP.md |
| Disaster recovery | DISASTER_RECOVERY.md |
| Exit code X | EXIT_CODES.md |
| Environment vars | ENV_VARS.md |
| Real examples | EXAMPLES.md |
| API monitoring | CLI.md |
| Architecture details | DEVELOPMENT.md |

## Documentation Statistics
| Metric | Value |
|--------|-------|
| Documents | 22 |
| Setup guides | 4 |
| Concept refs | 5 |
| Deployment ops | 4 |
| Usage examples | 2 |
| Optimization | 2 |
| Troubleshooting | 2 |
| Pages total | ~200 |
| Examples total | 30+ |

## Contributing
1. Identify missing or outdated sections
2. Submit PR with improvements
3. Ensure examples compile and run
4. Update INDEX.md for new documents

**Maintenance**: Quarterly review for accuracy.

## Last Updated
May 2026

## See Also
| Document | Purpose |
|----------|---------|
| README.md | Project overview |
| CLAUDE.md | AI coding agent guidance |
| CHANGELOG.md | Release notes |

## Internal / Developer Docs
| Document | Purpose |
|----------|---------|
| internal/DEVELOPMENT.md | Architecture, coding conventions |
| internal/BUILD_STRATEGY.md | Build pipeline, CI/CD |
| internal/BACKLOG.md | Planned improvements |
| internal/IMPLEMENTATION_SUMMARY.md | Phase completion notes |
| internal/DUPLICATION_AUDIT.md | Code‑quality audit |
| internal/PHASE1_COMPLETION.md | Phase 1 notes |
| internal/PHASE2_COMPLETION.md | Phase 2 notes |
| internal/PHASE6_MIGRATION.md | Phase 6 migration |
