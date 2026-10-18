#!/usr/bin/env bash
# FND-6: one-shot setup on a fresh LinuxONE VM (s390x), Ubuntu or Red Hat Enterprise Linux 9.
# Run from the repo root. Re-running is safe.
#
# Node is NOT needed on the VM: build the frontend on a laptop (`make build`) and copy the repo
# including frontend/dist (see LINUXONE.md). Only Python runs here.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== machine: $(uname -m) · $(. /etc/os-release && echo "$PRETTY_NAME")"

# 1. System packages. cryptography ships no s390x wheels and needs Rust to build, so it comes from
#    the distro and the venv sees system site-packages. OneTrace needs Python 3.10 or newer:
#    Ubuntu 22.04+ has it as python3; RHEL 9's python3 is 3.9, so use its python3.12 (or 3.11) stack.
if command -v apt-get >/dev/null; then
  sudo apt-get update -q
  sudo apt-get install -y -q python3 python3-venv python3-pip python3-cryptography make curl sqlite3
  PY=python3
elif command -v dnf >/dev/null; then
  sudo dnf install -y -q make curl sqlite
  PY=
  for v in 3.12 3.11; do
    if sudo dnf install -y -q "python$v" "python$v-pip" "python$v-cryptography"; then
      PY=python$v
      break
    fi
  done
  [ -n "$PY" ] || { echo "Could not install python3.12 or python3.11 with cryptography from dnf"; exit 1; }
else
  echo "Neither apt-get nor dnf found: use an Ubuntu or Red Hat Enterprise Linux 9 image"
  exit 1
fi
"$PY" -c 'import sys; assert sys.version_info >= (3, 10), sys.version' || {
  echo "$PY is older than 3.10"
  exit 1
}

# 2. The venv. Rebuild it if an earlier run made it with a different Python.
want=$("$PY" -c 'import sys; print(sys.version_info[:2])')
if [ -x .venv/bin/python ] && [ "$(.venv/bin/python -c 'import sys; print(sys.version_info[:2])')" != "$want" ]; then
  rm -rf .venv
fi
"$PY" -m venv --system-site-packages .venv
.venv/bin/python -m pip install -q --upgrade pip

# 3. Pinned packages. On s390x drop the cryptography pins so the distro build is used. The pins
#    live in requirements.txt, which requirements-dev.txt pulls in with `-r requirements.txt`
#    (resolved relative to the file), so merge both into one list without that line.
if [ "$(uname -m)" = "s390x" ]; then
  REQ=$(mktemp)
  cat requirements.txt requirements-dev.txt | grep -v -E '^(-r |cryptography==|cffi==|pycparser==)' > "$REQ"
  .venv/bin/python -m pip install -r "$REQ"
  rm -f "$REQ"
else
  .venv/bin/python -m pip install -r requirements-dev.txt
fi
.venv/bin/python -c "import cryptography, pydantic_core, sqlmodel, fastapi; print('cryptography', cryptography.__version__)"

# 4. Let the laptop reach `make run` on port 8000 for the smoke test (only if a firewall is on).
if command -v ufw >/dev/null && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
  sudo ufw allow 8000/tcp >/dev/null
elif systemctl is-active --quiet firewalld 2>/dev/null; then
  sudo firewall-cmd -q --permanent --add-port=8000/tcp && sudo firewall-cmd -q --reload
fi

.venv/bin/python -m pytest -q
echo
echo "Setup done. Start the server with:  make run     (serves API + frontend/dist on 0.0.0.0:8000)"
echo "Then from another shell:            make smoke   (prints the DECISIONS.md record line)"
