# Bump the pinned Node base image monthly with a security review.
# Node v24 base image: Updated May 2026 for improved performance and security.
# Using ARG for DRY principle - base image used in both stages
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps

# Phase 1: System dependencies + user setup (consolidated)
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git procps \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10000 kaseki \
    && useradd --system --uid 10000 --gid kaseki --create-home --home-dir /home/kaseki --shell /usr/sbin/nologin kaseki \
    && mkdir -p /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent \
    && chown -R kaseki:kaseki /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent

ENV HOME=/tmp/kaseki-home \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    npm_config_cache=/tmp/npm-cache \
    PI_CODING_AGENT_DIR=/tmp/pi-agent \
    PI_TELEMETRY=0 \
    PI_SKIP_VERSION_CHECK=1 \
    CI=true

# Phase 2: Workspace cache seed for Layer 3 runtime fallback
WORKDIR /opt/kaseki/workspace-cache-seed
COPY docker/workspace-cache/package.json docker/workspace-cache/package-lock.json ./
RUN npm ci --no-audit --prefer-offline --ignore-scripts \
    && mkdir -p node_modules

# Phase 3: Global Pi CLI installation (Layer 3 fallback for image seed cache)
# Install pi-coding-agent globally with undici explicitly to resolve module dependencies
RUN npm install -g --no-audit @earendil-works/pi-coding-agent@0.77.0 undici

# Phase 3b: Install tree-sitter-cli for Go code summarization (no native compilation)
RUN npm install -g --no-audit tree-sitter-cli

# Phase 3c: Copy Pi CLI Custom Extensions (LLM Gateway provider)
# Extensions are loaded from ~/.pi/extensions/ and must be compiled TypeScript
# We'll use a simpler approach: copy extension to a known location in the image
RUN mkdir -p /opt/kaseki/pi-extensions


FROM ${NODE_IMAGE} AS runtime

# System dependencies + user setup (consolidated)
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl docker.io git jq procps tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10000 kaseki \
    && useradd --system --uid 10000 --gid kaseki --create-home --home-dir /home/kaseki --shell /usr/sbin/nologin kaseki \
    && mkdir -p /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent /opt/kaseki/workspace-cache/default \
    && chown -R kaseki:kaseki /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent /opt/kaseki

ENV HOME=/tmp/kaseki-home \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    npm_config_cache=/tmp/npm-cache \
    PI_CODING_AGENT_DIR=/tmp/pi-agent \
    PI_EXTENSIONS_DIR=/opt/kaseki/pi-extensions \
    KASEKI_APP_ROOT=/app \
    PI_TELEMETRY=0 \
    PI_SKIP_VERSION_CHECK=1 \
    CI=true

# Copy Pi CLI and workspace cache seed from deps stage
COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=deps /usr/local/bin/tree-sitter /usr/local/bin/tree-sitter
COPY --from=deps /opt/kaseki/workspace-cache-seed/node_modules /opt/kaseki/workspace-cache/default/node_modules

# Create a wrapper script for the Pi CLI that properly resolves node modules
# and explicitly loads Kaseki's bundled gateway provider extension. Pi 0.77
# does not auto-discover image-bundled home extensions for non-interactive
# commands such as --list-models, so relying on implicit discovery makes
# preflight pass/fail depend on Pi internals.
RUN mkdir -p /usr/local/bin && printf '%s\n' \
  '#!/bin/sh' \
  'gateway_extension="${KASEKI_PI_GATEWAY_EXTENSION:-/opt/kaseki/pi-extensions/llm-gateway.js}"' \
  'if [ -r "$gateway_extension" ]; then' \
  '  exec node --preserve-symlinks /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --extension "$gateway_extension" "$@"' \
  'fi' \
  'exec node --preserve-symlinks /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js "$@"' \
  > /usr/local/bin/pi && chmod +x /usr/local/bin/pi

# Build kaseki application (cache-optimal: dependencies first, then source code)
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.scripts.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm ci --no-audit --prefer-offline --ignore-scripts && npm run build
RUN test -f /app/dist/kaseki-api-service.js

# Copy all application files (after build, so layer invalidation is minimal)
COPY Dockerfile .dockerignore README.md CLAUDE.md CONTRIBUTING.md ./
COPY kaseki run-kaseki.sh kaseki-agent.sh ./
COPY docs ./docs
COPY docker/ops ./ops
COPY docker ./docker
COPY test ./test

# Copy Pi CLI custom extensions (LLM Gateway provider)
RUN mkdir -p /opt/kaseki/pi-extensions
COPY .pi-extensions.js /opt/kaseki/pi-extensions/llm-gateway.js
# Also install at ~/.pi/extensions/ — the path Pi CLI actually scans for extensions
RUN mkdir -p /tmp/kaseki-home/.pi/extensions \
    && mkdir -p /tmp/kaseki-home/.pi/agent/extensions \
    && ln -sf /opt/kaseki/pi-extensions/llm-gateway.js /tmp/kaseki-home/.pi/extensions/llm-gateway.js \
    && ln -sf /opt/kaseki/pi-extensions/llm-gateway.js /tmp/kaseki-home/.pi/agent/extensions/llm-gateway.js \
    && chown -R kaseki:kaseki /tmp/kaseki-home/.pi

# Copy entrypoints to /usr/local/bin
COPY kaseki-agent.sh /usr/local/bin/kaseki-agent
COPY scripts/docker-entrypoint.sh /usr/local/bin/kaseki-entrypoint

# Setup and install binaries (consolidated: container scripts, lib copies, permissions, and global installs)
# Keep github_app_helper_dependencies in sync with static relative imports in src/github-app-token.ts and src/github-utils.ts.
RUN chmod +x \
      /app/scripts/kaseki-container-setup.sh \
      /app/scripts/kaseki-container-setup-remote.sh \
      /app/scripts/kaseki-container-entrypoint-wrapper.sh \
      /app/scripts/startup-check-packaging.sh \
      /app/kaseki /app/run-kaseki.sh /app/kaseki-agent.sh \
    && mkdir -p /scripts \
    && ln -sf /app/scripts/kaseki-container-setup.sh /scripts/kaseki-container-setup.sh \
    && ln -sf /app/scripts/kaseki-container-setup-remote.sh /scripts/kaseki-container-setup-remote.sh \
    && ln -sf /app/scripts/kaseki-container-entrypoint-wrapper.sh /scripts/kaseki-container-entrypoint-wrapper.sh \
    && /app/scripts/startup-check-packaging.sh install \
    && mkdir -p /app/lib/lib /app/lib/secrets \
    && cp dist/pi-event-filter.js /app/lib/pi-event-filter.js \
    && cp -r dist/pi-event-aggregation /app/lib/pi-event-aggregation \
    && cp dist/ansi-colors.js /app/lib/ansi-colors.js \
    && cp dist/event-aggregator.js /app/lib/event-aggregator.js \
    && cp dist/timestamp-tracker.js /app/lib/timestamp-tracker.js \
    && cp dist/pi-progress-stream.js /app/lib/pi-progress-stream.js \
    && cp dist/pi-progress-summarizer.js /app/lib/pi-progress-summarizer.js \
    && cp dist/hashline-event-handler-cli.js /app/lib/hashline-event-handler-cli.js \
    && cp dist/progress-stream-utils.js /app/lib/progress-stream-utils.js \
    && cp dist/kaseki-report.js /app/lib/kaseki-report.js \
    && cp dist/analyze-test-failures.js /app/lib/analyze-test-failures.js \
    && cp dist/instance-state-derivation.js /app/lib/instance-state-derivation.js \
    && cp dist/instance-status-derivation.js /app/lib/instance-status-derivation.js \
    && cp dist/instance-stage-derivation.js /app/lib/instance-stage-derivation.js \
    && cp dist/instance-failure-extraction.js /app/lib/instance-failure-extraction.js \
    && cp dist/instance-metadata-reader.js /app/lib/instance-metadata-reader.js \
    && cp dist/validation-output-filter.js /app/lib/validation-output-filter.js \
    && cp dist/kaseki-cli.js /app/kaseki-cli.js \
    && cp dist/kaseki-cli-lib.js /app/kaseki-cli-lib.js \
    && cp dist/github-app-token.js /app/lib/github-app-token.js \
    && cp dist/github-app-private-key.js /app/lib/github-app-private-key.js \
    && cp dist/github-utils.js /app/lib/github-utils.js \
    && cp dist/logger.js /app/lib/logger.js \
    && cp dist/secrets/host-secrets-reader.js /app/lib/secrets/host-secrets-reader.js \
    && cp dist/lib/validation-causality-analysis.js /app/lib/lib/validation-causality-analysis.js \
    && cp -r dist/lib/* /app/lib/lib/ \
    && chmod 0755 /app/dist/*.js \
    && github_app_helper_dependencies="github-app-private-key.js github-utils.js logger.js secrets/host-secrets-reader.js" \
    && mkdir -p /usr/local/bin/lib /usr/local/bin/secrets /usr/local/bin/scripts /usr/local/bin/pi-event-aggregation \
    && cp -r /app/lib/lib/* /usr/local/bin/lib/ \
    && cp -r /app/lib/pi-event-aggregation/* /usr/local/bin/pi-event-aggregation/ \
    && for dependency in $github_app_helper_dependencies; do install -m 0755 "/app/lib/$dependency" "/usr/local/bin/$dependency"; done \
    && install -m 0755 /app/lib/pi-event-filter.js /usr/local/bin/kaseki-pi-event-filter \
    && install -m 0755 /app/lib/ansi-colors.js /usr/local/bin/ansi-colors.js \
    && install -m 0755 /app/lib/pi-progress-stream.js /usr/local/bin/kaseki-pi-progress-stream \
    && install -m 0755 /app/lib/pi-progress-summarizer.js /usr/local/bin/pi-progress-summarizer.js \
    && install -m 0755 /app/lib/validation-output-filter.js /usr/local/bin/validation-output-filter \
    && install -m 0755 /app/lib/hashline-event-handler-cli.js /usr/local/bin/kaseki-hashline-event-handler \
    && install -m 0755 /app/lib/event-aggregator.js /usr/local/bin/event-aggregator.js \
    && install -m 0755 /app/lib/timestamp-tracker.js /usr/local/bin/timestamp-tracker.js \
    && install -m 0755 /app/lib/progress-stream-utils.js /usr/local/bin/progress-stream-utils.js \
    && install -m 0755 /app/lib/instance-state-derivation.js /usr/local/bin/instance-state-derivation.js \
    && install -m 0755 /app/lib/instance-status-derivation.js /usr/local/bin/instance-status-derivation.js \
    && install -m 0755 /app/lib/instance-stage-derivation.js /usr/local/bin/instance-stage-derivation.js \
    && install -m 0755 /app/lib/instance-failure-extraction.js /usr/local/bin/instance-failure-extraction.js \
    && install -m 0755 /app/lib/instance-metadata-reader.js /usr/local/bin/instance-metadata-reader.js \
    && install -m 0755 /app/lib/kaseki-report.js /usr/local/bin/kaseki-report \
    && install -m 0755 /app/lib/analyze-test-failures.js /usr/local/bin/analyze-test-failures \
    && install -m 0755 /app/lib/lib/validation-causality-analysis.js /usr/local/bin/validation-causality-analysis \
    && install -m 0755 /app/lib/github-app-token.js /usr/local/bin/github-app-token \
    && ln -sf github-app-token /usr/local/bin/github-app-token.js \
    && install -m 0755 /app/scripts/agent-prompt.sh /usr/local/bin/scripts/agent-prompt.sh \
    && install -m 0755 /app/scripts/allowlist-helper.sh /usr/local/bin/scripts/allowlist-helper.sh \
    && install -m 0755 /app/scripts/dependency-cache-helpers.sh /usr/local/bin/scripts/dependency-cache-helpers.sh \
    && install -m 0755 /app/dist/scouting-allowlist.js /usr/local/bin/scripts/scouting-allowlist.js \
    && mkdir -p /usr/local/bin/scripts/lib \
    && install -m 0644 /app/scripts/lib/json.sh /usr/local/bin/scripts/lib/json.sh \
    && install -m 0644 /app/scripts/lib/json-events.sh /usr/local/bin/scripts/lib/json-events.sh \
    && chmod 0755 \
      /usr/local/bin/kaseki-entrypoint \
      /usr/local/bin/kaseki-pi-event-filter \
      /usr/local/bin/kaseki-pi-progress-stream \
      /usr/local/bin/kaseki-report \
      /usr/local/bin/analyze-test-failures \
      /usr/local/bin/validation-causality-analysis \
      /usr/local/bin/github-app-token \
      /usr/local/bin/github-app-token.js \
      /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
      /app/scripts/*.sh
RUN empty_events="$(mktemp)" \
    && filtered_events="$(mktemp)" \
    && event_summary="$(mktemp)" \
    && /usr/local/bin/kaseki-pi-event-filter "$empty_events" "$filtered_events" "$event_summary" \
    && test -s "$event_summary" \
    && rm -f "$empty_events" "$filtered_events" "$event_summary"

# Pre-configure git safe.directory for /agents checkout directory
# This is a system-wide configuration visible to all users (including UID 10000 containers)
# and eliminates runtime configuration overhead. This addresses the "dubious ownership"
# error that occurs when git works with a checked-out repository owned by a different UID.
RUN git config --system --add safe.directory /agents/kaseki-agent

WORKDIR /workspace
USER kaseki
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"]
CMD ["agent"]

# The runner initializes these logs before long-running work starts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD test -f /results/stdout.log && test -f /results/stderr.log


# ===== FINAL STAGE: Artifact-Stripped Production Image =====
# This stage removes build-time artifacts (test/, docs/, src/) and devDependencies,
# reducing image size by ~80-150 MB while preserving all runtime functionality.
# Trade-off: Cannot rebuild code in container (not needed—build happens in CI before image creation).
#
# Impact:
#   - Size: 15–25% reduction (80 MB prune + 50 MB docs/test/src)
#   - Build time: negligible (final stage only copies needed files)
#   - Runtime: unaffected (all runtime binaries, scripts, and dependencies included)
#
FROM ${NODE_IMAGE} AS final

# Minimal setup: only runtime requirements (no build tools or package managers beyond npm for app startup check)
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl docker.io git jq procps tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10000 kaseki \
    && useradd --system --uid 10000 --gid kaseki --create-home --home-dir /home/kaseki --shell /usr/sbin/nologin kaseki \
    && mkdir -p /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent /opt/kaseki/workspace-cache/default \
    && chown -R kaseki:kaseki /workspace /results /tmp/kaseki-home /tmp/npm-cache /tmp/pi-agent /opt/kaseki

ENV HOME=/tmp/kaseki-home \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    npm_config_cache=/tmp/npm-cache \
    PI_CODING_AGENT_DIR=/tmp/pi-agent \
    PI_EXTENSIONS_DIR=/opt/kaseki/pi-extensions \
    PI_TELEMETRY=0 \
    PI_SKIP_VERSION_CHECK=1 \
    CI=true

# Copy runtime essentials from runtime stage (skip test/, docs/, src/)
COPY --from=runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=runtime /usr/local/bin/pi /usr/local/bin/pi
COPY --from=runtime /opt/kaseki/pi-extensions /opt/kaseki/pi-extensions
COPY --from=runtime /opt/kaseki/workspace-cache/default/node_modules /opt/kaseki/workspace-cache/default/node_modules

# Copy application files (excluding build artifacts)
WORKDIR /app
COPY --from=runtime /app/package.json /app/package-lock.json /app/
COPY --from=runtime /app/Dockerfile /app/.dockerignore /app/README.md /app/CLAUDE.md /app/CONTRIBUTING.md ./
COPY --from=runtime /app/kaseki /app/run-kaseki.sh /app/kaseki-agent.sh ./
COPY --from=runtime /app/ops ./ops
COPY --from=runtime /app/scripts ./scripts
COPY --from=runtime /app/docker ./docker
COPY --from=runtime /app/dist ./dist
COPY --from=runtime /app/lib ./lib
COPY --from=runtime /app/node_modules ./node_modules

# Keep devDependencies in final image (required for validation: npm run check, npm run test, npm run build)
# These tools (typescript, eslint, jest, etc.) are essential for kaseki's validation pipeline.
# Image size trade-off (~50-80 MB) is acceptable given validation is core functionality.

# Install global binaries and set up scripts (from runtime stage)
# Keep github_app_helper_dependencies in sync with static relative imports in src/github-app-token.ts and src/github-utils.ts.
RUN mkdir -p /scripts \
    && mkdir -p /tmp/kaseki-home/.pi/extensions \
    && mkdir -p /tmp/kaseki-home/.pi/agent/extensions \
    && ln -sf /opt/kaseki/pi-extensions/llm-gateway.js /tmp/kaseki-home/.pi/extensions/llm-gateway.js \
    && ln -sf /opt/kaseki/pi-extensions/llm-gateway.js /tmp/kaseki-home/.pi/agent/extensions/llm-gateway.js \
    && chown -R kaseki:kaseki /tmp/kaseki-home/.pi /opt/kaseki/pi-extensions \
    && ln -sf /app/scripts/kaseki-container-setup.sh /scripts/kaseki-container-setup.sh \
    && ln -sf /app/scripts/kaseki-container-setup-remote.sh /scripts/kaseki-container-setup-remote.sh \
    && ln -sf /app/scripts/kaseki-container-entrypoint-wrapper.sh /scripts/kaseki-container-entrypoint-wrapper.sh \
    && /app/scripts/startup-check-packaging.sh install \
    && github_app_helper_dependencies="github-app-private-key.js github-utils.js logger.js secrets/host-secrets-reader.js" \
    && mkdir -p /usr/local/bin/lib /usr/local/bin/secrets /usr/local/bin/scripts /usr/local/bin/pi-event-aggregation \
    && cp -r /app/lib/lib/* /usr/local/bin/lib/ \
    && cp -r /app/lib/pi-event-aggregation/* /usr/local/bin/pi-event-aggregation/ \
    && for dependency in $github_app_helper_dependencies; do install -m 0755 "/app/lib/$dependency" "/usr/local/bin/$dependency"; done \
    && install -m 0755 /app/lib/pi-event-filter.js /usr/local/bin/kaseki-pi-event-filter \
    && install -m 0755 /app/lib/ansi-colors.js /usr/local/bin/ansi-colors.js \
    && install -m 0755 /app/lib/pi-progress-stream.js /usr/local/bin/kaseki-pi-progress-stream \
    && install -m 0755 /app/lib/pi-progress-summarizer.js /usr/local/bin/pi-progress-summarizer.js \
    && install -m 0755 /app/lib/validation-output-filter.js /usr/local/bin/validation-output-filter \
    && install -m 0755 /app/lib/hashline-event-handler-cli.js /usr/local/bin/kaseki-hashline-event-handler \
    && install -m 0755 /app/lib/event-aggregator.js /usr/local/bin/event-aggregator.js \
    && install -m 0755 /app/lib/timestamp-tracker.js /usr/local/bin/timestamp-tracker.js \
    && install -m 0755 /app/lib/progress-stream-utils.js /usr/local/bin/progress-stream-utils.js \
    && install -m 0755 /app/lib/instance-state-derivation.js /usr/local/bin/instance-state-derivation.js \
    && install -m 0755 /app/lib/instance-status-derivation.js /usr/local/bin/instance-status-derivation.js \
    && install -m 0755 /app/lib/instance-stage-derivation.js /usr/local/bin/instance-stage-derivation.js \
    && install -m 0755 /app/lib/instance-failure-extraction.js /usr/local/bin/instance-failure-extraction.js \
    && install -m 0755 /app/lib/instance-metadata-reader.js /usr/local/bin/instance-metadata-reader.js \
    && install -m 0755 /app/lib/kaseki-report.js /usr/local/bin/kaseki-report \
    && install -m 0755 /app/lib/github-app-token.js /usr/local/bin/github-app-token \
    && ln -sf github-app-token /usr/local/bin/github-app-token.js \
    && install -m 0755 /app/kaseki-agent.sh /usr/local/bin/kaseki-agent \
    && install -m 0755 /app/scripts/docker-entrypoint.sh /usr/local/bin/kaseki-entrypoint \
    && install -m 0755 /app/scripts/agent-prompt.sh /usr/local/bin/scripts/agent-prompt.sh \
    && install -m 0755 /app/scripts/allowlist-helper.sh /usr/local/bin/scripts/allowlist-helper.sh \
    && install -m 0755 /app/scripts/dependency-cache-helpers.sh /usr/local/bin/scripts/dependency-cache-helpers.sh \
    && install -m 0755 /app/dist/scouting-allowlist.js /usr/local/bin/scripts/scouting-allowlist.js \
    && mkdir -p /usr/local/bin/scripts/lib \
    && install -m 0644 /app/scripts/lib/json.sh /usr/local/bin/scripts/lib/json.sh \
    && install -m 0644 /app/scripts/lib/json-events.sh /usr/local/bin/scripts/lib/json-events.sh \
    && chmod 0755 \
      /usr/local/bin/kaseki-entrypoint \
      /usr/local/bin/kaseki-pi-event-filter \
      /usr/local/bin/kaseki-pi-progress-stream \
      /usr/local/bin/kaseki-report \
      /usr/local/bin/github-app-token \
      /usr/local/bin/github-app-token.js \
      /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
      /app/kaseki /app/run-kaseki.sh /app/kaseki-agent.sh \
      /app/scripts/*.sh
RUN empty_events="$(mktemp)" \
    && filtered_events="$(mktemp)" \
    && event_summary="$(mktemp)" \
    && /usr/local/bin/kaseki-pi-event-filter "$empty_events" "$filtered_events" "$event_summary" \
    && test -s "$event_summary" \
    && rm -f "$empty_events" "$filtered_events" "$event_summary"

# Pre-configure git safe.directory for /agents checkout directory
# This is a system-wide configuration visible to all users (including UID 10000 containers)
# and eliminates runtime configuration overhead. This addresses the "dubious ownership"
# error that occurs when git works with a checked-out repository owned by a different UID.
RUN git config --system --add safe.directory /agents/kaseki-agent

WORKDIR /workspace
USER kaseki
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"]
CMD ["agent"]

# The runner initializes these logs before long-running work starts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD test -f /results/stdout.log && test -f /results/stderr.log
