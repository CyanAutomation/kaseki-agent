# Deployment Guide

Kaseki Agent runs its API service and worker containers through Docker Compose.
The Compose deployment is the supported host setup; the npm package is a CLI
client and does not install the server by itself.

## Choose a deployment path

| Situation | Guide |
| --- | --- |
| Clean Debian 12/13 or 64-bit Raspberry Pi OS host | [Raspberry Pi quick start](QUICK_START.md) |
| Existing checkout or Compose host | [Docker setup](DOCKER_SETUP.md) |
| Multi-host or Kubernetes design | [Distributed setup](DISTRIBUTED_SETUP.md) |
| Connect a CLI workstation to the API | [npm setup](NPM_SETUP.md) |

The Pi quick start uses `scripts/setup-pi.sh`, installs Docker when needed,
configures secret files, pins the image digest, validates Compose, and waits
for the local `/ready` health check. Host Node.js is not required for this
deployment.

## Protect the API

The API mounts the Docker socket so it can start worker containers. Anyone who
can use its bearer token can therefore request operations with broad control
over the host's Docker daemon. Keep the API bound to loopback and connect over
an SSH tunnel unless trusted LAN access is required. If you expose it on a
network, bind it to a specific interface, restrict the port with a firewall,
and protect the token as an administrator credential.

Provider keys and API tokens belong in host secret files. The setup creates
separate files for the model gateway and Kaseki API keys; `.env` holds only
non-secret configuration and the pinned image digest. See [authentication
setup](AUTH_SETUP.md) and the [environment variable reference](ENV_VARS.md).

## Operate and update

From the deployment checkout:

```bash
docker compose ps
curl http://127.0.0.1:8080/ready
bash scripts/setup-pi.sh --diagnose
docker compose logs --tail=80 kaseki-api
```

To pull a newer image and record its immutable digest in `.env`:

```bash
KASEKI_API_IMAGE=docker.io/cyanautomation/kaseki-agent:latest \
  bash scripts/setup-pi.sh
```

The readiness endpoint confirms that the API started; it does not make an
inference request or verify gateway credentials or model availability. See
[troubleshooting](TROUBLESHOOTING.md) for failure diagnosis and the
[REST API reference](API.md) for service endpoints.

## Historical deployment material

The previous multi-mode deployment guide is retained as
[historical reference](archive/LEGACY_DEPLOYMENT_GUIDE.md). Its Node.js,
systemd, and manual-container examples describe fallback or older workflows;
use the linked current guides for a new deployment.
