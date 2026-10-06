---
name: docker-image-management
description: Maintain Kaseki's pinned multi-architecture Docker image and Pi deployment path
tags: [kaseki, docker, devops, image-management, ci-cd]
relatedSkills: [test-automation, dependency-cache-optimization, environment-configuration]
---

# Docker Image Management for Kaseki Agent

Use this guide when changing the image base, Pi CLI/toolchain versions,
multi-architecture builds, image size, or the Raspberry Pi Compose setup.

## Current image layout

- `Dockerfile` uses a digest-pinned `node:24-bookworm-slim` base. Read the
  `NODE_IMAGE` argument there for the current tag and digest; do not duplicate
  an old base version in documentation.
- `docker/image-toolchain/package.json` and its lockfile pin Pi CLI and server
  at `0.87.1` and pin npm, `undici`, and `brace-expansion`. The lockfile and
  registry verification scripts are the version source of truth.
- The image has a non-root runtime user UID/GID `10000:10000` and the Docker
  CLI. The API talks to the host daemon through `/var/run/docker.sock`; that
  mount gives the API broad control over the host Docker daemon.
- `.github/workflows/build-docker-image.yml` builds and verifies the
  `linux/amd64` and `linux/arm64` images before publishing `latest` and release
  tags to Docker Hub and GHCR.
- The Raspberry Pi setup pulls the architecture-matched tag, records its
  registry digest in the Compose `.env`, and uses the same immutable image for
  API and workers.

## Update the image toolchain

1. Update exact dependency versions in `docker/image-toolchain/package.json`.
2. Regenerate `docker/image-toolchain/package-lock.json` with npm and review
   changes in transitive dependencies.
3. Update any compatibility note in `Dockerfile` and this skill when its
   behavior or versions change.
4. Run the focused image checks, including
   `tests/docker-dependency-pins.test.sh`,
   `tests/dockerfile-npm-cache.test.sh`, and registry pin verification.
5. Use the Docker workflow to build and verify both architectures before
   publishing a release image.

The Dockerfile uses BuildKit cache mounts for npm downloads and a separate
workspace cache seed. Keep proxy CA material in BuildKit secrets rather than
Docker build arguments or image layers. Preserve `--strict-ssl=true` and the
dependency verification steps.

## Measure image changes

Record both local image size and a cold-pull measurement on `arm64` before and
after image-size work:

```bash
docker image inspect --format '{{.Size}}' docker.io/cyanautomation/kaseki-agent:latest
docker image rm docker.io/cyanautomation/kaseki-agent:latest
time docker pull docker.io/cyanautomation/kaseki-agent:latest
```

`docker image inspect .Size` is the local unpacked image size; it is not the
compressed registry transfer size. Pull time varies with network throughput
and cached layers. The October 2026 Raspberry Pi evaluation reported a local
image size of about 546 MiB and a cold pull lasting a few minutes. The setup
script keeps Docker's layer progress visible and prints the local image size.

Keep the current single image unless measurements show that an API-only
deployment or a safe runtime dependency removal materially reduces first-run
transfer. The runtime currently installs Debian's `docker.io` package even
though the API only needs a Docker client for the mounted host socket. Replacing
it with a CLI-only package is a candidate for a measured follow-up; check
package dependencies and run real arm64 worker-container integration before
removing it. Avoid adding a second API/worker image without evidence that the
normal Pi install transfers less data.

## Pi bootstrap and release assets

The release workflow publishes:

- `bootstrap-pi.sh` and `bootstrap-pi.sh.sha256`
- `kaseki-agent-source.tar.gz` and its `.sha256` sidecar

The user verifies the bootstrap script checksum. The script verifies the
matching source bundle before extraction, installs Docker Engine and Compose
from Docker's official Debian apt repository on Debian 12/13 or 64-bit
Raspberry Pi OS, checks free disk space, then runs `scripts/setup-pi.sh`.
Do not add the current user to the Docker group automatically; Docker group
membership grants root-equivalent daemon access. The setup uses direct Docker
access when available and falls back to sudo.

The guided Pi setup:

- Prompts for an OpenAI-compatible gateway base URL and hidden key. Never
  guess the endpoint from a key filename or send a paid inference request as a
  setup probe.
- Stores gateway and API credentials in host files and keeps them out of
  `.env`, process arguments, and container environment variables.
- Defaults the API to loopback, warns about published Docker management ports,
  validates Compose, and waits for the `/ready` healthcheck.
- Provides `bash scripts/setup-pi.sh --diagnose` for read-only setup status.

Coding inference uses the configured gateway. OpenRouter is optional for
evaluation stages, not a coding fallback. GitHub App files are optional unless
those operations are used.

## Useful commands

```bash
# Build for the local host architecture
docker build -t kaseki-agent:local .

# Inspect runtime identity and tool versions
docker run --rm --entrypoint node kaseki-agent:local --version
docker run --rm --entrypoint pi kaseki-agent:local --version
docker run --rm --entrypoint id kaseki-agent:local

# Pi setup tests
bash tests/pi-setup.test.sh
bash tests/pi-bootstrap.test.sh
```
