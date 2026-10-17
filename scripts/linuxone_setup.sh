#!/usr/bin/env bash
# FND-6: one-shot setup on a fresh Ubuntu LinuxONE VM (s390x). Run from the repo root.
#
# Node is NOT needed on the VM: build the frontend on a laptop (`make build`) and copy the repo
# including frontend/dist (see TEST.md "LinuxONE"). Only Python runs here.
set -euo pipefail

echo "== machine: $(uname -m) · $(. /etc/os-release && echo "$PRETTY_NAME")"

sudo apt-get update -q
sudo apt-get install -y -q python3 python3-venv python3-pip python3-cryptography make curl sqlite3

# cryptography ships no s390x wheels and needs Rust to build, so use the distro package and
# let the venv see system site-packages. Everything else in requirements*.txt is pure Python
# or has s390x wheels (pydantic-core).
python3 -m venv --system-site-packages .venv
.venv/bin/python -m pip install --upgrade pip
if [ "$(uname -m)" = "s390x" ]; then
  grep -v -E '^(cryptography|cffi|pycparser)==' requirements-dev.txt > /tmp/requirements-s390x.txt
  .venv/bin/python -m pip install -r /tmp/requirements-s390x.txt
else
  .venv/bin/python -m pip install -r requirements-dev.txt
fi
.venv/bin/python -c "import cryptography, pydantic_core, sqlmodel, fastapi; print('cryptography', cryptography.__version__, '(distro)' )"

.venv/bin/python -m pytest -q
echo
echo "Setup done. Start the server with:  make run     (serves API + frontend/dist on 0.0.0.0:8000)"
echo "Then from another shell:            make smoke   (prints the DECISIONS.md record line)"
