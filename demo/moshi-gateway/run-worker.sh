#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
py=/opt/starfolio-runtime/venv/bin/python
model_root=/opt/starfolio-runtime/models
export LLM_BASE_URL=http://127.0.0.1:8765/v1
export LLM_API_KEY=loopback-interview
export LLM_MODEL_NAME=interview-controller
export REFERENCE_ENCODER_URL=http://127.0.0.1:8001
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export STARFOLIO_STT_MODEL_PATH="$model_root/stt"
export STARFOLIO_ARC_MODEL_PATH="$model_root/arc"
unset MOSHI_RETRIEVAL_LLMS_JSON MOSHI_FEEDBACK_WEBHOOK_URL STT_URL STT_API_KEY
pids=()
shutdown_reason=normal
cleanup() {
  "$py" gpu_peaks.py startup --stage shutdown --shutdown-reason "$shutdown_reason" || true
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait || true
}
trap cleanup EXIT
trap 'shutdown_reason=sigterm; exit 0' TERM
trap 'shutdown_reason=sigint; exit 0' INT
"$py" gateway.py --exit-after-session &
gateway_pid=$!
pids+=("$gateway_pid")
"$py" gpu_peaks.py startup --stage gateway_spawned || true
"$py" conditioner_worker.py \
  --config "$model_root/moshika-rag/config.json" \
  --moshi-weight "$model_root/moshika-rag/model.safetensors" \
  --conditioner reference_with_time --cuda-device 0 --host 127.0.0.1 --port 8001 --log-level warning &
conditioner_pid=$!
pids+=("$conditioner_pid")
"$py" gpu_peaks.py startup --stage conditioner_spawned || true
start_moshi() {
  "$py" -c 'import time,urllib.request
for attempt in range(900):
 try:
  urllib.request.urlopen("http://127.0.0.1:8001/openapi.json", timeout=2); break
 except OSError: time.sleep(2)
else: raise SystemExit("Reference encoder did not become ready")'
  "$py" gpu_peaks.py startup --stage encoder_ready || true
  "$py" gpu_peaks.py startup --stage interview_spawned || true
  exec "$py" interview_worker.py \
    --host 127.0.0.1 --port 8998 --batch-size 1 --static none \
    --config "$model_root/moshika-rag/config.json" \
    --moshi-weight "$model_root/moshika-rag/model.safetensors" \
    --mimi-weight "$model_root/moshika-rag/tokenizer-e351c8d8-checkpoint125.safetensors" \
    --tokenizer "$model_root/moshika-rag/tokenizer_spm_32k_3.model" \
    --init-active-speaker user --log-level WARNING
}
start_moshi &
interview_pid=$!
pids+=("$interview_pid")
exited_pid=""
if wait -n -p exited_pid "${pids[@]}"; then
  exit_code=0
else
  exit_code=$?
fi
case "${exited_pid:-}" in
  "$gateway_pid") child_role=gateway ;;
  "$conditioner_pid") child_role=conditioner ;;
  "$interview_pid") child_role=interview ;;
  *) child_role="" ;;
esac
if [[ -n "$child_role" ]]; then
  category_args=()
  if (( exit_code >= 128 )); then
    category_args=(--failure-category child_signal)
  elif (( exit_code > 0 )); then
    category_args=(--failure-category child_nonzero)
  fi
  "$py" gpu_peaks.py startup --stage child_exit \
    --child-role "$child_role" --child-pid "$exited_pid" --exit-code "$exit_code" \
    "${category_args[@]}" || true
fi
exit "$exit_code"
