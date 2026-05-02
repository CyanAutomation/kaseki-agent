# Docker Build Strategy for Kaseki Agent

## Overview

This document describes the Docker image build architecture for `kaseki-agent`, including the multi-stage build strategy, caching optimization, security hardening, and CI/CD pipeline design.

**Current Status**: Node v24, bookworm-slim, optimized multi-stage build with consolidated RUN layers.

---

## Multi-Stage Build Architecture

The Dockerfile uses a **two-stage build** pattern to optimize image size and build caching:

### Stage 1: `deps` (Dependencies)

- **Base**: `node:24-bookworm-slim`
- **Purpose**: Build Pi CLI agent and prepare workspace cache seed
- **Artifacts**:
  - Global Pi CLI installation (`@mariozechner/pi-coding-agent@0.70.2`)
  - Pre-built Node modules cache seed
- **Why separate**: Enables aggressive caching; these dependencies rarely change

### Stage 2: `runtime` (Application)

- **Base**: `node:24-bookworm-slim` (fresh base)
- **Purpose**: Build and package kaseki-agent application
- **Artifacts**:
  - Compiled TypeScript (dist/)
  - Installed binaries (/usr/local/bin/)
  - Entrypoint script
- **Why separate**: Isolates application code changes from dependency changes; allows deps stage to be cached independently

### Layer Consolidation

**Multiple RUN statements consolidated into fewer layers**:

- Deps setup: 5 RUN → 2 RUN (apt install + user setup in one layer)
- Runtime setup: 4 RUN → 1 RUN (all binary installation/chmod in single layer)
- **Benefit**: Reduces Docker layer count from 25+ to 19; faster build times and smaller final image

---

## Caching Strategy

### GitHub Actions Cache

**Current Configuration**:

```yaml
cache-from: type=gha,scope=${{ github.ref_name }}
cache-to: type=gha,scope=${{ github.ref_name }},mode=max
provenance: true
sbom: true
```

**How it works**:

1. Each branch maintains its own cache scope (e.g., `main`, `feature/branch`)
2. Buildx stores layer cache in GitHub Actions cache storage (~10GB per repo)
3. Subsequent builds on the same branch reuse layers (80-90% cache hit expected)
4. Provenance and SBOM are generated for supply chain visibility

### Expected Cache Hit Rates

| Scenario | Hit Rate | Why |
|----------|----------|-----|
| Same commit (rebuild) | ~100% | Identical layers |
| Same branch (new commit) | 80-90% | Most deps unchanged |
| Different branch (same base) | 40-50% | Shared base image layers, but branch-specific code |
| After base image update | <10% | Base image invalidates all downstream layers |

### Cache Invalidation Triggers

Cache is automatically invalidated when:

1. **Node base image changes** (monthly security updates planned)
2. **package-lock.json changes** (npm install layer)
3. **src/** changes (TypeScript compilation layer)
4. **GitHub branch is different** (cache scoped by branch)

### Cache Performance Baseline (May 2026)

From local testing with docker build:

- **Cold build** (no cache): ~30-35 seconds
  - Base image pull + layer extraction: ~5-10s
  - npm ci + npm run build: ~12-15s
  - Binary installation: ~2-3s
- **Warm build** (cached layers): ~5-8 seconds
  - Cache hit on all deps/node_modules layers
  - Only TypeScript recompile if src/ changed

---

## Security Hardening

### Container Runtime Security

**Read-only filesystem**:

```bash
docker run --read-only --tmpfs /tmp:rw,nosuid,nodev,size=256m ...
```

- Application cannot modify container filesystem
- Only /tmp is writable (limited to 256MB, with security restrictions)

**Capability dropping**:

```bash
--cap-drop ALL
```

- Removes all Linux capabilities (no network, process, filesystem privileges)
- Kaseki agent runs with minimal privilege surface

**Non-root user**:

```dockerfile
USER kaseki  # UID 10001
```

- Application runs as unprivileged user (not root)
- Prevents privilege escalation if exploit occurs

### Base Image Security

**Node.js base image** (`node:24-bookworm-slim`):

- Regular security updates (monthly planned)
- Debian bookworm-slim: minimal base (excludes build tools, docs)
- See [SECURITY.md](../SECURITY.md) for vulnerability response procedures

**Pi CLI Agent Security**:

- Pinned to specific version (0.70.2) to ensure reproducible builds
- Pre-installed globally in deps stage (immutable in runtime stage)
- Telemetry disabled (`PI_TELEMETRY=0`)

---

## Build Performance Optimization

### Dockerfile Optimization Checklist

✅ **Consolidated RUN commands**: Multiple apt/user/chmod operations merged into single layers
✅ **Optimal COPY placement**: Source files copied last (after dependencies) to maximize cache hits
✅ **Minimal build context**: `.dockerignore` uses allowlist approach (only explicit files included)
✅ **Dependency caching**: Pi CLI and npm modules pre-cached in deps stage

### Workspace Dependency Cache

A separate cache seeding mechanism (`docker/workspace-cache/`) pre-builds node_modules for fast runtime:

- Kaski container instances use cached dependencies to avoid repeated npm install
- See [DEVELOPMENT.md](DEVELOPMENT.md) for kaseki-agent.sh dependency caching strategy
- Expected time savings: 20-30 seconds per kaseki run when cache is warm

### CI/CD Pipeline Optimization (May 2026)

**Job Parallelization**:

```
type_check_changed (blocking)
    ↓
[checks, type_check_full] (parallel, ~2 min savings)
    ↓
build (multi-arch amd64 + arm64)
    ↓
[scan, verify] (parallel)
```

**Expected workflow duration**:

- Before optimization: ~18-22 minutes
- After optimization: ~15-18 minutes (2-4 min savings)
- Cache hit reduces build time: -8-10 seconds per amd64 build

---

## Base Image Management

### Node v24 Decision

**When updated**: May 2026
**Why Node v24**:

- Stable LTS release with long support window
- Performance improvements over Node 22
- Full npm v10+ compatibility

### Monthly Security Review Process

1. **Check Node.js security advisories** (<https://nodejs.org/en/security>)
2. **Review base image CVEs** (bookworm-slim, Debian security)
3. **Test locally**:

   ```bash
   docker build -t kaseki-agent:test .
   docker run --rm kaseki-agent:test node --version
   docker run --rm kaseki-agent:test pi --version
   ```

4. **Update Dockerfile** with new pinned base image (if security patches available)
5. **Trigger full CI pipeline** (workflow_dispatch)
6. **Document in CLAUDE.md** and git commit message

### Node Version Upgrade Path

For future Node version upgrades:

| From | To | Risk | Action |
|------|----|----|--------|
| 24 → 24.x | Low | Patch update; keep same tag | Direct update |
| 24 → 24.next | Medium | Minor version; test thoroughly | Test locally, then update |
| 24 → 26 | High | Major version; breaking changes possible | Full regression test suite |

---

## Troubleshooting Build Issues

### Cache Miss on CI/CD

**Symptom**: Build takes much longer than expected (~30s instead of ~10s)

**Diagnosis**:

1. Check GitHub Actions cache: Settings → Actions → Caches
2. Look for scope matching `${{ github.ref_name }}` (e.g., `main`, `feature/xyz`)

**Solutions**:

- New branch: First build always cold; subsequent builds use cache
- CI cache eviction: GitHub removes cache after 7 days of no access
- Large PR: Different base can cause cache misses; merge main first

### Build Failure After Base Image Update

**Symptom**: Docker build fails on package installation or system dependency

**Diagnosis**:

```bash
docker build -t kaseki-agent:test . 2>&1 | grep -A5 "E:"
```

**Solutions**:

- Check Dockerfile apt-get line for typos
- Test locally with new base image before committing
- Verify bookworm-slim package availability (use `apt-cache search`)

### Multi-arch Build Failure

**Symptom**: amd64 builds succeed, but arm64 fails with QEMU error

**Diagnosis**:

- QEMU emulation issues (rare on GitHub runners)
- Incompatible binary or architecture-specific code

**Solutions**:

- Retry workflow (transient QEMU issue)
- Use `docker run --platform linux/arm64 --rm <image>` to test locally (slow)
- Fallback to amd64-only builds temporarily

---

## Vulnerability Scanning

### Trivy Scanning Integration

**Three-scan strategy**:

1. **HIGH/CRITICAL only** → GitHub Security tab
   - File: `trivy-results.sarif`
   - Frequency: Every build
   - Action: Block merge if HIGH/CRITICAL found

2. **All severities** → Artifact storage
   - File: `trivy-results-all.json`
   - Retention: 30 days
   - Purpose: Audit trail, trend analysis

3. **SBOM generation** → Artifact storage
   - File: `sbom-spdx.json` (SPDX JSON format)
   - Retention: 30 days
   - Purpose: Supply chain compliance, license tracking

### Known Vulnerabilities

Check GitHub → Settings → Code security → Dependabot alerts for any discovered CVEs.

**Typical sources** (transitive dependencies):

- Pi CLI dependencies (usually addressed via version updates)
- Node.js base image vulnerabilities (patched monthly)

**Response procedure**: See [SECURITY.md](../SECURITY.md)

---

## Build Artifacts & Outputs

### What's Inside the Image

**Binaries** (in `/usr/local/bin`):

- `kaseki-agent` — Main entry point
- `pi` — Pi CLI coding agent
- `kaseki-report` — Result analysis tool
- `kaseki-pi-event-filter` — Event stream processor
- `kaseki-pi-progress-stream` — Progress tracking
- `github-app-token` — Token generation utility

**Libraries** (in `/app/lib`):

- Compiled TypeScript modules from `src/`
- Pi CLI node_modules (from deps stage)

**Working directories**:

- `/workspace` — Where kaseki-agent clones target repo
- `/results` — Where kaseki-agent writes artifacts (mounted at runtime)
- `/tmp/kaseki-home` — kaseki user home (transient)
- `/tmp/npm-cache` — npm cache (transient)

### Build Outputs

**GitHub Container Registry** (GHCR):

```
ghcr.io/cyanautomation/kaseki-agent:latest
ghcr.io/cyanautomation/kaseki-agent:latest-arm64
ghcr.io/cyanautomation/kaseki-agent:v0.1.0
```

**Docker Hub**:

```
cyanautomation/kaseki-agent:latest
cyanautomation/kaseki-agent:latest-arm64
cyanautomation/kaseki-agent:v0.1.0
```

---

## Development Workflow

### Local Docker Builds

```bash
# Standard build
docker build -t kaseki-agent:dev .

# No cache (force rebuild)
docker build --no-cache -t kaseki-agent:dev .

# Build specific stage for debugging
docker build --target deps -t kaseki-agent:deps-debug .

# Inspect built image
docker inspect kaseki-agent:dev
docker run --rm kaseki-agent:dev node --version
```

### Simulating GHA Build Locally

```bash
# Multi-arch build (requires buildx)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t kaseki-agent:multiarch .
```

---

## References

- [CLAUDE.md](../CLAUDE.md) — Project overview and running kaseki-agent
- [SECURITY.md](../SECURITY.md) — Vulnerability response procedures
- [.github/skills/docker-image-management/SKILL.md](../.github/skills/docker-image-management/SKILL.md) — When/how to update base image
- [.github/workflows/build-docker-image.yml](../.github/workflows/build-docker-image.yml) — Full CI/CD pipeline

---

## Maintenance Calendar

| Task | Frequency | Owner | Notes |
|------|-----------|-------|-------|
| Security review (base image, Pi CLI) | Monthly | Maintainer | Check CVE lists, security advisories |
| Node version patch update | As needed | Maintainer | Minor version bumps (24.x.x) |
| Cache performance monitoring | Quarterly | DevOps | Check cache hit rates in GHA |
| SBOM review & license check | Quarterly | Compliance | Ensure no license violations |
| Multi-arch build validation | Per release | CI/CD | Verify both amd64 + arm64 work |

---

**Last Updated**: May 2026  
**Node Version**: v24  
**Base Image**: node:24-bookworm-slim  
**Build Status**: ✅ Optimized
