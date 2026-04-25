---
name: Kaseki Agent Skills Index
description: Complete guide to all skills for working with kaseki-agent
tags: [kaseki, skills, reference]
---

# Kaseki Agent Skills

This directory contains specialized skills for working with **kaseki-agent**, an ephemeral coding-agent runner for isolated, validated code changes. Each skill is designed for specific workflows and use cases.

## Quick Navigation

| Skill | Purpose | Best For |
|---|---|---|
| [Prompt Engineering](#prompt-engineering) | Composing and validating task prompts | Designing agent tasks, testing prompts, security review |
| [Workflow Diagnosis](#workflow-diagnosis) | Diagnosing failures in kaseki runs | Troubleshooting failed runs, root-cause analysis, optimization |
| [Test Automation](#test-automation) | Testing kaseki behavior changes | Adding/updating tests, validating changes, CI/CD setup |
| [Docker Image Management](#docker-image-management) | Base image and Pi CLI updates | Image maintenance, version updates, multi-arch builds |
| [Quality Gate Configuration](#quality-gate-configuration) | Defining and validating quality gates | Designing allowlists, setting diff limits, security gates |
| [Dependency Cache Optimization](#dependency-cache-optimization) | Optimizing npm dependency caching | Cache strategy, performance tuning, troubleshooting misses |
| [Result Report Analysis](#result-report-analysis) | Interpreting kaseki run artifacts | Metrics analysis, performance baselines, anomaly detection |

---

## **Prompt Engineering**

**Slug**: `prompt-engineering.md`  
**Purpose**: Guide composing, testing, and validating `TASK_PROMPT` changes  

**Key Content**:
- Task prompt structure and best practices
- Security guardrails checklist
- Common pitfalls and how to avoid them
- Example prompts (redacted)
- Dry-run validation workflow

**Use When**:
- Designing a new agent task (code fix, refactor, feature)
- Testing prompt clarity or constraints
- Security-reviewing task prompts before running
- Validating prompt results in pi-summary.json

**Cross-References**: [Quality Gate Configuration](#quality-gate-configuration), [Workflow Diagnosis](#workflow-diagnosis)

---

## **Workflow Diagnosis**

**Slug**: `workflow-diagnosis.md`  
**Purpose**: Parse kaseki-run artifacts and pinpoint failure root causes  

**Key Content**:
- Artifact inspection order (metadata.json → logs → diffs)
- Exit code to actionable fix mapping
- Decision trees for common failures
- Log parsing and anomaly detection
- kaseki-report interpretation

**Use When**:
- A kaseki run failed and you need to understand why
- Optimizing kaseki configuration (timeouts, allowlists)
- Analyzing performance bottlenecks
- Extracting timing and resource metrics

**Cross-References**: All other skills (failure paths point to relevant skill)

---

## **Test Automation**

**Slug**: `test-automation.md`  
**Purpose**: Add/update tests when kaseki-agent behavior changes  

**Key Content**:
- Test structure (unit vs. integration)
- Test locations and running tests locally
- Coverage expectations for new features
- Mocking strategies (Docker, Pi CLI)
- CI/CD integration and blockers

**Use When**:
- Adding a new feature to kaseki-agent
- Changing behavior of existing scripts
- Security or caching logic changes
- Pre-PR validation and coverage review

**Cross-References**: [Workflow Diagnosis](#workflow-diagnosis)

---

## **Docker Image Management**

**Slug**: `docker-image-management.md`  
**Purpose**: Manage base image updates, Pi CLI versions, multi-arch builds  

**Key Content**:
- Base image (Node 22.22.2) updates and security
- Pi CLI versioning and compatibility matrix
- Multi-arch builds with QEMU and buildx
- Dockerfile structure and cache busting
- Smoke tests in GitHub Actions

**Use When**:
- Updating the Node.js base image
- Upgrading Pi CLI to a new version
- Investigating multi-arch build failures
- Troubleshooting image caching issues

**Cross-References**: [Test Automation](#test-automation), [Dependency Cache Optimization](#dependency-cache-optimization)

---

## **Quality Gate Configuration**

**Slug**: `quality-gate-config.md`  
**Purpose**: Define and validate quality gates for kaseki runs  

**Key Content**:
- Allowlist pattern syntax and examples
- Max diff size heuristic and recommendations
- Validation command chaining and timeout tuning
- Security gates and credential pattern rules
- Real-world allowlist examples (redacted)

**Use When**:
- Designing quality gates for a new task
- Troubleshooting allowlist violations
- Tuning diff size limits
- Reviewing security constraints

**Cross-References**: [Prompt Engineering](#prompt-engineering), [Workflow Diagnosis](#workflow-diagnosis)

---

## **Dependency Cache Optimization**

**Slug**: `dependency-cache-optimization.md`  
**Purpose**: Understand and optimize the 4-layer npm cache strategy  

**Key Content**:
- 4-layer cache explained (stamp → workspace → seed → fresh)
- Stamp file format and hash computation
- Cache busting scenarios and invalidation
- Workspace and image seed cache layouts
- Performance metrics and typical hit rates

**Use When**:
- Diagnosing slow npm installs
- Understanding cache misses
- Tuning cache layer strategy
- Optimizing image builds

**Cross-References**: [Docker Image Management](#docker-image-management), [Workflow Diagnosis](#workflow-diagnosis)

---

## **Result Report Analysis**

**Slug**: `result-report-analysis.md`  
**Purpose**: Interpret kaseki-report output and extract actionable metrics  

**Key Content**:
- Artifact overview and structure
- Report metrics (timing, file counts, diff stats)
- Pi summary analysis (tokens, events, thinking blocks)
- Performance baselines and typical durations
- Anomaly detection and outlier analysis

**Use When**:
- Post-run analysis and performance review
- Comparing runs or baselines
- Detecting resource anomalies
- Extracting metrics for dashboards

**Cross-References**: [Workflow Diagnosis](#workflow-diagnosis)

---

## Reading Recommendations

**First Time with Kaseki?**
1. Read [CLAUDE.md](../../CLAUDE.md) (architecture, commands, defaults)
2. Read [Prompt Engineering](#prompt-engineering) (design your first task)
3. Skim [Quality Gate Configuration](#quality-gate-configuration) (understand constraints)

**Troubleshooting a Failed Run?**
1. Start with [Workflow Diagnosis](#workflow-diagnosis) (root-cause mapping)
2. Jump to the relevant skill based on failure type
3. Use [Result Report Analysis](#result-report-analysis) for metric interpretation

**Maintaining Kaseki?**
1. Review [Docker Image Management](#docker-image-management) (monthly base image check)
2. Reference [Dependency Cache Optimization](#dependency-cache-optimization) (cache tuning)
3. Use [Test Automation](#test-automation) (feature/change validation)

---

## Related Documentation

- [CLAUDE.md](../../CLAUDE.md) — Complete architecture guide (required reading)
- [README.md](../../README.md) — Quick-start and basic commands
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — Contribution guidelines and validation
- [Dockerfile](../../Dockerfile) — Base image, Pi CLI version, build stages
- [run-kaseki.sh](../../run-kaseki.sh) — Host-layer environment variables and defaults
- [kaseki-agent.sh](../../kaseki-agent.sh) — Container-layer behavior and cache strategy
- [kaseki-report.js](../../kaseki-report.js) — Report generation logic
- [pi-event-filter.js](../../pi-event-filter.js) — Pi event and summary filtering

---

**Last Updated**: April 2026  
**Kaseki Version**: 0.1.0  
**Node Version**: 22.22.2  
**Pi CLI Version**: 0.70.2
