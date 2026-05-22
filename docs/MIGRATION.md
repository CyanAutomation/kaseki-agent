# Migration Guide: Setup Simplification (May 2026)

> **Status**: Breaking changes released. Old setup paths are no longer supported.

This guide helps existing kaseki-agent users transition to the simplified setup process.

## What Changed

### Before (Old Setup Paths)

- **npm CLI setup**: `npm install -g @cyanautomation/kaseki-agent && kaseki-agent setup`
- **Shell script path**: Manual `./run-kaseki.sh` with multiple environment variables
- **Docker bootstrap ceremony**: Required `kaseki-activate.sh --controller bootstrap` before API service
- **Configuration**: 60+ environment variables scattered across 3 files
- **Documentation**: Fragmented across SETUP_GUIDE.md, ENV_VARS.md, PERFORMANCE_TUNING.md

### After (New Unified Setup)

- **Single command**: `kaseki-agent init` (interactive wizard)
- **Essential 8 configuration**: Only 8 variables shown to users; 50+ auto-detected
- **Zero-touch Docker**: API service auto-initializes template; no bootstrap ceremony
- **Unified documentation**: QUICK_START.md (decision tree) + ADVANCED_CONFIG.md (reference)
- **Secure by default**: Credentials stored in `~/.kaseki/secrets.json` (mode 0600)

---

## For Previous npm CLI Users

**Old workflow**:

```bash
npm install -g @cyanautomation/kaseki-agent
export OPENROUTER_API_KEY=sk-or-...
kaseki-agent setup
```

**New workflow** (breaking change):

```bash
# Option 1: Use Docker (recommended)
docker-compose up -d  # Automatically initializes everything
kaseki-api-service http://localhost:8080

# Option 2: Run with Node.js
npm install
npm run build
OPENROUTER_API_KEY_FILE=$HOME/.kaseki/secrets.json \
  npm run kaseki-api

# Option 3: Interactive setup wizard
npm install
npm run build
npm run kaseki -- init  # Interactive wizard
```

**What to do**:

- [ ] Remove global npm installation: `npm uninstall -g @cyanautomation/kaseki-agent`
- [ ] Clone/update repository: `git clone https://github.com/CyanAutomation/kaseki-agent.git`
- [ ] Run new setup: `kaseki-agent init` or `docker-compose up -d`
- [ ] Update your automation scripts to use new paths

---

## For Previous Shell Script Users

**Old workflow**:

```bash
export OPENROUTER_API_KEY=sk-or-...
export REPO_URL=https://github.com/user/repo
export GIT_REF=main
./run-kaseki.sh
```

**New workflow** (no changes for single-run execution):

```bash
# Still the same for single-run
./run-kaseki.sh

# But now with better setup:
kaseki-agent init  # Creates ~/.kaseki/secrets.json
# Then:
./run-kaseki.sh
```

**What changed**:

- `run-kaseki.sh` still works the same way
- API key resolution is now unified (looks for secrets.json first)
- New startup checks validate permissions early (prevents silent failures)
- You can still use `.env` files or environment variables

---

## For Previous Docker Users (Bootstrap Ceremony)

**Old workflow**:

```bash
docker-compose up -d
docker exec kaseki-agent /scripts/kaseki-activate.sh --controller bootstrap
# Wait for bootstrap to complete...
curl -X POST http://localhost:8080/api/runs -H "Authorization: Bearer sk-key" ...
```

**New workflow** (zero-touch):

```bash
docker-compose up -d
# That's it! Bootstrap happens automatically.
sleep 2  # Give API time to initialize
curl -X POST http://localhost:8080/api/runs -H "Authorization: Bearer sk-key" ...
```

**What changed**:

- ✅ `kaseki-activate.sh --controller bootstrap` is no longer needed
- ✅ Template directory auto-initializes on API service startup
- ✅ Permission checks run early (before any operation)
- ✅ Clear error messages if something fails

**No action needed** if you were using:

- ✅ Docker Compose (just update and redeploy)
- ✅ Local API service (same environment variables work)
- ✅ Single-run execution (no changes)

---

## Environment Variable Mapping

### Essential 8 (Required → Optional → Auto-Detected)

| Old Variable | New Variable | Status | Notes |
|---|---|---|---|
| `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY_FILE` | Required | Now file-based (safer); env var still supported |
| `KASEKI_MODEL` | `KASEKI_MODEL` | No change | Same behavior; default is `openrouter/free` |
| `KASEKI_VALIDATION_COMMANDS` | `KASEKI_VALIDATION_COMMANDS` | No change | Same behavior |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `KASEKI_AGENT_TIMEOUT_SECONDS` | No change | Same behavior |
| `KASEKI_MAX_DIFF_BYTES` | `KASEKI_MAX_DIFF_BYTES` | No change | Same behavior |
| `REPO_URL` | `REPO_URL` | No change | Same behavior |
| `GIT_REF` | `GIT_REF` | No change | Same behavior; default is `main` |
| `TASK_PROMPT` | `TASK_PROMPT` | No change | Same behavior |

### Other Variables (60+ Total)

**Now organized by zone** instead of flat list:

| Old File | New Zone | New Location |
|---|---|---|
| ENV_VARS.md | All zones | `docs/ADVANCED_CONFIG.md` (organized by zone) |
| PERFORMANCE_TUNING.md | Caching & Performance | `docs/ADVANCED_CONFIG.md#caching--performance-zone` |
| QUALITY_GATES.md | Validation & Quality Gates | `docs/ADVANCED_CONFIG.md#validation--quality-gates-zone` |
| DOCKER_SETUP.md | Infrastructure | `docs/ADVANCED_CONFIG.md#infrastructure-zone-api-service-only` |
| CI_CD_INTEGRATION.md | GitHub Integration | `docs/ADVANCED_CONFIG.md#github-integration-zone` |

**All 60+ variables** are documented in [ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md).

---

## Deprecated Commands & Scripts

The following are **no longer supported**:

| Command | Reason | Alternative |
|---|---|---|
| `scripts/kaseki-activate.sh --controller bootstrap` | Template auto-initializes | No action needed; happens automatically |
| `scripts/kaseki-setup.sh` | Replaced by `kaseki-agent init` | Use `kaseki-agent init` |
| `kaseki-agent setup` | Deprecated in favor of `init` | Use `kaseki-agent init` |
| npm CLI global install | No longer available | Clone repo, use `npm run kaseki` |
| Old 3-path setup flow | Consolidated into single wizard | Use `kaseki-agent init` |

---

## Troubleshooting Migration

### "run-kaseki.sh: command not found"

**Problem**: You removed the old repo directory before cloning the new one.

**Solution**:

```bash
git clone https://github.com/CyanAutomation/kaseki-agent.git
cd kaseki-agent
npm install
npm run build
./run-kaseki.sh
```

### "Template directory missing; auto-initialization failed"

**Problem**: API service couldn't auto-initialize `/agents/kaseki-template`.

**Solution**:

```bash
# Check permissions
docker exec kaseki-api /scripts/startup-checks.sh permissions

# Manually initialize (if needed)
docker exec kaseki-api /scripts/startup-checks.sh bootstrap
```

### "Startup checks failed: configuration error"

**Problem**: Permission or configuration issue detected early.

**Solution**:

```bash
# Run checks with verbose output
docker exec kaseki-api /scripts/startup-checks.sh all

# Fix permission issue on host
sudo chown 10000:10000 /agents
```

### "Environment variables not working"

**Problem**: Old variable names or paths no longer supported.

**Solution**:

1. Check [ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md) for current variable names
2. Use `kaseki-agent init` to regenerate `.env` file
3. Verify credentials in `~/.kaseki/secrets.json`

---

## Getting Help

- **Quick start**: [QUICK_START.md](docs/QUICK_START.md) — Decision tree for all paths
- **Configuration reference**: [ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md) — All 60+ variables documented
- **Troubleshooting**: [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — Error diagnosis
- **Check environment**: `kaseki-agent doctor` or `docker exec kaseki-api /scripts/startup-checks.sh`

---

## Timeline & Support

| Date | Action |
|---|---|
| May 2026 | Breaking changes released; old paths no longer supported |
| — | Old docs archived but accessible in git history |
| — | Community support via GitHub Issues |

**No extended support period** — Update immediately to the new setup process.
