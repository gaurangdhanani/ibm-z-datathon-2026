#!/usr/bin/env bash
# FND-6 smoke test: health check + demo login + authenticated call against a running server.
# Usage: scripts/smoke.sh [base-url]   (default http://127.0.0.1:8000)
# Prints one markdown line to paste into DECISIONS.md under FND-6. Exit code 1 on any failure.
set -euo pipefail
BASE="${1:-http://127.0.0.1:8000}"
start=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')

health=$(curl -fsS "$BASE/api/health")
login=$(curl -fsS -X POST -H 'Content-Type: application/json' -d '{"persona":"patient"}' "$BASE/api/auth/demo-login")
token=$(printf '%s' "$login" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
me=$(curl -fsS -H "Authorization: Bearer $token" "$BASE/api/auth/me")
curl -fsS -o /dev/null -X POST -H "Authorization: Bearer $token" "$BASE/api/auth/logout"
spa=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/patient/alerts")

end=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
ms=$(( (end - start) / 1000000 ))

HEALTH="$health" ME="$me" SPA="$spa" MS="$ms" python3 - <<'PY'
import json, os, datetime
h = json.loads(os.environ["HEALTH"]); me = json.loads(os.environ["ME"]); p = h["platform"]
spa = "SPA served" if os.environ["SPA"] == "200" else f"SPA HTTP {os.environ['SPA']} (frontend/dist missing?)"
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
print(f"- {now} · {p['machine']} · {p['system']} · Python {p['python']} · host {p['hostname']} · "
      f"health {h['status']} · demo login ok ({me['full_name']}) · {spa} · 5 requests in {os.environ['MS']} ms")
PY
