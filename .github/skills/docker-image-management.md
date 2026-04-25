---
name: Docker Image Management
description: Managing base images, Pi CLI versions, and multi-arch builds
tags: [kaseki, docker, devops, image-management, ci-cd]
relatedSkills: [test-automation, dependency-cache-optimization]
---

# Docker Image Management for Kaseki Agent

This skill guides maintaining the kaseki-agent Docker image, including base image updates, Pi CLI versioning, and multi-architecture builds.

## Overview

**When to Use**:
- Updating Node.js base image (security patches, new versions)
- Upgrading Pi CLI to a new version
- Investigating multi-arch (amd64 + arm64) build failures
- Troubleshooting image caching or layer issues
- Publishing a new image version

**Key Concepts**:
- Base image: Node 22.22.2 (monthly security updates)
- Pi CLI: Pre-installed version 0.70.2 (compatibility matrix)
- Multi-arch: Build for both amd64 + arm64 using QEMU
- Registry: Published to `docker.io/cyanautomation/kaseki-agent`
- Versioning: Semantic versioning + latest tag

---

## Base Image (Node)

### Current Version
```
Base: node:22.22.2-alpine
Architecture: linux/amd64, linux/arm64
```

### Monitoring for Updates

**Monthly Security Checks**:
1. Check Node.js security advisories: https://nodejs.org/en/security
2. Review Alpine Linux security bulletins (base of node:*-alpine)
3. Scan current image for vulnerabilities:
   ```bash
   docker build -t kaseki-template:test .
   docker run --rm aquasec/trivy image kaseki-template:test
   ```

### Updating the Base Image

**Step 1**: Update Dockerfile
```dockerfile
# Before
FROM node:22.22.2-alpine AS builder

# After
FROM node:22.23.0-alpine AS builder
```

**Step 2**: Test the change locally
```bash
# Build locally
docker build -t kaseki-template:test .

# Verify Node version
docker run --rm kaseki-template:test node --version
# Output: v22.23.0

# Run sanity checks
docker run --rm kaseki-template:test pi --version
docker run --rm kaseki-template:test npm --version
```

**Step 3**: Update Pi CLI if needed (see section below)

**Step 4**: Run full integration tests
```bash
bash tests/docker-image.test.sh
bash tests/smoke.test.sh
```

**Step 5**: Update CLAUDE.md and version tracking
```markdown
# In CLAUDE.md
**Node Version**: 22.23.0
```

### Breaking Changes in Node Versions

**Node 20 → 22**: Check for deprecated features
- V8 breaking changes (inspect [Node release notes](https://nodejs.org/en/blog))
- npm behavior differences
- ESM vs CommonJS compatibility

**How to Test**:
```bash
# Test against actual repo that uses Node 22
REPO_URL=https://github.com/cyanautomation/crudmapper \
  GIT_REF=main \
  ./run-kaseki.sh --doctor
```

---

## Pi CLI Version Management

### Current Version
```
Pi CLI: 0.70.2 (as of April 2026)
Installation: npm install -g @anthropic-ai/cli@0.70.2 (in Dockerfile)
```

### Version Compatibility Matrix

| Pi CLI Version | Node LTS | Notable Changes |
|---|---|---|
| 0.70.2 | 20, 22 | Current; stable |
| 0.71.0 | 20, 22 | (hypothetical) Added new features |
| 0.60.x | 18, 20 | Legacy; not recommended |

### Checking for Updates

```bash
# Check npm registry for latest Pi CLI
npm view @anthropic-ai/cli versions --json | tail -5

# Check release notes
# https://github.com/anthropics/anthropic-sdk-python/releases
```

### Updating Pi CLI

**Step 1**: Update Dockerfile
```dockerfile
# Before
RUN npm install -g @anthropic-ai/cli@0.70.2

# After
RUN npm install -g @anthropic-ai/cli@0.71.0
```

**Step 2**: Test Pi CLI availability
```bash
docker build -t kaseki-template:test .
docker run --rm kaseki-template:test pi --version
# Output: @anthropic-ai/cli/0.71.0
```

**Step 3**: Test with a real kaseki run (optional, if API key available)
```bash
OPENROUTER_API_KEY=sk-or-... \
  ./run-kaseki.sh kaseki-test-1
```

**Step 4**: Check compatibility
- Run validation commands
- Verify Pi event JSON structure (pi-events.jsonl format)
- Check for new error messages or behavior changes

**Step 5**: Update documentation
```markdown
# In CLAUDE.md
**Pi CLI Version**: 0.71.0
```

### Handling Breaking Changes in Pi CLI

If a new Pi CLI version has breaking changes:

1. **Update kaseki scripts** (pi-event-filter.js, pi-summary.json parsing)
2. **Test event structure**:
   ```javascript
   // Verify new event format still parses correctly
   const events = JSON.parse(piEventJson);
   expect(events[0]).toHaveProperty('type');
   ```
3. **Update tests** to expect new behavior
4. **Document in CHANGELOG** if user-facing changes

---

## Multi-Architecture Builds

### Setup: Docker Buildx

**Buildx** enables building images for multiple architectures (amd64, arm64, etc.).

**Check if buildx is available**:
```bash
docker buildx version
# Output: github.com/docker/buildx v0.10.4
```

**If Not Installed**:
```bash
# Install via Docker Desktop (included) or:
docker run --privileged --rm tonistiigi/binfmt --install all
```

### Building Multi-Arch Images

**Build and Load to Local Docker** (for testing):
```bash
# Build amd64 only (for local testing)
docker buildx build \
  --platform linux/amd64 \
  -t kaseki-template:latest \
  --load \
  .
```

**Build All Architectures** (for publishing):
```bash
# Build amd64 + arm64 (outputs to registry)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t docker.io/cyanautomation/kaseki-agent:0.1.0 \
  -t docker.io/cyanautomation/kaseki-agent:latest \
  --push \
  .
```

### Multi-Arch Troubleshooting

**Issue**: Build fails for arm64

**Diagnosis**:
```bash
# Check QEMU support
docker run --rm --privileged tonistiigi/binfmt --status
# Output: qemu-aarch64-static: SUPPORTED

# Rebuild with verbose output
docker buildx build \
  --platform linux/arm64 \
  -t kaseki-template:test \
  --progress=plain \
  .
```

**Common Causes**:
1. **Invalid base image digest** → Use multi-arch base (node:*-alpine is multi-arch)
2. **Architecture-specific dependencies** → Check npm packages for native bindings
3. **QEMU timeout** → Increase builder timeout or simplify build steps

**Solution Steps**:
1. Verify base image supports arm64: `docker pull --platform linux/arm64 node:22.22.2-alpine`
2. Check package.json for native modules: `npm ls | grep gyp`
3. Rebuild with increased timeout: `--build-arg BUILDKIT_PROGRESS=plain`

---

## Dockerfile Structure

### Multi-Stage Build

```dockerfile
# Stage 1: Builder (installs Pi CLI, dependencies)
FROM node:22.22.2-alpine AS builder

WORKDIR /build
RUN npm install -g @anthropic-ai/cli@0.70.2

# Stage 2: Runtime (minimal, copies Pi CLI from builder)
FROM node:22.22.2-alpine

RUN addgroup -g 10001 kaseki && \
    adduser -D -u 10001 -G kaseki kaseki

WORKDIR /app

# Copy Pi CLI from builder
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=builder /usr/local/bin/pi /usr/local/bin/pi

# Copy scripts
COPY kaseki-agent.sh /app/
COPY pi-event-filter.js /app/
COPY kaseki-report.js /app/

RUN chmod +x /app/kaseki-agent.sh

USER kaseki:kaseki

ENTRYPOINT ["/app/kaseki-agent.sh"]
```

**Why Multi-Stage?**
- **Smaller final image**: Builder dependencies (git, build tools) aren't in runtime layer
- **Faster rebuilds**: Only rebuild what changed (cache layers)
- **Security**: Runtime doesn't include build tools

### Cache Layers

Dockerfile layers are cached independently. Order matters:

```dockerfile
# Good: Stable layers first, mutable layers last
FROM node:22.22.2-alpine          # Cache hit (stable)
RUN npm install -g @anthropic-ai/cli  # Cache hit (stable)
COPY kaseki-agent.sh /app/        # Cache miss (depends on file content)
COPY pi-event-filter.js /app/     # Cache miss
```

**Cache Busting**:
If you need to force a rebuild (e.g., security patch in base image), add a label:

```dockerfile
LABEL version="1" rebuild_date="2026-04-25"
# Increment 'version' or update date to bust cache
```

### Smoke Tests in Dockerfile

You can add smoke tests to the build to catch issues early:

```dockerfile
# Add after installing Pi CLI
RUN pi --version || exit 1
RUN npm --version || exit 1

# Verify non-root user
RUN test "$(id -u)" = "10001" || exit 1
```

---

## Publishing Images

### Version Tagging Strategy

| Tag | Purpose | When |
|---|---|---|
| `0.1.0` | Semantic version | Release with version bump |
| `0.1` | Minor version | Latest 0.1.x release |
| `latest` | Current stable | Every release |
| `edge` (optional) | Development | On main branch push |

### GitHub Actions Workflow

```yaml
name: Publish Docker Image

on:
  push:
    tags:
      - 'v*'  # v0.1.0, v0.2.0, etc.

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: docker/setup-buildx-action@v2
      
      - uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}
      
      - uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: |
            docker.io/cyanautomation/kaseki-agent:${{ github.ref_name }}
            docker.io/cyanautomation/kaseki-agent:latest
          platforms: linux/amd64,linux/arm64
```

### Manual Publishing

```bash
# Build and push
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t docker.io/cyanautomation/kaseki-agent:0.1.1 \
  -t docker.io/cyanautomation/kaseki-agent:latest \
  --push \
  .

# Verify on registry
docker pull docker.io/cyanautomation/kaseki-agent:0.1.1
docker inspect docker.io/cyanautomation/kaseki-agent:0.1.1 | jq '.[0].Architecture'
```

---

## Smoke Tests

### Image Validation Tests

**Test: Pi CLI is available**
```bash
docker run --rm kaseki-template:latest pi --version
```

**Test: Metadata structure is correct**
```bash
docker run --rm kaseki-template:latest bash -c '
  [[ -f /opt/kaseki/workspace-cache/package.json ]] || exit 1
'
```

**Test: Non-root user**
```bash
docker run --rm kaseki-template:latest id -u | grep -q 10001
```

**Test: Read-only root filesystem**
```bash
docker run --rm --read-only kaseki-template:latest touch /test.txt 2>&1 | grep -q "Read-only"
```

### Running All Smoke Tests

```bash
#!/bin/bash
# tests/smoke.test.sh

set -e

IMAGE="kaseki-template:latest"

echo "Building image..."
docker build -t $IMAGE .

echo "Running smoke tests..."

echo "✓ Pi CLI available"
docker run --rm $IMAGE pi --version

echo "✓ Non-root user (UID 10001)"
docker run --rm $IMAGE id -u | grep -q 10001

echo "✓ npm available"
docker run --rm $IMAGE npm --version

echo "✓ Node version correct"
docker run --rm $IMAGE node --version | grep -q "v22"

echo "✓ All smoke tests passed"
```

---

## Dependency Caching Strategy

The Dockerfile includes an image seed cache for npm dependencies:

```dockerfile
# Pre-populate cache for faster builds
COPY docker/workspace-cache/package.json /opt/kaseki/workspace-cache/
RUN cd /opt/kaseki/workspace-cache && npm ci
```

This cache is restored during `kaseki-agent.sh` execution if lock hashes match:

```bash
# In kaseki-agent.sh
if [[ -d /opt/kaseki/workspace-cache ]]; then
  cp -r /opt/kaseki/workspace-cache "$WORKSPACE_CACHE_PATH"
fi
```

**Update the Seed Cache**:
When dependencies change frequently, update the seed:

```bash
# Refresh docker/workspace-cache/package-lock.json
cd docker/workspace-cache
npm update  # Or point to specific repos
npm ci
cd ../..

# Rebuild image
docker build -t kaseki-template:latest .
```

See [Dependency Cache Optimization](dependency-cache-optimization.md) for detailed strategy.

---

## Performance Optimization

### Layer Caching

To speed up builds, order Dockerfile commands by change frequency:

```dockerfile
# Lowest change frequency (stable, cache-friendly)
FROM node:22.22.2-alpine
RUN apk add --no-cache git openssh-client  # System deps
RUN npm install -g @anthropic-ai/cli@0.70.2  # Global tools

# Medium change frequency
COPY docker/workspace-cache/ /opt/kaseki/workspace-cache/
RUN cd /opt/kaseki/workspace-cache && npm ci

# Highest change frequency (changes on every push, less cacheable)
COPY kaseki-agent.sh /app/
COPY pi-event-filter.js /app/
COPY kaseki-report.js /app/
```

### Build Size Optimization

Keep final image small:

```bash
# Check image size
docker image inspect kaseki-template:latest | jq '.[] | .Size'
# Output: 543210000 (≈500 MB is reasonable)

# Identify large layers
docker history kaseki-template:latest
```

**Common Optimizations**:
1. Use alpine base image (≈150 MB vs. debian ≈1 GB)
2. Remove build tools from final stage (multi-stage build)
3. Combine RUN commands to reduce layers: `RUN apk add X && npm install Y`

---

## Related Skills & Docs

- [Test Automation](test-automation.md) — Integration tests for image validation
- [Dependency Cache Optimization](dependency-cache-optimization.md) — Image seed cache strategy
- [Dockerfile](../../Dockerfile) — Current Dockerfile source
- [CLAUDE.md](../../CLAUDE.md) — Architecture and version reference
