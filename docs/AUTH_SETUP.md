# Authentication Setup Guide

> **NPM CLI note:** `kaseki-agent run`, `list`, `report`, `status`, and `stop`/`cancel` are API-backed commands. Configure service-side `KASEKI_API_KEYS` for `kaseki-agent serve` and client-side `KASEKI_API_URL` / `KASEKI_API_KEY` for the npm task commands.

This guide covers how to configure authentication credentials for Kaseki Agent, including OpenRouter API keys and GitHub App credentials.

## Quick Start (Choose One)

### Option 1: Config File (Recommended - Persistent)

1. Create config directory:

   ```bash
   mkdir -p ~/.kaseki
   ```

2. Create `~/.kaseki/config.json`:

   ```json
   {
     "auth": {
       "openrouter_api_key_file": "/home/pi/secrets/openrouter_api_key",
       "github_app_id": "123456",
       "github_app_client_id": "Iv1.public-client-id",
       "github_app_private_key_file": "/home/pi/secrets/github_app_private_key"
     }
   }
   ```

3. Replace the public ID examples with your app's IDs and update the private-key path:

   ```bash
   # Example: if your secrets are in ~/secrets/
   cat > ~/.kaseki/config.json << 'EOF'
   {
     "auth": {
       "openrouter_api_key_file": "/home/pi/secrets/openrouter_api_key",
       "github_app_id": "123456",
       "github_app_client_id": "Iv1.public-client-id",
       "github_app_private_key_file": "/home/pi/secrets/github_app_private_key"
     }
   }
   EOF
   ```

4. Run kaseki (no env vars needed):

   ```bash
   kaseki-agent run https://github.com/CyanAutomation/kaseki-agent main "Your task here"
   ```

**Advantages:**

- Persistent across multiple runs
- No need to set env vars each time
- Works with `sudo` (no `sudo -E` needed)
- Supports project-local overrides (./kaseki-agent.json)

### Option 2: Environment Variables (CLI with or without sudo)

#### Without sudo

```bash
export OPENROUTER_API_KEY_FILE=/home/pi/secrets/openrouter_api_key
export GITHUB_APP_ID=123456
export GITHUB_APP_CLIENT_ID=Iv1.public-client-id
export GITHUB_APP_PRIVATE_KEY_FILE=/home/pi/secrets/github_app_private_key

kaseki-agent run https://github.com/CyanAutomation/kaseki-agent main "Your task here"
```

#### With sudo (preserve env vars using `-E`)

```bash
export OPENROUTER_API_KEY_FILE=/home/pi/secrets/openrouter_api_key
export GITHUB_APP_ID=123456
export GITHUB_APP_CLIENT_ID=Iv1.public-client-id
export GITHUB_APP_PRIVATE_KEY_FILE=/home/pi/secrets/github_app_private_key

# Use -E flag to preserve environment variables
sudo -E kaseki-agent run https://github.com/CyanAutomation/kaseki-agent main "Your task here"
```

**Important:** Without the `-E` flag, `sudo` strips the environment variables. Always use `sudo -E` when relying on env vars.

**Advantages:**

- Works immediately for one-off runs
- Useful for CI/CD pipelines
- Can be scripted easily

**Disadvantages:**

- Must set env vars for each shell session
- Requires `sudo -E` when running with sudo
- Harder to manage in production

### Option 3: Docker Compose (Recommended for Services)

Use Docker Compose for persistent, managed deployments. The service passes the public App IDs as environment values and mounts the private key as a secret file.

See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for full Docker Compose setup with:

- Secret file mounting
- Environment variable configuration
- Health checks and logging
- Persistent volume management

## Configuration File Reference

### Location Resolution Order

Kaseki Agent looks for configuration in this order (highest to lowest priority):

1. **Explicit config file path** — passed via CLI
2. **Project config** — `./kaseki-agent.json` in current directory
3. **User config** — `~/.kaseki/config.json` (home directory)
4. **Environment variables** — `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, and `GITHUB_APP_PRIVATE_KEY_FILE`.
5. **Built-in defaults** — hardcoded fallbacks

### Full Auth Schema

```json
{
  "auth": {
    "openrouter_api_key_file": "/path/to/openrouter_key",
    "github_app_id": "123456",
    "github_app_client_id": "Iv1.public-client-id",
    "github_app_private_key_file": "/path/to/github_app_private_key"
  }
}
```

File paths are **absolute** or relative to the current working directory.

## Secret File Setup

Your auth files should contain just the credential value, one per file:

```bash
# Create secret files with appropriate permissions
mkdir -p ~/secrets
sudo chgrp 10000 ~/secrets
chmod 0750 ~/secrets

# OpenRouter API Key (get from https://openrouter.ai/keys)
echo "sk-or-..." > ~/secrets/openrouter_api_key
sudo chgrp 10000 ~/secrets/openrouter_api_key
chmod 0640 ~/secrets/openrouter_api_key

# GitHub App ID and Client ID are public configuration values, not secret files.
# Set GITHUB_APP_ID and GITHUB_APP_CLIENT_ID in .env or the service environment.

# GitHub App Private Key (PEM format, usually multi-line)
cat > ~/secrets/github_app_private_key << 'EOF'
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----
EOF
sudo chgrp 10000 ~/secrets/github_app_private_key
chmod 0640 ~/secrets/github_app_private_key
```

### Single-line/text PEM private keys

The preferred GitHub App private key setup is still file based: paste the PEM
text value into a dedicated secret file such as
`/run/secrets/kaseki/github_app_private_key` inside a service container (the host
source defaults to `~/secrets/github_app_private_key`) or
`~/.kaseki/secrets/github_app_private_key` for local use, then configure
`github_app_private_key_file` or `GITHUB_APP_PRIVATE_KEY_FILE` to point at that
file.

The private key reader normalizes common pasted formats. The secret file may
contain the original multi-line PEM, escaped `\n` newlines, a base64-encoded
PEM, or a single-line PEM where spaces separate the PEM header, body, and footer.

`GITHUB_APP_PRIVATE_KEY` is only for local `run-kaseki.sh` experiments. It may
be rejected by config-file and API service flows that enforce file-based
secrets, so prefer `GITHUB_APP_PRIVATE_KEY_FILE` outside those local
experiments.

> **Security warning:** Do not paste real private keys into tickets, prompts,
> logs, `.env` files, or source control. If a GitHub App private key is exposed,
> regenerate it in the GitHub App settings and update the secret file anywhere
> the old key was installed.

## Troubleshooting

### "Auth validation failed: Missing..."

Run the health check to get detailed guidance:

```bash
kaseki-agent doctor
```

The output will suggest all three approaches (env vars, config file, docker-compose).

### GitHub App IDs in Docker Compose

Set `GITHUB_APP_ID` and `GITHUB_APP_CLIENT_ID` in the project `.env` file or
export them in the shell before running Compose. They are public identifiers,
so the secrets command does not manage or permission-check them. Keep only the
App private key in `~/secrets/github_app_private_key`. Existing deployments
with `github_app_id` and `github_app_client_id` files continue to work as a
legacy fallback during migration.

### Sudo environment variables not working

If you're using `sudo` without the `-E` flag, environment variables are stripped:

```bash
# ❌ WRONG — env vars are lost
sudo kaseki-agent run ...

# ✅ CORRECT — preserve env vars
sudo -E kaseki-agent run ...

# ✅ BETTER — use config file (no sudo -E needed)
# With ~/.kaseki/config.json configured:
sudo kaseki-agent run ...
```

### Permission denied on secret files

Ensure files are readable by the kaseki-agent user:

```bash
# Normalize all Docker host secrets at once
sudo chgrp -R 10000 ~/secrets
chmod 0750 ~/secrets
chmod 0640 ~/secrets/*
```

### Config file not being loaded

Verify the path and format:

```bash
# Check if ~/.kaseki/config.json exists
ls -la ~/.kaseki/config.json

# Validate JSON syntax
cat ~/.kaseki/config.json | jq .

# Or check via debug output
kaseki-agent doctor --verbose
```

### Project-local config override

Create `./kaseki-agent.json` in your project directory to override user config:

```json
{
  "auth": {
    "github_app_id": "123456",
    "github_app_client_id": "Iv1.public-client-id"
  }
}
```

This takes precedence over `~/.kaseki/config.json`.

## Security Best Practices

1. **Restrict file permissions:**

   ```bash
   sudo chgrp -R 10000 ~/secrets
   chmod 0750 ~/secrets
   chmod 0640 ~/secrets/*
   ```

2. **Use separate credential files** — don't mix secrets in one file

3. **Don't commit secrets** to version control:

   ```bash
   echo "~/secrets/*" >> ~/.gitignore
   echo "./kaseki-agent.json" >> .gitignore  # if it contains real paths
   ```

4. **Rotate credentials regularly** — especially GitHub App private keys

5. **Use config files for local development**, env vars for CI/CD

6. **Docker Compose:** Keep private credentials in secret mounts; configure public GitHub App IDs through environment values.

## Integration Examples

### Local development (config file)

```bash
mkdir -p ~/.kaseki
cat > ~/.kaseki/config.json << 'EOF'
{ "auth": { "openrouter_api_key_file": "~/secrets/openrouter" } }
EOF

kaseki-agent run <repo> <branch> <task>
```

### CI/CD pipeline (environment variables)

```bash
# In GitHub Actions, GitLab CI, or similar
export OPENROUTER_API_KEY_FILE=/tmp/openrouter_key
export GITHUB_APP_ID=123456
export GITHUB_APP_CLIENT_ID=Iv1.public-client-id
# ... etc

kaseki-agent run <repo> <branch> <task>
```

### Docker Compose service

```yaml
services:
  kaseki-api:
    environment:
      GITHUB_APP_ID: "${GITHUB_APP_ID:-}"
      GITHUB_APP_CLIENT_ID: "${GITHUB_APP_CLIENT_ID:-}"
      GITHUB_APP_PRIVATE_KEY_FILE: /run/secrets/kaseki/github_app_private_key
    volumes:
      - /home/pi/secrets:/run/secrets/kaseki:ro
```

See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for full examples.

## Related Documentation

- [docs/DEVELOPMENT.md](DEVELOPMENT.md) — Local development setup
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — Docker Compose service deployment
- [CLAUDE.md](../CLAUDE.md) — Architecture and environment variables reference
