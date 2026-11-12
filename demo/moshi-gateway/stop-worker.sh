#!/usr/bin/env bash
set -euo pipefail
marker=/run/starfolio-private/worker-complete
if [[ ${INVOCATION_ID:-} =~ ^[0-9a-f]{32}$ ]] && [[ -f "$marker" && ! -L "$marker" ]] && [[ $(< "$marker") == "$INVOCATION_ID" ]]; then
  rm -f "$marker"
  /sbin/shutdown -h now
fi
