---
name: dependency-cache-optimization
description: Diagnose and tune Kaseki worker dependency caches across supported package managers.
tags: [kaseki, caching, performance, dependencies, optimization]
relatedSkills: [docker-image-management, workflow-diagnosis, performance-tuning, cost-optimization]
---

# Dependency Cache Optimization for Kaseki Agent

Use this skill when dependency preparation is a measured source of delay or a
cache restore fails. The worker supports the package managers recognized by
`scripts/package-manager.cjs`; do not assume every run uses npm.

## Cache path

The worker checks these sources in order:

1. Existing repository `node_modules` with a matching stamp and valid dependency
   graph.
2. A validated workspace cache entry.
3. A validated image seed entry.
4. A fresh install using the target repository's package manager.

The cache key includes dependency inputs and install flags, along with the
relevant package-manager/runtime platform details. Repository and ref metadata
are recorded with the cache entry. A matching lockfile alone does not establish
that a restored tree is valid; the worker checks the graph and required command
links and falls back to an install when checks fail.

## Diagnose before changing configuration

Inspect the run's `dependency-cache.log`, `cache-metrics.json`, and stage timing
artifacts under the configured `KASEKI_RESULTS_DIR`. Look for the recorded
cache source, restore method, dependency input hash, and install duration.

- A repository hit means dependency preparation was skipped after validation.
- A workspace or image hit means a cached tree was restored and checked.
- A fresh install can result from a new dependency input, package-manager or
  runtime change, missing/invalid cache entry, or cache restore failure.
- Compare runs with the same repository, ref, package manager, lockfile, and
  worker image before attributing a timing change to the cache.

## Tuning

- Configure `KASEKI_DEPENDENCY_CACHE_DIR` to a writable persistent volume when
  reuse across workers is intended. Use the deployment's documented mount path;
  host and container paths are different values.
- Use `KASEKI_DEPENDENCY_CACHE_MAX_BYTES`,
  `KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS`, and
  `KASEKI_DEPENDENCY_CACHE_PRUNE` for supported retention behavior. See the
  [environment reference](../../../docs/ENV_VARS.md) for defaults.
- Use a fresh temporary cache directory to compare a cold run with a warm run.
  Avoid clearing broad host directories or pruning unrelated Docker images.
- Image seed changes belong in the pinned image workflow. Follow
  [Docker Image Management](../docker-image-management/SKILL.md) and preserve
  the package-manager lockfile and cache validation markers.
- Do not claim fixed time savings. Measure several comparable runs and include
  package manager, cache source, and worker image in the comparison.

## Implementation references

- [Dependency cache helpers](../../../scripts/dependency-cache-helpers.sh)
- [Package manager resolver](../../../scripts/package-manager.cjs)
- [Worker cache implementation](../../../kaseki-agent.sh)
- [Performance guide](../../../docs/PERFORMANCE_TUNING.md)
