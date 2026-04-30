# Bump the pinned Node base image monthly with a security review.
FROM node:22.22.2-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c AS deps

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

WORKDIR /opt/kaseki/workspace-cache-seed
COPY docker/workspace-cache/package.json docker/workspace-cache/package-lock.json ./
RUN npm ci --ignore-scripts \
    && mkdir -p node_modules

RUN npm install -g @mariozechner/pi-coding-agent@0.70.2


FROM node:22.22.2-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git procps \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 kaseki \
    && useradd --system --uid 10001 --gid kaseki --create-home --home-dir /home/kaseki --shell /usr/sbin/nologin kaseki \
    && mkdir -p /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent /opt/kaseki/workspace-cache/default \
    && chown -R kaseki:kaseki /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent /opt/kaseki

ENV HOME=/tmp/kaseki-home \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    npm_config_cache=/tmp/npm-cache \
    PI_CODING_AGENT_DIR=/tmp/pi-agent \
    PI_TELEMETRY=0 \
    PI_SKIP_VERSION_CHECK=1 \
    CI=true

COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.js /usr/local/bin/pi
COPY --from=deps /opt/kaseki/workspace-cache-seed/node_modules /opt/kaseki/workspace-cache/default/node_modules

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run build

COPY Dockerfile .dockerignore README.md CLAUDE.md CONTRIBUTING.md STYLE.md ./
COPY kaseki run-kaseki.sh kaseki-agent.sh ./
COPY docs ./docs
COPY ops ./ops
COPY scripts ./scripts
COPY docker ./docker
COPY test ./test
RUN mkdir -p /app/lib \
    && cp dist/pi-event-filter.js /app/lib/pi-event-filter.js \
    && cp dist/pi-progress-stream.js /app/lib/pi-progress-stream.js \
    && cp dist/kaseki-report.js /app/lib/kaseki-report.js \
    && cp dist/kaseki-cli.js /app/kaseki-cli.js \
    && cp dist/kaseki-cli-lib.js /app/kaseki-cli-lib.js \
    && cp dist/github-app-token.js /app/lib/github-app-token.js \
    && chmod 0755 /app/kaseki /app/run-kaseki.sh /app/kaseki-agent.sh /app/scripts/*.sh

COPY kaseki-agent.sh /usr/local/bin/kaseki-agent
RUN install -m 0755 /app/lib/pi-event-filter.js /usr/local/bin/kaseki-pi-event-filter \
    && install -m 0755 /app/lib/pi-progress-stream.js /usr/local/bin/kaseki-pi-progress-stream \
    && install -m 0755 /app/lib/kaseki-report.js /usr/local/bin/kaseki-report \
    && install -m 0755 /app/lib/github-app-token.js /usr/local/bin/github-app-token
RUN ln -sf github-app-token /usr/local/bin/github-app-token.js
RUN chmod 0755 /usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.js \
    /usr/local/bin/kaseki-agent \
    /usr/local/bin/kaseki-pi-event-filter \
    /usr/local/bin/kaseki-pi-progress-stream \
    /usr/local/bin/kaseki-report \
    /usr/local/bin/github-app-token \
    /usr/local/bin/github-app-token.js

WORKDIR /workspace
USER kaseki
ENTRYPOINT ["/usr/local/bin/kaseki-agent"]

# The runner initializes these logs before long-running work starts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD test -f /results/stdout.log && test -f /results/stderr.log
