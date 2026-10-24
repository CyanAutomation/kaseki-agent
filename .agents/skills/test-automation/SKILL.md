---
name: test-automation
description: Add and run focused regression coverage for Kaseki behavior changes.
tags: [kaseki, testing, qa, automation, jest, shell]
relatedSkills: [workflow-diagnosis, docker-image-management]
---

# Test Automation for Kaseki Agent

Use this skill when changing Kaseki behavior or adding regression coverage. Use
the repository's existing test harnesses and keep each check close to the
behavior it protects.

## Test locations

- TypeScript and JavaScript unit tests are colocated with source or live in
  `src/`, `scripts/`, `test/`, and `tests/`; Jest is the unit-test runner.
- Shell contract tests live mainly in `tests/` and `test/` and run with Bash.
- Docker integration tests are under `tests/integration/docker/` and require a
  working Docker daemon.
- Workflow and documentation contracts have dedicated checks in `tests/` and
  `scripts/`.

Follow nearby tests for fixture setup, command stubbing, and cleanup. Prefer a
small regression test that demonstrates the bug before changing implementation.
Cover both the expected result and the relevant failure or boundary case. Avoid
inventing test helpers or paths; inspect the current suite first.

## Focused commands

Use Node.js 24 or later. Install the locked dependencies with `npm ci`.

```bash
# TypeScript/JavaScript unit suite (builds first)
npm test

# One Jest test file
npx jest src/path/to/feature.test.ts --runInBand

# One shell contract test
bash tests/path-to-contract.test.sh

# Type checking, linting, and Markdown links
npm run check

# Workflow contracts and publishing checks
npm run test:workflows

# Docker-backed integration suite
npm run test:integration:docker
```

The full CI test sequence is `npm run test:ci`. It is broad and includes
multiple shell contracts; use focused commands during iteration and run the
relevant wider checks before completing a change.

## TDD workflow

1. Add a focused test for the intended behavior or regression.
2. Run it and confirm it fails for the expected reason.
3. Make the smallest implementation change that satisfies it.
4. Rerun the focused test, then related checks from the package scripts.
5. Review the diff for test fixtures, generated files, and accidental scope
   changes.

Do not weaken validation or remove a regression test merely to make a check
pass. When a check is environment-dependent, report the dependency and result.

## CI conventions

The pull-request workflow is [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml).
It uses Node.js 24, pinned GitHub Actions, shell linting, Markdown-link checks,
workflow checks, the repository test sequence, and Docker artifact validation.
Update the workflow contract tests when changing those expectations.

See [Contributing](../../../CONTRIBUTING.md),
[Development](../../../docs/DEVELOPMENT.md), and
[Docker Image Management](../docker-image-management/SKILL.md) for related
conventions.
