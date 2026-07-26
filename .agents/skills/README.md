# Kaseki Agent Skills Index

This directory contains specialized domain knowledge skills for kaseki-agent operations, troubleshooting, and optimization.

## Quick Navigation

- [All Skills by Domain](#skills-by-domain)
- [Decision Tree: Which Skill Do I Need?](#decision-tree-which-skill-do-i-need)
- [Skill Interconnections](#skill-interconnections)
- [Skill Metadata Reference](#skill-metadata-reference)

---

## Skills by Domain

### 🔧 Troubleshooting & Diagnosis

| Skill | Description | Trigger Keywords |
| --- | --- | --- |
| **[workflow-diagnosis](workflow-diagnosis/SKILL.md)** | Diagnosing kaseki run failures and interpreting artifacts | failure diagnosis, exit codes, troubleshooting, debug kaseki run |
| **[result-report-analysis](result-report-analysis/SKILL.md)** | Interpreting kaseki-report output and artifact metrics | kaseki-report, metrics, timings, performance baselines |

### ⚙️ Configuration & Setup

| Skill | Description | Trigger Keywords |
| --- | --- | --- |
| **[environment-configuration](environment-configuration/SKILL.md)** | Complete reference for configuring kaseki-agent via environment variables | env vars, configuration, settings, API key setup |
| **[quality-gate-config](quality-gate-config/SKILL.md)** | Defining and validating quality gates for kaseki runs | allowlist, diff size limits, file restrictions, quality gates |
| **[prompt-engineering](prompt-engineering/SKILL.md)** | Composing, testing, and validating TASK_PROMPT for agent runs | task prompt, prompt design, security review, prompt testing |

### 🚀 Deployment & Operations

| Skill | Description | Trigger Keywords |
| --- | --- | --- |
| **[docker-image-management](docker-image-management/SKILL.md)** | Managing base images, Pi CLI versions, and multi-arch builds | Docker image, Node.js version, Pi CLI upgrade, multi-arch builds |
| **[distributed-deployment](distributed-deployment/SKILL.md)** | Deploying kaseki-agent across multiple hosts, regions, and cloud platforms | Kubernetes, multi-region, distributed deployment, load balancing |
| **[disaster-recovery](disaster-recovery/SKILL.md)** | Backup, recovery, and incident response for production deployments | backup, restore, incident response, failover |

### 📊 Performance & Cost

| Skill | Description | Trigger Keywords |
| --- | --- | --- |
| **[performance-tuning](performance-tuning/SKILL.md)** | Optimization strategies for execution speed, cost, and resource usage | performance optimization, timeout tuning, resource usage |
| **[cost-optimization](cost-optimization/SKILL.md)** | Token usage, budgeting, and cost analysis for deployments | cost analysis, token usage, budget, pricing |
| **[dependency-cache-optimization](dependency-cache-optimization/SKILL.md)** | Understanding and optimizing the 4-layer npm dependency caching strategy | npm caching, dependency optimization, build speed |

### 🔄 CI/CD & Integration

| Skill | Description | Trigger Keywords |
| --- | --- | --- |
| **[ci-cd-integration](ci-cd-integration/SKILL.md)** | Integrating kaseki-agent into CI/CD platforms for automated code changes | GitHub Actions, GitLab CI, Jenkins, pipeline integration |
| **[test-automation](test-automation/SKILL.md)** | Testing kaseki-agent behavior changes and adding new test coverage | unit tests, integration tests, vitest, test patterns |

### 🛠️ Code Analysis & Design

| Skill | Description | Trigger Keywords |
| --- | --- | --- |
| **[fallow](fallow/SKILL.md)** | Codebase intelligence for JavaScript/TypeScript (dead code, duplication, complexity) | code health, unused code, circular dependencies, code duplication, complexity |
| **[frontend-design](frontend-design/SKILL.md)** | Huashu-Design system for prototypes, animations, and interactive demos | HTML prototypes, design variations, animations, UI mockups, design direction |

---

## Decision Tree: Which Skill Do I Need?

### 🚨 I Have a Problem

```
My kaseki run failed
└─> Start with: workflow-diagnosis
    └─> Failed validation? → test-automation
    └─> Allowlist violation? → quality-gate-config
    └─> Empty diff? → prompt-engineering
    └─> Timeout? → performance-tuning or dependency-cache-optimization
    └─> Provider error (exit 88)? → environment-configuration

My kaseki run is too slow
└─> Start with: performance-tuning
    └─> npm ci is slow? → dependency-cache-optimization
    └─> Validation is slow? → test-automation

My kaseki runs are too expensive
└─> Start with: cost-optimization
    └─> Need to reduce token usage? → prompt-engineering
    └─> Need to optimize model selection? → environment-configuration

My deployment/infrastructure has issues
└─> Start with: distributed-deployment or disaster-recovery
    └─> Docker image issues? → docker-image-management
    └─> CI/CD pipeline issues? → ci-cd-integration
```

### 🎯 I Want to Set Up Something

```
Setting up kaseki-agent for the first time
└─> Start with: environment-configuration
    └─> Also review: quality-gate-config, prompt-engineering

Integrating into CI/CD pipeline
└─> Start with: ci-cd-integration
    └─> Also review: quality-gate-config, cost-optimization

Deploying to production
└─> Start with: distributed-deployment
    └─> Also review: disaster-recovery, docker-image-management

Writing a new task prompt
└─> Start with: prompt-engineering
    └─> Also review: quality-gate-config, cost-optimization
```

### 📈 I Want to Improve Performance/Cost

```
Optimize execution speed
└─> Start with: performance-tuning
    └─> npm/build is slow? → dependency-cache-optimization
    └─> Validation is slow? → test-automation
    └─> Agent times out? → prompt-engineering

Reduce costs
└─> Start with: cost-optimization
    └─> Model selection? → environment-configuration
    └─> Token usage? → prompt-engineering

Analyze code quality
└─> Start with: fallow
```

### 🔍 I Need to Understand Something

```
Interpreting run results
└─> Start with: result-report-analysis
    └─> Failure diagnosis? → workflow-diagnosis

Understanding configuration options
└─> Start with: environment-configuration
    └─> Quality gates? → quality-gate-config

Understanding how caching works
└─> Start with: dependency-cache-optimization
```

---

## Skill Interconnections

The skills form a knowledge graph with cross-references. Central "hub" skills that connect to many others:

### Hub Skills (High Connectivity)

**workflow-diagnosis** (connects to 10 skills)

- Primary troubleshooting entry point
- References: prompt-engineering, quality-gate-config, test-automation, docker-image-management, dependency-cache-optimization, result-report-analysis, ci-cd-integration, distributed-deployment, disaster-recovery, environment-configuration

**environment-configuration** (connects to 7 skills)

- Central configuration reference
- References: cost-optimization, performance-tuning, docker-image-management, distributed-deployment, ci-cd-integration, quality-gate-config, disaster-recovery

### Skill Clusters

**Quality & Validation Cluster**:

- quality-gate-config ↔ prompt-engineering
- quality-gate-config ↔ workflow-diagnosis
- quality-gate-config ↔ performance-tuning
- quality-gate-config ↔ environment-configuration

**Performance Cluster**:

- performance-tuning ↔ cost-optimization
- performance-tuning ↔ dependency-cache-optimization
- performance-tuning ↔ environment-configuration

**Deployment Cluster**:

- distributed-deployment ↔ disaster-recovery
- distributed-deployment ↔ docker-image-management
- distributed-deployment ↔ environment-configuration

**Testing Cluster**:

- test-automation ↔ workflow-diagnosis
- test-automation ↔ docker-image-management

---

## Skill Metadata Reference

Each skill follows a consistent YAML frontmatter structure:

```yaml
---
name: skill-name                    # Matches directory name
description: One-line description   # Concise purpose statement
tags: [tag1, tag2, ...]            # Categorization (kaseki, domain, tech)
relatedSkills: [skill1, skill2]    # Cross-references to other skills
---
```

### Standard Tags

| Tag | Used By | Purpose |
| --- | --- | --- |
| `kaseki` | All internal skills | Core kaseki-agent functionality |
| `troubleshooting` | workflow-diagnosis | Diagnostic and debugging |
| `configuration` | environment-configuration, quality-gate-config | Setup and config |
| `deployment` | docker-image-management, distributed-deployment, disaster-recovery | Operations and deployment |
| `optimization` | performance-tuning, cost-optimization, dependency-cache-optimization | Performance and cost |
| `testing` | test-automation | Quality assurance |
| `ci-cd` | ci-cd-integration, docker-image-management | Continuous integration |

### External Skills

Two skills have extended metadata indicating external origin:

- **fallow**: MIT-licensed tool by Bart Waardenburg (v1.0.0)
- **frontend-design**: Huashu-Design system for HTML prototyping

These skills include additional frontmatter fields:

```yaml
license: MIT
metadata:
  author: ...
  version: ...
  homepage: ...
```

---

## Usage

### For Humans

Browse skills by domain or use the decision tree to find the right skill for your task. Each skill contains:

- **Overview**: When to use, key concepts
- **Detailed Content**: Step-by-step guidance, examples, commands
- **Related Skills**: Cross-references to complementary topics
- **Examples**: Runnable code snippets, config templates

### For AI Agents

Skills are automatically loaded via the CLAUDE.md skill registry. When a user request matches trigger keywords or domain patterns, the agent reads the corresponding SKILL.md file for domain-specific guidance.

**Trigger Mechanism**: Keywords in user requests are matched against skill names, descriptions, and tags. The agent then reads the full skill content to answer the question or perform the task.

**Cross-Reference Navigation**: When a skill references another skill (via `relatedSkills` field or inline links), the agent can follow these references to gather comprehensive context.

---

## Maintenance

### Adding a New Skill

1. Create directory: `.agents/skills/<skill-name>/`
2. Create SKILL.md with standard frontmatter
3. Add related skills to connect it to the knowledge graph
4. Update this README.md to list the new skill in the appropriate domain
5. Update CLAUDE.md skill registry if needed

### Updating Cross-References

All `relatedSkills` entries should be reciprocal (if A lists B, B should list A). Use this command to audit cross-references:

```bash
grep -r "relatedSkills:" .agents/skills/*/SKILL.md
```

### Validation Checklist

- [ ] YAML frontmatter is valid
- [ ] All `relatedSkills` entries point to existing skills
- [ ] Skill name in frontmatter matches directory name
- [ ] Skill is listed in this README.md
- [ ] Examples use correct file paths relative to workspace
- [ ] No external URLs (except standard registries: npm, docker.io, GitHub)

---

## Summary Statistics

| Metric | Value |
| --- | --- |
| **Total Skills** | 15 |
| **Internal Skills** | 13 |
| **External Skills** | 2 (fallow, frontend-design) |
| **Average Cross-References** | 4-5 per skill |
| **Hub Skills** | 2 (workflow-diagnosis, environment-configuration) |
| **Skill Clusters** | 4 (Quality, Performance, Deployment, Testing) |

---

**Last Updated**: 2026-07-26  
**Skill Schema Version**: 1.0
