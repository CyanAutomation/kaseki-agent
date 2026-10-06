# Docker Setup

The supported Pi deployment runs the `kaseki-api` service with Docker Compose.
The API container launches short-lived worker containers from the same pinned
Kaseki image. It needs the host Docker socket, a mounted workspace, and secret
files.

For a clean Raspberry Pi, follow [QUICK_START.md](QUICK_START.md). The release
bootstrap checks the OS and architecture, installs Docker Engine and Compose
when needed, checks disk space, verifies its release bundle checksum, and runs
the setup script. Docker is installed from the official Docker Debian apt
repository on Debian 12/13 and 64-bit Raspberry Pi OS.

## Existing Docker host

From a repository checkout:

```bash
bash scripts/setup-pi.sh
```

The setup script:

1. Checks Docker Engine and Compose access, including sudo fallback.
2. Prompts for an OpenAI-compatible gateway base URL and a hidden key when
   neither is already configured.
3. Stores provider and API credentials only in host files and sets the access
   required by the container's UID/GID 10000.
4. Creates `/agents` paths and checks for port conflicts and published Docker
   management endpoints.
5. Pulls the image for the host architecture, records its immutable registry
   digest in `.env`, and checks `docker compose config`.
6. Starts Compose and waits up to three minutes for the container's `/ready`
   healthcheck to pass.

Setup does not make an inference request. The gateway URL is required because
it cannot be determined from the API key. The default model is
`dynamic/kaseki-agent`. OpenRouter credentials are optional and used only for
evaluation stages; GitHub App credentials are optional unless those features
are used.

The `/ready` healthcheck confirms the local API is running. It does not contact
the gateway or validate provider authentication/model availability; setup
avoids a provider request that could incur cost.

## Provider and secret files

Supported gateway URL examples include:

- Cloudflare AI Gateway: `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat`
- OpenAI: `https://api.openai.com/v1`
- Ollama on a LAN host: `http://<host-ip>:11434/v1`

The key is stored at `~/secrets/llm_gateway_api_key`. Kaseki creates
`~/secrets/kaseki_api_keys` for API bearer authentication. Existing files are
reused without displaying their contents. The directory is mode `0750`, files
are mode `0640`, and group 10000 can read them. `.env` contains the gateway URL,
model, image digest, and host settings, but no credential values.

To use a different credential file:

```bash
KASEKI_SETUP_LLM_GATEWAY_API_KEY_FILE=/path/to/gateway-key \
  bash scripts/setup-pi.sh
```

Keep credentials out of URL userinfo and environment variables. The setup
script rejects gateway URLs with credentials, query parameters, or fragments.

## API network access

Compose binds to `127.0.0.1:8080` by default. An SSH tunnel provides access
from a trusted workstation without exposing the port on the LAN:

```bash
ssh -L 8080:127.0.0.1:8080 pi@<pi-address>
```

For direct LAN access, configure a specific host interface and rerun setup:

```bash
KASEKI_API_BIND_ADDRESS=192.168.88.200 bash scripts/setup-pi.sh
```

Restrict port 8080 in the host firewall and use the bearer token from
`~/secrets/kaseki_api_keys`. The mounted Docker socket allows the API to manage
host containers; protect the API token as a host administrator credential.
Do not expose the Docker daemon on port 2375/2376 without strong access
controls. Setup reports existing published Docker management ports but does
not stop or reconfigure containers.

## Diagnostics and common commands

```bash
bash scripts/setup-pi.sh --diagnose  # no changes; prints no credential values
docker compose ps
docker compose logs --tail=80 kaseki-api
curl http://127.0.0.1:8080/ready
```

On a startup failure, the setup script shows Compose status and redacts values
read from secret files before printing the last 80 log lines. If a manual
review is needed, Compose logs may contain application configuration details;
inspect them before sharing.

To update the image from a source checkout, set the tag for one setup run. The
script pulls it and writes the immutable digest to `.env`:

```bash
KASEKI_API_IMAGE=docker.io/cyanautomation/kaseki-agent:latest \
  bash scripts/setup-pi.sh
```

For environment variables and alternative deployment modes, see
[ENV_VARS.md](ENV_VARS.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
