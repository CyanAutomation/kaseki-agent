FROM node:22.22.2-bookworm-slim@sha256:db9a3a15e8e8e2adbaf1e1c3d93dfb04c2e294bdd027490addb2391b8e61cc6a # bump monthly with security review

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git procps \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 kaseki \
    && useradd --system --uid 10001 --gid kaseki --create-home --home-dir /home/kaseki --shell /usr/sbin/nologin kaseki \
    && mkdir -p /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent \
    && chown -R kaseki:kaseki /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent

ENV HOME=/tmp/kaseki-home \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    npm_config_cache=/tmp/npm-cache \
    PI_CODING_AGENT_DIR=/tmp/pi-agent \
    PI_TELEMETRY=0 \
    PI_SKIP_VERSION_CHECK=1 \
    CI=true

RUN npm install -g @mariozechner/pi-coding-agent@0.70.2

COPY kaseki-agent.sh /usr/local/bin/kaseki-agent
COPY pi-event-filter.js /usr/local/bin/kaseki-pi-event-filter
RUN chmod 0755 /usr/local/bin/kaseki-agent /usr/local/bin/kaseki-pi-event-filter

WORKDIR /workspace
USER kaseki
ENTRYPOINT ["/usr/local/bin/kaseki-agent"]

# The run writes /results/exit_code during shutdown; probe fails until that marker exists.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD test -f /results/exit_code && exit 0 || exit 1
