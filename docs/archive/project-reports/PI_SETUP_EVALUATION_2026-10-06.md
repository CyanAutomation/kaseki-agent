# Raspberry Pi Setup Evaluation — 2026-10-06

## Summary

The Pi is reachable at `192.168.88.200`, but it was not a blank host. Docker
and Compose were already installed, existing secret files were present, and a
separate `hawser-senku` container published Docker's management port 2375 on
all interfaces. The Kaseki API was not started because the gateway URL was not
configured and cannot be derived from a credential file. No provider request
or model inference was sent.

The published Kaseki image pulled successfully for ARM64, but the
checkout-based setup still assumed Docker was preinstalled and claimed success
immediately after `docker compose up -d`. The working tree now addresses that
first-run gap with a verified bootstrap and a bounded readiness check. Those
changes are in this branch; they have not been installed on the Pi.

## Host findings

- Raspberry Pi 4, Debian 13, ARM64, 4 CPUs, about 3.7 GiB RAM, and 35 GiB free
  on a 59 GiB root filesystem.
- Docker Engine 29.6 and Compose 5.1.4 were already installed. Node.js 24.16
  was present, though the Compose setup does not need host Node.js.
- `hawser-senku` had been running for about two months and published host port
  2375 on IPv4 and IPv6 all-interface addresses. Kaseki setup did not modify
  this existing container.
- `/home/pi/secrets` already contained non-empty gateway, OpenRouter, Kaseki
  API, and GitHub App credential files. Their values were not displayed. The
  directory was mode `0750`; files were mode `0640` and group 10000.
- No `LLM_GATEWAY_URL` was found. A gateway key filename does not identify its
  provider endpoint or model route.
- The Kaseki API image was refreshed for ARM64 and pinned to
  `sha256:aeaed632715279b951c8760b74bb344c7353c23c6cdb014765881ff3cd3f5ad1`.
  Docker reported a local image size of about 546 MB; the uncached pull took a
  few minutes. Node 24.21.0, Pi CLI 0.87.1, UID 10000, and Compose validation
  were confirmed in the image/configuration checks.
- The Pi checkout remains at `/home/pi/kaseki-agent`, commit `27bde21`. The
  repository checkout used for this work was reset to current `origin/main`
  before implementation.

## Improvements made in the repository

1. **Clean-host bootstrap:** Added `scripts/bootstrap-pi.sh` for Debian 12/13
   and 64-bit Raspberry Pi OS. It checks free space, installs Docker Engine
   and Compose from Docker's official Debian apt repository when needed,
   verifies the downloaded release source bundle with SHA-256, and runs the
   existing guided setup. It does not add users to the root-equivalent Docker
   group.
2. **Release integrity:** The release workflow now publishes the bootstrap
   script and its checksum plus the source bundle and its checksum. The remote
   setup helper downloads and verifies the release bootstrap, then prompts on
   the Pi; it no longer accepts an API key as a positional argument.
3. **Guided, secret-safe setup:** The setup script explains gateway URLs and
   shows Cloudflare, OpenAI, and Ollama examples. It preserves the hidden
   key-file flow, rejects credentials in gateway URL userinfo/query/fragment,
   documents the default model, and makes LAN exposure an explicit interactive
   choice while retaining loopback by default. The readiness check is local;
   setup does not contact the provider or send an inference request.
4. **Readiness and recovery:** Setup shows stages, prints the pinned digest and
   local image size, validates Compose before starting, and waits up to 180
   seconds for the `/ready` healthcheck. On startup failure it prints Compose
   status and redacts exact values read from secret files before showing recent
   logs. `--diagnose` reports configuration, permissions, port use, free disk,
   and health without printing secret values or changing the deployment. The
   script atomically saves non-secret settings before the image pull, so a
   rerun can reuse them and Docker's cached layers after an interrupted pull.
5. **Host security:** Setup warns about published Docker management ports and
   explains that access to the mounted Docker socket gives Kaseki broad host
   control. Documentation recommends SSH tunneling by default, firewall
   restrictions for LAN access, bearer-token protection, and first-boot SSH
   key/password hardening.
6. **Documentation consistency:** Replaced obsolete Pi/OpenRouter setup
   recipes with one Compose path. The docs and skills distinguish gateway
   coding inference from optional OpenRouter evaluation, clarify that GitHub
   App credentials are optional, and direct clean Pi installs to the verified
   bootstrap.
7. **Image measurement:** Preserved the current single multi-architecture
   image and kept Docker pull progress visible. The local image footprint is
   reported, but Docker's local image size is not mislabeled as compressed
   registry transfer size. A Docker CLI-only package remains a measured
   follow-up because changing the runtime package without an ARM64 worker test
   could break job execution.

## Verification

Test-first shell contract coverage was added for successful readiness,
diagnostic read-only behavior, Docker management-port warnings, startup log
redaction, bootstrap/release checksums, and removal of API-key positional
arguments from the remote helper. The new bootstrap test is included in
`test:ci`.

The Pi itself has not been reconfigured by these repository changes. A public
bootstrap URL will work after this branch is merged and a GitHub release
publishes the new release assets. The Kaseki API remains stopped until the
gateway base URL is supplied and setup is run on the Pi.
