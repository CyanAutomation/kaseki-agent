---
name: dependency-cache-optimization
description: Understanding and optimizing the 4-layer npm dependency caching strategy
tags: [kaseki, caching, performance, npm, optimization]
relatedSkills: [docker-image-management, workflow-diagnosis]
---

# Dependency Cache Optimization for Kaseki Agent

This skill guides understanding and optimizing kaseki-agent's 4-layer npm dependency caching strategy for faster builds and reduced network I/O.

## Overview

**When to Use**:
- Diagnosing slow `npm ci` runs
- Understanding cache hits vs. misses
- Optimizing cache layer strategy
- Tuning image builds
- Improving kaseki run performance

**Key Concepts**:
- Kaseki uses a 4-layer cache to avoid redundant `npm ci` runs
- Cache layers: stamp check → workspace cache → image seed cache → fresh install
- Stamp files encode repository and lock file hashes
- Cache invalidation happens when lock files change

---

## The 4-Layer Cache Strategy

### Architecture Diagram

```
Kaseki Instance Run
│
├─ Layer 1: Stamp Check
│  └─ Does node_modules + stamp match? → Skip (fast path)
│
├─ Layer 2: Workspace Cache
│  └─ Previous run's cache for this repo+lock? → Restore
│
├─ Layer 3: Image Seed Cache
│  └─ Pre-built cache in Docker image? → Restore
│
└─ Layer 4: Fresh Install
   └─ npm ci --prefer-offline (download if needed)
```

### Layer 1: Stamp Check (Fastest)

**Purpose**: Quick validation that node_modules is already correct

**Stamp File Location**: `/workspace/.kaseki-cache/<repo-hash>.<lock-hash>.stamp`

**Format**:
```
repo:<repo-hash> lock:<lock-hash> timestamp:<unix-time>
```

**Computation**:
- `<repo-hash>`: SHA-1 of repo directory name (or GitHub owner/repo)
- `<lock-hash>`: SHA-1 of package-lock.json content

**Speed**: Microseconds (file comparison)

**When Stamp Matches**:
```bash
# Stamp file exists and matches current repo + lock
# → node_modules is already correct
# → Skip all install steps
# Result: 0 seconds saved!
```

**When Stamp Doesn't Match**:
```bash
# Stamp file missing or hashes differ
# → Try Layer 2 (workspace cache)
```

### Layer 2: Workspace Cache (Fast)

**Purpose**: Reuse cached node_modules from a previous kaseki run

**Cache Location**: `/workspace/.kaseki-cache/<repo-hash>/<lock-hash>/node_modules/`

**Speed**: Seconds (copy operation)

**When Cache Exists**:
```bash
# Found cached node_modules for this repo + lock combo
# → Copy from .kaseki-cache to ./node_modules
# → Create new stamp file
# Result: 5–30 seconds (vs. 1–3 minutes for fresh install)
```

**When Cache Doesn't Exist**:
```bash
# No previous run cached this repo+lock combo
# → Try Layer 3 (image seed cache)
```

### Layer 3: Image Seed Cache (Medium)

**Purpose**: Use pre-built cache in the Docker image for common repos

**Cache Location (in image)**: `/opt/kaseki/workspace-cache/`

**Contents**:
- `package.json` — Sample dependencies
- `node_modules/` — Pre-installed modules
- Package cache (npm's internal cache)

**Speed**: 30 seconds (copy + verification)

**When Cache Matches Target Lock**:
```bash
# Image seed cache exists and matches target lock file
# → Copy from /opt/kaseki/workspace-cache to ./node_modules
# → Create stamp file
# Result: 10–60 seconds (vs. 1–3 minutes)
```

**When Cache Doesn't Match**:
```bash
# Lock hashes differ or seed cache doesn't exist
# → Fall through to Layer 4 (fresh install)
```

### Layer 4: Fresh Install (Slowest)

**Purpose**: Install dependencies from scratch (npm registry or offline cache)

**Speed**: 1–3 minutes (network I/O + compilation)

**Command**:
```bash
npm ci --prefer-offline
```

**Fallback**: If `--prefer-offline` can't find packages, npm downloads from registry.

---

## Cache Invalidation & Busting

### When Does Cache Invalidate?

| Trigger | Impact | Example |
|---|---|---|
| **Lock file changed** | All layers reset | Upgrading a dependency |
| **New repo** | Layers 2–3 miss | First run against new repo |
| **Image rebuilt** | Layer 3 reset | New Dockerfile, new base image |
| **Manual deletion** | Layers 2–3 reset | `rm -rf .kaseki-cache` |

### Detecting Cache Misses

```bash
# Check validation timings
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
# Output:
# command          duration_seconds
# npm ci           180  ← 3 minutes = cache miss (Layer 4)

# Expected baseline:
# npm ci (cache hit)     : 5–30 seconds (Layer 2)
# npm ci (seed hit)      : 30–60 seconds (Layer 3)
# npm ci (fresh)         : 1–3 minutes (Layer 4)
```

**Analysis**:
```bash
# Was Layer 1 (stamp check) attempted?
grep -i "stamp\|cache hit" /agents/kaseki-results/kaseki-N/stdout.log

# If missing, check if lock file changed
git diff package-lock.json
```

### Manual Cache Busting

```bash
# Clear workspace cache (Layers 1–2)
rm -rf /workspace/.kaseki-cache

# Clear image seed cache (rebuild Docker image)
docker build --no-cache -t kaseki-template:latest .

# Next run will fall through to Layer 4 (fresh install)
```

---

## Stamp File Details

### Stamp File Naming

```
.kaseki-cache/<repo-hash>.<lock-hash>.stamp
```

**Components**:
- `<repo-hash>`: 40-char SHA-1 hex digest of repo identifier
- `<lock-hash>`: 40-char SHA-1 hex digest of package-lock.json

**Example**:
```
.kaseki-cache/abc1234567890def1234567890abcdef12345678.fed0987654321abc0987654321fedcba98765432.stamp
```

### Stamp File Content

```
repo:abc1234567890def1234567890abcdef12345678 lock:fed0987654321abc0987654321fedcba98765432 timestamp:1703520600
```

### Computing Hash Examples

**Repo Hash** (from repo name):
```bash
echo -n "cyanautomation/crudmapper" | sha1sum
# Output: abc1234567890def1234567890abcdef12345678

# Or from directory name:
echo -n "kaseki-runs/kaseki-1/crudmapper" | sha1sum
```

**Lock Hash** (from package-lock.json):
```bash
sha1sum package-lock.json | awk '{print $1}'
# Output: fed0987654321abc0987654321fedcba98765432
```

### Stamp Check Script

In `kaseki-agent.sh`, the stamp check looks like:

```bash
REPO_HASH=$(echo -n "$REPO_URL" | sha1sum | cut -d' ' -f1)
LOCK_HASH=$(sha1sum package-lock.json | cut -d' ' -f1)
STAMP_FILE="/workspace/.kaseki-cache/${REPO_HASH}.${LOCK_HASH}.stamp"

if [[ -f "$STAMP_FILE" ]]; then
  echo "Stamp check passed: cache is valid"
  exit 0  # Skip npm install
fi
```

---

## Cache Directory Structure

### Workspace Cache Layout

```
/workspace/
├── .kaseki-cache/
│   ├── repo-hash-1.lock-hash-1.stamp
│   ├── repo-hash-1/
│   │   ├── lock-hash-1/
│   │   │   ├── node_modules/
│   │   │   │   ├── package1/
│   │   │   │   ├── package2/
│   │   │   └── ...
│   │   └── lock-hash-2/
│   │       └── node_modules/
│   └── repo-hash-2/
│       └── ...
```

**Purpose**: Multiple locks per repo, multiple repos per workspace

**Retention**: Deleted after kaseki instance completes (unless `KASEKI_KEEP_WORKSPACE=1`)

### Image Seed Cache Layout

```
/opt/kaseki/workspace-cache/
├── package.json
├── package-lock.json
└── node_modules/
    ├── package1/
    ├── package2/
    └── ... (common packages)
```

**Populated During Image Build**:
```dockerfile
COPY docker/workspace-cache/ /opt/kaseki/workspace-cache/
RUN cd /opt/kaseki/workspace-cache && npm ci
```

**Updated**:
```bash
# Refresh seed cache (in this repo)
cd docker/workspace-cache
npm update  # or npm install <packages>
npm ci
cd ../..

# Rebuild image
docker build -t kaseki-template:latest .
```

---

## Performance Analysis & Tuning

### Baseline Metrics

**Cache Layers** (typical timing):

| Scenario | Duration | Bottleneck |
|---|---|---|
| Layer 1 hit (stamp match) | <1 sec | File check only |
| Layer 2 hit (workspace) | 5–30 sec | Copy + verify |
| Layer 3 hit (seed) | 30–60 sec | Copy + npm resolve |
| Layer 4 (fresh) | 1–3 min | Network I/O + compile |

**Optimization Target**: Aim for Layer 2 most runs (workspace cache hits)

### Diagnosing Slow Installs

**Check Actual Duration**:
```bash
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv | grep npm

# Output:
# npm ci    180  ← 3 minutes = problem!
```

**Step 1: Check If Stamp Hit**
```bash
grep -i "stamp\|cache" /agents/kaseki-results/kaseki-N/stdout.log
# Look for: "Stamp check passed" or "Cache hit"
```

**Step 2: Check If Lock File Changed**
```bash
cat /agents/kaseki-results/kaseki-N/git.diff | grep package-lock.json
# If output exists, lock file was modified → cache invalidated
```

**Step 3: Check Image Seed Cache**
```bash
# Was seed cache used?
grep -i "seed\|image cache" /agents/kaseki-results/kaseki-N/stdout.log
```

**Step 4: Analyze npm Behavior**
```bash
# Check npm install log for network delays
grep -i "downloading\|get\|registry" /agents/kaseki-results/kaseki-N/stdout.log

# If many "downloading", network was bottleneck
# If few, compilation was bottleneck
```

### Optimization Strategies

**Strategy 1: Maximize Stamp Hits** (Best)
- Minimize lock file changes
- When updating dependencies, commit lock file changes and wait for workspace cache to populate
- Result: <1 second installs

**Strategy 2: Maximize Workspace Cache Hits** (Good)
- Run frequent kaseki jobs against same repos
- Cache persists across runs (if not deleted)
- Result: 5–30 second installs

**Strategy 3: Optimize Image Seed Cache** (Medium)
- Pre-populate with commonly-needed packages
- Update dockerfile/workspace-cache/ monthly
- Result: 30–60 second installs

**Strategy 4: Accept Fresh Installs** (Fallback)
- Use `npm ci --prefer-offline` to reduce network I/O
- Consider upgrading base image npm version (faster resolution)
- Result: 1–3 minute installs

### Example Optimization

**Scenario**: npm ci is taking 3 minutes every run

**Diagnosis**:
```bash
# Check timings across recent runs
for run in /agents/kaseki-results/kaseki-{1,2,3,4,5}/; do
  echo "=== $(basename $run) ==="
  grep npm "$run/validation-timings.tsv" | awk '{print $2}'
done
# All show 180 seconds → consistent problem
```

**Analysis**:
```bash
# Check if lock file is changing
for run in /agents/kaseki-results/kaseki-{1,2,3}/; do
  grep package-lock.json "$run/git.diff" | head -1
done
# All show lock changes → root cause found
```

**Solution**:
```bash
# Option 1: Commit lock changes to main branch
git checkout main
npm install  # Update lock
git add package-lock.json
git commit -m "chore: update dependencies"
git push origin main

# Option 2: Seed the image cache with current lock
cp package-lock.json docker/workspace-cache/
cd docker/workspace-cache
npm ci
cd ../..

docker build -t kaseki-template:latest .

# Next runs will hit Layer 3 (60 seconds instead of 180)
```

---

## Cache Persistence & Cleanup

### Docker Container Cleanup

By default, kaseki containers are ephemeral:

```bash
# Workspace is deleted after run
/workspace/.kaseki-cache/
```

**Keep Workspace for Debugging**:
```bash
KASEKI_KEEP_WORKSPACE=1 ./run-kaseki.sh
# Workspace retained at /agents/kaseki-runs/kaseki-N/
```

### Manual Cache Management

```bash
# Clear all workspace caches
rm -rf /agents/kaseki-cache/*

# Clear specific repo cache
rm -rf /agents/kaseki-cache/repo-abc123/*

# Inspect cache size
du -sh /agents/kaseki-cache/
```

### Image Cache Cleanup

```bash
# Rebuild image (clears old layers)
docker build -t kaseki-template:latest .

# Or force rebuild with no cache
docker build --no-cache -t kaseki-template:latest .

# Prune unused Docker layers
docker system prune --all
```

---

## Advanced: Custom Cache Seeding

### Pre-Populate Image Seed Cache

If you frequently run kaseki against a specific repo:

**Step 1**: Clone the target repo and install
```bash
cd docker/workspace-cache
git clone https://github.com/org/target-repo .tmp/target
cp .tmp/target/package.json .
cp .tmp/target/package-lock.json .
npm ci
rm -rf .tmp
```

**Step 2**: Rebuild image
```bash
docker build -t kaseki-template:latest .
```

**Step 3**: Verify seed cache
```bash
docker run --rm kaseki-template:latest ls /opt/kaseki/workspace-cache/node_modules | head -10
```

**Result**: First runs against target-repo will hit Layer 3, reducing install time to 30–60 seconds

### Monitoring Cache Effectiveness

```bash
# Track cache hits across runs
for run in /agents/kaseki-results/kaseki-*/; do
  duration=$(grep npm "$run/validation-timings.tsv" | awk '{print $2}')
  echo "$(basename $run): ${duration}s"
done

# Calculate average
for run in /agents/kaseki-results/kaseki-*/; do
  grep npm "$run/validation-timings.tsv" | awk '{print $2}'
done | awk '{sum+=$1; count++} END {print "Average: " sum/count "s"}'
```

**Interpretation**:
- Average < 10 sec: Excellent (Layer 1 hits)
- Average 10–30 sec: Good (Layer 2 hits)
- Average 30–60 sec: Fair (Layer 3 hits)
- Average > 60 sec: Poor (Layer 4 misses)

---

## Related Skills & Docs

- [Docker Image Management](docker-image-management.md) — Image seed cache updates
- [Workflow Diagnosis](workflow-diagnosis.md) — Analyzing timings and performance
- [kaseki-agent.sh](../../kaseki-agent.sh) — Cache implementation details
- [CLAUDE.md](../../CLAUDE.md) — Architecture and environment variables
