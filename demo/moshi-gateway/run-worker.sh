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
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait || true
}
trap cleanup EXIT
trap 'exit 0' TERM INT
"$py" gateway.py --exit-after-session &
gateway_pid=$!
pids+=("$gateway_pid")
"$py" conditioner_worker.py \
  --config "$model_root/moshika-rag/config.json" \
  --moshi-weight "$model_root/moshika-rag/model.safetensors" \
  --conditioner reference_with_time --cuda-device 0 --host 127.0.0.1 --port 8001 --log-level warning &
pids+=("$!")
start_moshi() {
  "$py" -c 'import time,urllib.request
for attempt in range(900):
 try:
  urllib.request.urlopen("http://127.0.0.1:8001/openapi.json", timeout=2); break
 except OSError: time.sleep(2)
else: raise SystemExit("Reference encoder did not become ready")'
  exec "$py" interview_worker.py \
    --host 127.0.0.1 --port 8998 --batch-size 1 --static none \
    --config "$model_root/moshika-rag/config.json" \
    --moshi-weight "$model_root/moshika-rag/model.safetensors" \
    --mimi-weight "$model_root/moshika-rag/tokenizer-e351c8d8-checkpoint125.safetensors" \
    --tokenizer "$model_root/moshika-rag/tokenizer_spm_32k_3.model" \
    --init-active-speaker user --log-level WARNING
}
start_moshi &
pids+=("$!")
wait -n "${pids[@]}"
