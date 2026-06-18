#!/usr/bin/env bash
# Sourceable JSON helper functions for shell scripts.

# Safely encode stdin as a JSON string using jq, which is required by kaseki-agent.
json_encode() {
  jq -Rs .
}
