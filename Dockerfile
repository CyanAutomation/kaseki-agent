FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git procps \
    && rm -rf /var/lib/apt/lists/*

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
ENTRYPOINT ["/usr/local/bin/kaseki-agent"]
