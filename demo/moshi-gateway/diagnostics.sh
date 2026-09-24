#!/usr/bin/env bash
set -uo pipefail
: "${AWS_REGION:?AWS region required}"
: "${STARFOLIO_TRIAL_DIAGNOSTICS_URI:?Trial diagnostics URI required}"
umask 077
capture=$(mktemp)
trap 'rm -f "$capture"' EXIT
systemctl show starfolio-demo.service \
  --property=Result,ExecMainCode,ExecMainStatus,ActiveEnterTimestamp,InactiveEnterTimestamp \
  > "$capture"
journalctl --unit=starfolio-demo.service --boot --no-pager --output=short-iso \
  | tail --bytes=524288 >> "$capture"
cloud_init_log=${STARFOLIO_CLOUD_INIT_LOG:-/var/log/cloud-init-output.log}
if [[ -f "$cloud_init_log" ]]; then
  tail --bytes=524288 "$cloud_init_log" >> "$capture"
fi
timeout 20s aws s3 cp "$capture" "$STARFOLIO_TRIAL_DIAGNOSTICS_URI" \
  --region "$AWS_REGION" --sse AES256 --only-show-errors
