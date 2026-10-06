# Raspberry Pi Quick Start

This guide installs Kaseki Agent as a Docker Compose API service on Debian 12/13
or 64-bit Raspberry Pi OS. Host Node.js is not needed. Allow about 2 GiB of
free disk space for the initial image and run data.

## 1. Bootstrap a clean Pi

Run these commands on the Pi as your normal login user. The release bootstrap
installs Docker Engine and Compose from Docker's official Debian repository if
they are missing, verifies both release checksums, and starts the guided setup.
It invokes `sudo` only for system packages and host directory permissions.

```bash
if ! command -v curl >/dev/null 2>&1; then
  sudo apt-get update && sudo apt-get install -y ca-certificates curl
fi
curl -fsSL https://github.com/CyanAutomation/kaseki-agent/releases/latest/download/bootstrap-pi.sh \
  -o /tmp/kaseki-bootstrap-pi.sh
curl -fsSL https://github.com/CyanAutomation/kaseki-agent/releases/latest/download/bootstrap-pi.sh.sha256 \
  -o /tmp/bootstrap-pi.sh.sha256
(cd /tmp && sha256sum -c bootstrap-pi.sh.sha256)
bash /tmp/kaseki-bootstrap-pi.sh
```

The source bundle is installed in `~/kaseki-agent`. On a host that already has
a checkout, update that checkout and run `bash scripts/setup-pi.sh` there.

## 2. Enter provider settings

Kaseki needs the base URL for an OpenAI-compatible model gateway. Examples:

- Cloudflare AI Gateway: `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat`
- OpenAI API: `https://api.openai.com/v1`
- Ollama on your network: `http://<ollama-host-ip>:11434/v1`

The default model route is `dynamic/kaseki-agent`. Set `KASEKI_SETUP_LLM_GATEWAY_MODEL`
only when your gateway requires a provider-specific model identifier. Use a
base endpoint without embedded credentials, query parameters, or a fragment.

The gateway key is read silently into `~/secrets/llm_gateway_api_key` when that
file does not already exist. Kaseki creates its own API bearer token in
`~/secrets/kaseki_api_keys`. Setup does not infer the gateway URL from secret
filenames, put secret values in `.env`, or send an inference request. The
OpenRouter key is optional and is used only for configured evaluation stages;
GitHub App files are optional unless you use those operations.

The `/ready` check confirms that the local API started. It does not contact the
gateway, validate the provider key, or confirm that the selected model is
available; setup avoids a provider request that could incur cost.

You can provide the URL without putting a key in shell history:

```bash
KASEKI_SETUP_LLM_GATEWAY_URL='https://your-gateway.example/v1' \
  bash ~/kaseki-agent/scripts/setup-pi.sh
```

## 3. Confirm the API is ready

Setup pulls and pins the architecture-matched image digest, validates the
rendered Compose configuration, starts the service, and waits up to three
minutes for the container healthcheck to pass `/ready`. Docker displays layer
download progress. In the October 2026 Pi evaluation, Docker reported an image
size of about 546 MB and the uncached pull took a few minutes; actual transfer
time depends on the registry connection and cached layers.

```bash
cd ~/kaseki-agent
docker compose ps
curl http://127.0.0.1:8080/ready
bash scripts/setup-pi.sh --diagnose
```

The API listens on `127.0.0.1:8080` by default. From another computer, use an
SSH tunnel:

```bash
ssh -L 8080:127.0.0.1:8080 pi@<pi-address>
```

For direct LAN access, bind to the Pi's LAN IP and rerun setup:

```bash
cd ~/kaseki-agent
KASEKI_API_BIND_ADDRESS=192.168.88.200 bash scripts/setup-pi.sh
```

Restrict port 8080 in the host firewall to trusted clients and keep the bearer
token private. Kaseki mounts the Docker socket to create worker containers, so
an API token has broad control over host Docker and should be treated like a
host administrator credential. Setup warns about existing containers that
publish Docker management ports 2375 or 2376 and leaves those services alone.

## Credentials and permissions

The setup script stores the gateway key and API token in files under
`~/secrets`, sets directory mode `0750`, and sets file mode `0640` with access
for container GID 10000. `.env` stores only non-secret settings and the pinned
image digest. Do not place credentials in command arguments, environment
values, or `.env`.

## Troubleshooting and updates

- Run `bash scripts/setup-pi.sh --diagnose` to inspect Docker, disk space,
  secret filenames and permissions, published ports, and current health without
  changing the deployment or printing secret values.
- If startup fails, setup shows Compose status and startup logs after replacing
  values found in secret files. To inspect logs yourself, run
  `docker compose logs --tail=80 kaseki-api`.
- To update to the current `latest` image, run
  `KASEKI_API_IMAGE=docker.io/cyanautomation/kaseki-agent:latest bash scripts/setup-pi.sh`
  from the source checkout. The script records the newly pulled immutable
  digest in `.env`.
- On first boot, change the default `pi` password and configure SSH keys. The
  Kaseki setup does not alter SSH or existing Docker services.

For lower-level Compose options, see [DOCKER_SETUP.md](DOCKER_SETUP.md) and
[DEPLOYMENT.md](DEPLOYMENT.md).
