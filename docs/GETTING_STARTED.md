# Getting Started with Kaseki Agent

Kaseki Agent runs your coding tasks in isolated Docker containers, driven by an AI model (via OpenRouter) and validated by your own test suite.

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Docker | 20.10+ | Must be running (`docker ps`) |
| Node.js | 24+ | For the CLI; `node --version` |
| OpenRouter API key | — | From https://openrouter.ai/keys |

---

## One-command setup (recommended)

```bash
npm install -g @cyanautomation/kaseki-agent
kaseki-agent quickstart
```

`quickstart` does everything in one pass:

1. Detects Docker, Node.js, and sudo access
2. Discovers your secrets at `~/secrets/` (or environment variables — see [Secrets](#secrets))
3. Writes `~/.kaseki/config.json` with resolved paths
4. Creates `/agents/{kaseki-results,kaseki-runs,kaseki-cache}` owned by UID 10000 (uses sudo if needed)
5. Starts the `kaseki-api` container
6. Waits for `http://localhost:8080/ready` to confirm the API is ready
7. Smoke-tests your bearer token against `/api/runs`

Use `--dry-run` to see what it would do without making changes:

```bash
kaseki-agent quickstart --dry-run
```

---

## Verify

```bash
kaseki-agent doctor           # all checks green
kaseki-agent host preflight   # full API preflight
```

---

## Submit your first task

```bash
export KASEKI_API_KEY=<your-bearer-token>

kaseki-agent run https://github.com/CyanAutomation/crudmapper main \
  "Add input validation to all POST endpoints"

kaseki-agent list                # show queued/running tasks
kaseki-agent status kaseki-1     # poll until done
kaseki-agent report kaseki-1     # show diff + validation output
```

---

## Secrets

Kaseki needs an OpenRouter API key and (optionally) GitHub App credentials for automated PR creation.

### Recommended layout

```
~/secrets/
  openrouter_api_key        # required
  github_app_id             # optional — needed for PR creation
  github_app_client_id      # optional
  github_app_private_key    # optional
  kaseki_api_keys           # bearer token(s) for API auth
```

```bash
chmod 600 ~/secrets/*
```

### Discovery order

For each secret, kaseki-agent checks in this order:

1. `~/.kaseki/config.json` `auth.*_file` fields
2. Environment variable (`$OPENROUTER_API_KEY_FILE`, `$GITHUB_APP_ID_FILE`, …)
3. `~/.kaseki/secrets/<filename>`
4. `~/secrets/<filename>`

### Persistent config (alternative to files)

```bash
mkdir -p ~/.kaseki
cat > ~/.kaseki/config.json <<EOF
{
  "auth": {
    "openrouter_api_key_file": "~/secrets/openrouter_api_key",
    "github_app_id_file": "~/secrets/github_app_id",
    "github_app_client_id_file": "~/secrets/github_app_client_id",
    "github_app_private_key_file": "~/secrets/github_app_private_key"
  }
}
EOF
```

---

## Step-by-step wizard (alternative to quickstart)

If you prefer an interactive guided flow:

```bash
kaseki-agent init
```

Choose between:
- **Single-run** — one-off tasks via `./run-kaseki.sh`
- **Local API service** — persistent service via `kaseki-agent serve`
- **Production REST API** — Docker Compose deployment (same as `quickstart`)

---

## Troubleshooting

### Doctor reports issues

```bash
kaseki-agent doctor --json   # machine-readable; valid JSON only on stdout
kaseki-agent doctor --fix    # attempt auto-remediation
```

### API returns "not_ready"

The most common cause is `/agents` missing or wrong ownership:

```bash
ls -la /agents/              # should be owned by UID 10000
sudo mkdir -p /agents/kaseki-results /agents/kaseki-runs /agents/kaseki-cache
sudo chown -R 10000:10000 /agents
docker restart kaseki-api
curl http://localhost:8080/ready   # should return {"status":"ready"}
```

### Init container fails (exit 3)

Exit code 3 means warnings-but-continuing; it does not block setup when you run `kaseki-agent quickstart` directly. If you use `docker compose up`, the `depends_on: service_completed_successfully` constraint treats it as failure. Use `quickstart` or run `kaseki-api` with `docker run` directly.

### Host preflight hangs

Fixed in v1.31+. Earlier versions had no timeout on `host preflight`. Upgrade or use:

```bash
timeout 20 kaseki-agent host preflight
```

---

## Further reading

| Topic | Doc |
|---|---|
| Full env-var reference | [ADVANCED_CONFIG.md](ADVANCED_CONFIG.md) |
| REST API reference | [API.md](API.md) |
| Docker Compose deployment | [DEPLOYMENT.md](DEPLOYMENT.md) |
| GitHub App setup | [AUTH_SETUP.md](AUTH_SETUP.md) |
| Distributed multi-host setup | [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) |
| Quality gates & allowlists | [QUALITY_GATES.md](QUALITY_GATES.md) |
| Troubleshooting | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| CLI monitoring tool | [CLI.md](CLI.md) |
| Migration from old setup paths | [MIGRATION.md](MIGRATION.md) |
