#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
: "${STARFOLIO_DEMO_MAX_SECONDS:?AWS termination duration required}"
: "${STARFOLIO_DEMO_DEADLINE:?AWS termination deadline required}"
: "${STARFOLIO_TRIAL_ID:?Trial ID required}"
: "${STARFOLIO_TRIAL_DIAGNOSTICS_URI:?Trial diagnostics URI required}"
root=$(cd "$(dirname "$0")/../.." && pwd)
cat > /etc/systemd/system/starfolio-diagnostics.service <<EOF
[Unit]
Description=STARfolio trial diagnostics
[Service]
Type=oneshot
Environment=AWS_REGION=$AWS_REGION
Environment=STARFOLIO_TRIAL_DIAGNOSTICS_URI=$STARFOLIO_TRIAL_DIAGNOSTICS_URI
ExecStart=/bin/bash $root/demo/moshi-gateway/diagnostics.sh
TimeoutStartSec=25
EOF
systemctl daemon-reload
trap 'systemctl start starfolio-diagnostics.service || true; shutdown -h now' ERR
command -v nvidia-smi >/dev/null
python3.12 -c 'import sys; assert sys.version_info[:2] == (3, 12)'
gpu_memory=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1)
test "$gpu_memory" -ge 44000
remaining=$(($(date -d "$STARFOLIO_DEMO_DEADLINE" +%s) - $(date +%s)))
test "$remaining" -gt 300
systemd-run --unit=starfolio-host-deadline --on-active="${remaining}s" /sbin/shutdown -h now
id starfolio-demo >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin starfolio-demo
install -d -o starfolio-demo -g starfolio-demo /opt/starfolio-runtime
apt-get update -qq
apt-get install -y -qq git libportaudio2 python3.12-venv
python3.12 -m venv /opt/starfolio-runtime/venv
py=/opt/starfolio-runtime/venv/bin/python
"$py" -m pip install --require-hashes --only-binary=:all: -r "$root/demo/moshi-gateway/requirements.lock"
"$py" -m pip install --require-hashes --only-binary=:all: -r "$root/demo/moshi-gateway/requirements-build.lock"
git init --quiet /opt/starfolio-runtime/moshi-rag
git -C /opt/starfolio-runtime/moshi-rag remote add origin https://github.com/kyutai-labs/moshi-rag.git
git -C /opt/starfolio-runtime/moshi-rag fetch --depth 1 origin 8c6dfc101b7871baa428424bcdc583b74fb561d9
git -C /opt/starfolio-runtime/moshi-rag checkout --detach 8c6dfc101b7871baa428424bcdc583b74fb561d9
"$py" -m pip install --no-build-isolation --no-deps /opt/starfolio-runtime/moshi-rag/moshi
HF_TOKEN=$(aws secretsmanager get-secret-value --secret-id "$STARFOLIO_HF_TOKEN_SECRET_ARN" --query SecretString --output text --region "$STARFOLIO_HF_TOKEN_SECRET_REGION")
export HF_TOKEN
"$py" - <<'PY'
import json
from pathlib import Path

from huggingface_hub import snapshot_download

snapshot_download(
    'kyutai/moshika-rag-pytorch-bf16',
    revision='7135a6e3c46abb66c2cd95cb04cbfcbe8376f83d',
    local_dir='/opt/starfolio-runtime/models/moshika-rag',
)
snapshot_download(
    'kyutai/stt-1b-en_fr-candle',
    revision='095e38f6242006a93c2541149b181988397f5c7c',
    local_dir='/opt/starfolio-runtime/models/stt',
)
snapshot_download(
    'kyutai/ARC4_Encoder_Llama',
    revision='c11e53d1016cc586262ee883755410e2ca47ba3c',
    local_dir='/opt/starfolio-runtime/models/arc',
    allow_patterns=['model.safetensors'],
)
snapshot_download(
    'meta-llama/Llama-3.2-3B-Instruct',
    revision='0cb88a4f764b7a12671c53f0838cd831a0843b95',
    local_dir='/opt/starfolio-runtime/models/llama-tokenizer',
    allow_patterns=['original/tokenizer.model', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json'],
)
config_path = Path('/opt/starfolio-runtime/models/moshika-rag/config.json')
config = json.loads(config_path.read_text())
conditioner = config['conditioners']['reference_with_time']['multi_arc_encoder']
conditioner['tokenizer_name'] = '/opt/starfolio-runtime/models/llama-tokenizer'
config_path.write_text(json.dumps(config))
PY
unset HF_TOKEN
chown -R starfolio-demo:starfolio-demo /opt/starfolio-runtime
cat > /etc/systemd/system/starfolio-demo.service <<EOF
[Unit]
Description=STARfolio temporary Moshi demo
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=starfolio-demo
Group=starfolio-demo
WorkingDirectory=$root/demo/moshi-gateway
Environment=STARFOLIO_DEMO_MAX_SECONDS=$STARFOLIO_DEMO_MAX_SECONDS
Environment=STARFOLIO_DEMO_DEADLINE=$STARFOLIO_DEMO_DEADLINE
Environment=STARFOLIO_TRIAL_ID=$STARFOLIO_TRIAL_ID
Environment=HF_HOME=/opt/starfolio-runtime/hf
Environment=XDG_CACHE_HOME=/opt/starfolio-runtime/cache
Environment=TRITON_CACHE_DIR=/opt/starfolio-runtime/cache/triton
Environment=HF_HUB_DISABLE_TELEMETRY=1
Environment=DO_NOT_TRACK=1
ExecStart=/bin/bash $root/demo/moshi-gateway/run-worker.sh
ExecStopPost=-+/usr/bin/systemctl start starfolio-diagnostics.service
ExecStopPost=+/sbin/shutdown -h now
RuntimeMaxSec=${remaining}s
TimeoutStopSec=45
KillMode=control-group
Restart=no
NoNewPrivileges=true
IPAddressAllow=localhost
IPAddressDeny=any
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/opt/starfolio-runtime
UMask=0077
StandardOutput=null
StandardError=journal
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now starfolio-demo.service
