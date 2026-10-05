# Raspberry Pi 4 Setup Evaluation

## Result

The setup experience has been streamlined in this checkout, and the Pi's
Docker prerequisites, image, agent directories, and secret files are prepared.
The Kaseki API remains stopped because the Pi has no configured
`LLM_GATEWAY_URL`. No provider call or model inference was sent.

## Pi baseline

- Raspberry Pi 4, Debian 13, aarch64, 4 CPUs, approximately 3.7 GiB RAM, and
  about 37 GB free disk space at the start of setup.
- Docker 29.6 and Docker Compose 5.1.4 were already installed. Host Node.js is
  v20.19.2, below Kaseki's Node.js 24 requirement; the new Pi install path
  avoids host Node.js entirely.
- The device was not blank: `hawser-senku` had been running for about eight
  weeks and published port 2375 on all interfaces. It has a token configured,
  but no TLS certificate/key configuration was present. An unauthenticated
  `/version` request returned HTTP 401. The existing container was left intact.
- The host already had provider, API, and GitHub secret files under
  `/home/pi/secrets`. Their values were not displayed. File access was tested
  from the Kaseki image and the directory/files were restricted to the host
  user and container group 10000.
- The ARM64 Kaseki image was pulled and pinned in the Pi's ignored `.env` file.
  The image occupied approximately 2.9 GB, making the first download the
  longest setup step.

The first API start stopped at Kaseki's startup guard:

```text
LLM_GATEWAY_URL is required for KASEKI_PROVIDER=gateway
```

The missing URL caused repeated restart attempts under the previous Compose
policy. The service was stopped after diagnosing this. The provider key file
exists, but the endpoint (and any non-default model name) is not configured.

## Improvements implemented

1. **One Pi setup command without host Node.js.** `scripts/setup-pi.sh` checks
   Docker and Compose, asks for the gateway URL, reads a missing provider key
   without echoing it, creates a separate random API bearer key, prepares
   `/agents`, and starts Compose only after `docker compose config --quiet`
   succeeds.
2. **Credentials stay in files.** The installer stores provider and API keys
   under `~/secrets`, applies directory mode `0750` and file mode `0640`, and
   grants the container's GID 10000 read access. Inline credential variables
   in `.env` stop setup with an actionable message. Compose and the standalone
   CLI launcher mount secrets as files instead of putting API tokens in
   `docker inspect` environment data.
3. **Optional GitHub credentials.** The CLI quickstart no longer blocks on
   GitHub App files. Those files are only needed for GitHub App operations.
4. **Configuration reaches workers.** Compose now passes the provider, gateway
   URL, gateway model, Kaseki model, and the same image revision to worker
   containers. The Pi installer pulls the architecture-appropriate image and
   records its registry digest for repeatable API and worker runs.
5. **Safer defaults and clearer failures.** Compose and the CLI launcher bind
   the host API port to loopback by default, use one concurrent run, and stop
   after three startup failures. The installer checks for Docker containers
   already publishing the selected port. Readiness checks allow up to two
   minutes for slower hosts.
6. **Secret path and setup docs aligned.** `setup-secrets.sh`, `.env.example`,
   `.env.template`, `QUICK_START.md`, `DEPLOYMENT.md`, and the README now point
   at the same host secret directory and Compose flow. The manual Docker and
   systemd examples also mount secret files, bind to loopback, and keep
   credentials out of environment values. Old advice to make `/agents`
   world-writable was removed.
7. **Faster image rebuilds.** Dockerfile `npm ci` layers use BuildKit's npm
   cache, so source or lockfile changes can reuse downloaded packages.

## Verification

- Full unit suite and production build: `npm run test:unit`.
- Targeted Pi setup and Dockerfile cache contract tests.
- TypeScript type-check, ESLint, and generated environment-doc check.
- Shell syntax checks for the Pi installer and secret setup scripts.
- Re-ran the Pi setup and Dockerfile cache contract tests after updating the
  fallback deployment examples; both pass.

The BuildKit cache speeds image rebuilds; it does not reduce the approximately
2.9 GB Pi image download. Splitting the API and worker images would not remove
that download for a normal installation because Kaseki still needs the worker
image to execute tasks; it would add a second image to publish and verify. Keep
the single image until an API-only deployment or a measured worker-image trim
can make the first-run transfer smaller.

## Next input needed to start Kaseki on this Pi

Provide the OpenAI-compatible gateway base URL. The model defaults to
`dynamic/kaseki-agent`; provide a different model identifier if the gateway
requires one. The provider key is already present on the Pi. To reach the API
from another LAN device after setup, set `KASEKI_API_BIND_ADDRESS` to
`192.168.88.200`; otherwise the safe default is localhost-only.

The existing Hawser service controls Docker on this host and is separate from
Kaseki. It should be reviewed for TLS or firewall restrictions without
interrupting its current management client.
