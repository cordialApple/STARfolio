#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
: "${STARFOLIO_DEMO_MAX_SECONDS:?AWS termination duration required}"
: "${STARFOLIO_DEMO_DEADLINE:?AWS termination deadline required}"
: "${STARFOLIO_TRIAL_ID:?Trial ID required}"
: "${STARFOLIO_TRIAL_GPU_URI:?Trial GPU URI required}"
root=$(cd "$(dirname "$0")/../.." && pwd)
trap 'shutdown -h now' ERR
command -v nvidia-smi >/dev/null
python3.12 -c 'import sys; assert sys.version_info[:2] == (3, 12)'
gpu_memory=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1)
test "$gpu_memory" -ge 44000
remaining=$(($(date -d "$STARFOLIO_DEMO_DEADLINE" +%s) - $(date +%s)))
test "$remaining" -gt 300
systemd-run --unit=starfolio-host-deadline --on-active="${remaining}s" /sbin/shutdown -h now
id starfolio-demo >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin starfolio-demo
id starfolio-gpu >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin starfolio-gpu
install -d -o root -g root /opt/starfolio-runtime
swapoff -a
test "$(wc -l < /proc/swaps)" -eq 1
sysctl -w kernel.core_pattern=/dev/null
sysctl -w fs.suid_dumpable=0
test "$(cat /proc/sys/kernel/core_pattern)" = /dev/null
test "$(cat /sys/kernel/kexec_crash_loaded)" = 0
if systemctl list-unit-files --no-legend systemd-coredump.socket | grep -q '^systemd-coredump.socket'; then
  systemctl mask --now systemd-coredump.socket
fi
if systemctl list-unit-files --no-legend apport.service | grep -q '^apport.service'; then
  systemctl mask --now apport.service
fi
install -d -m 755 /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\n' > /etc/systemd/journald.conf.d/starfolio-volatile.conf
systemctl restart systemd-journald.service
apt-get update -qq
apt-get install -y -qq curl git gnupg libportaudio2 python3.12-venv
cloudwatch_dir=/opt/starfolio-runtime/cloudwatch
install -d -m 700 "$cloudwatch_dir/gnupg"
cloudwatch_url=https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
curl -fsSL "$cloudwatch_url" -o "$cloudwatch_dir/amazon-cloudwatch-agent.deb"
curl -fsSL "$cloudwatch_url.sig" -o "$cloudwatch_dir/amazon-cloudwatch-agent.deb.sig"
curl -fsSL https://amazoncloudwatch-agent.s3.amazonaws.com/assets/amazon-cloudwatch-agent.gpg -o "$cloudwatch_dir/amazon-cloudwatch-agent.gpg"
gpg --batch --homedir "$cloudwatch_dir/gnupg" --import "$cloudwatch_dir/amazon-cloudwatch-agent.gpg"
cloudwatch_fingerprint=$(gpg --batch --homedir "$cloudwatch_dir/gnupg" --with-colons --fingerprint | awk -F: '$1 == "fpr" {print $10; exit}')
test "$cloudwatch_fingerprint" = 937616F3450B7D806CBD9725D58167303B789C72
gpg --batch --homedir "$cloudwatch_dir/gnupg" --verify "$cloudwatch_dir/amazon-cloudwatch-agent.deb.sig" "$cloudwatch_dir/amazon-cloudwatch-agent.deb"
dpkg -i "$cloudwatch_dir/amazon-cloudwatch-agent.deb"
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c "file:$root/demo/moshi-gateway/cloudwatch-gpu.json"
systemctl is-active --quiet amazon-cloudwatch-agent.service
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
chown -R root:root /opt/starfolio-runtime
chmod -R a+rX,go-w /opt/starfolio-runtime
install -d -m 700 /run/starfolio-private
mount -t tmpfs -o size=8G,mode=0700,uid=$(id -u starfolio-demo),gid=$(id -g starfolio-demo),nodev,nosuid tmpfs /run/starfolio-private
install -d -m 700 -o starfolio-demo -g starfolio-demo /run/starfolio-private/home /run/starfolio-private/hf /run/starfolio-private/cache /run/starfolio-private/tmp
install -d -m 750 /run/starfolio-gpu
mount -t tmpfs -o size=64M,mode=0750,uid=$(id -u starfolio-demo),gid=$(id -g starfolio-gpu),nodev,nosuid,noexec tmpfs /run/starfolio-gpu
install -d -m 2770 -o starfolio-demo -g starfolio-gpu /run/starfolio-gpu/events
mountpoint -q /run/starfolio-private
mountpoint -q /run/starfolio-gpu
install -d -m 700 -o starfolio-gpu -g starfolio-gpu /var/lib/starfolio-gpu
chown -R starfolio-gpu:starfolio-gpu /var/lib/starfolio-gpu
cat > /etc/systemd/system/starfolio-gpu-sampler.service <<EOF
[Unit]
Description=STARfolio independent GPU sampler
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=starfolio-gpu
Group=starfolio-gpu
WorkingDirectory=$root/demo/moshi-gateway
Environment=AWS_REGION=$AWS_REGION
Environment=STARFOLIO_TRIAL_ID=$STARFOLIO_TRIAL_ID
Environment=STARFOLIO_TRIAL_GPU_URI=$STARFOLIO_TRIAL_GPU_URI
Environment=STARFOLIO_GPU_EVENT_DIR=/run/starfolio-gpu/events
ExecStartPre=/usr/bin/mountpoint -q /run/starfolio-gpu
ExecStart=/usr/bin/python3.12 $root/demo/moshi-gateway/gpu_sampler.py
TimeoutStopSec=20
Restart=no
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/starfolio-gpu /run/starfolio-gpu/events
TemporaryFileSystem=/tmp:rw,nodev,nosuid,size=256M
TemporaryFileSystem=/var/tmp:rw,nodev,nosuid,size=256M
LimitCORE=0
UMask=0077
StandardOutput=null
StandardError=null
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/starfolio-demo.service <<EOF
[Unit]
Description=STARfolio temporary Moshi demo
After=network-online.target starfolio-gpu-sampler.service
Wants=network-online.target
BindsTo=starfolio-gpu-sampler.service
[Service]
Type=simple
User=starfolio-demo
Group=starfolio-demo
WorkingDirectory=$root/demo/moshi-gateway
Environment=STARFOLIO_DEMO_MAX_SECONDS=$STARFOLIO_DEMO_MAX_SECONDS
Environment=STARFOLIO_DEMO_DEADLINE=$STARFOLIO_DEMO_DEADLINE
Environment=STARFOLIO_TRIAL_ID=$STARFOLIO_TRIAL_ID
Environment=STARFOLIO_GPU_EVENT_DIR=/run/starfolio-gpu/events
Environment=HOME=/run/starfolio-private/home
Environment=HF_HOME=/run/starfolio-private/hf
Environment=XDG_CACHE_HOME=/run/starfolio-private/cache
Environment=TORCH_HOME=/run/starfolio-private/cache/torch
Environment=TRITON_CACHE_DIR=/run/starfolio-private/cache/triton
Environment=CUDA_CACHE_PATH=/run/starfolio-private/cache/nv
Environment=TMPDIR=/run/starfolio-private/tmp
Environment=PYTHONDONTWRITEBYTECODE=1
Environment=HF_HUB_DISABLE_TELEMETRY=1
Environment=DO_NOT_TRACK=1
ExecStartPre=/usr/bin/awk NR>1{exit(1)} /proc/swaps
ExecStartPre=/usr/bin/grep -Fxq /dev/null /proc/sys/kernel/core_pattern
ExecStartPre=/usr/bin/grep -Fxq 0 /sys/kernel/kexec_crash_loaded
ExecStartPre=/usr/bin/mountpoint -q /run/starfolio-private
ExecStartPre=/usr/bin/mountpoint -q /run/starfolio-gpu
ExecStart=/bin/bash $root/demo/moshi-gateway/run-worker.sh
ExecStopPost=-+/usr/bin/systemctl stop starfolio-gpu-sampler.service
ExecStopPost=+/sbin/shutdown -h now
RuntimeMaxSec=${remaining}s
TimeoutStopSec=45
KillMode=control-group
Restart=no
NoNewPrivileges=true
IPAddressAllow=localhost
IPAddressDeny=any
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/run/starfolio-private /run/starfolio-gpu/events
InaccessiblePaths=/var/lib/starfolio-gpu
TemporaryFileSystem=/tmp:rw,nodev,nosuid,size=4G
TemporaryFileSystem=/var/tmp:rw,nodev,nosuid,size=1G
LimitCORE=0
UMask=0027
StandardOutput=null
StandardError=null
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now starfolio-gpu-sampler.service
sleep 1
systemctl is-active --quiet starfolio-gpu-sampler.service
systemctl enable --now starfolio-demo.service
