#!/usr/bin/env bash
# Read-only checks. Never prints the token. Exits non-zero with actionable
# messages when Python, imports, Worker, token or observed polling is missing.
set -uo pipefail

AGENT_HOME="${SMARTBIO_AGENT_HOME:-$HOME/.smartbio-agent}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-home) AGENT_HOME="$2"; shift 2 ;;
    -h|--help) printf 'Usage: health.sh [--agent-home DIR]\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

FAILURES=0
fail() { printf 'FAIL: %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
ok() { printf 'OK: %s\n' "$1"; }

CONFIG_PATH="$AGENT_HOME/config.json"
if [ ! -f "$CONFIG_PATH" ]; then
  fail "No config at $CONFIG_PATH. Run install.sh first."
  exit 1
fi
PYTHON_BIN="$(python3 - "$CONFIG_PATH" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["venv_python"])
PY
)"
WORKER_URL="$(python3 - "$CONFIG_PATH" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["worker_url"].rstrip("/"))
PY
)"
SRC_PATH="$(python3 - "$CONFIG_PATH" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["python_path"])
PY
)"
TOKEN_PATH="$(python3 - "$CONFIG_PATH" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["token_path"])
PY
)"

if [ ! -x "$PYTHON_BIN" ]; then
  fail "venv python missing: $PYTHON_BIN. Run install.sh."
else
  if "$PYTHON_BIN" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then ok "Python version OK."
  else fail "Python 3.10+ required in $PYTHON_BIN."; fi
  if [ -n "${PYTHONPATH:-}" ]; then export PYTHONPATH="$SRC_PATH:$PYTHONPATH"
  else export PYTHONPATH="$SRC_PATH"; fi
  if "$PYTHON_BIN" -c 'import smartbio.aiagent.agent, smartbio.fasta, smartbio.statistics, jsonschema' 2>/dev/null; then ok "Agent imports OK."
  else fail "Agent imports failed. Run update.sh (or install.sh)."; fi
fi

if [ ! -s "$TOKEN_PATH" ]; then
  fail "Token file missing or empty: $TOKEN_PATH. Run install.sh."
else
  PERMS="$(stat -c '%a' "$TOKEN_PATH" 2>/dev/null || stat -f '%Lp' "$TOKEN_PATH" 2>/dev/null || echo unknown)"
  if [ "$PERMS" != "600" ]; then fail "Token permissions are $PERMS, expected 600. Run install.sh to repair."
  else ok "Token present with mode 600 (value not shown)."; fi
fi

PID_PATH="$AGENT_HOME/agent.pid"
if [ ! -f "$PID_PATH" ]; then
  fail "No PID file at $PID_PATH. Start the agent with start.sh."
else
  AGENT_PID="$(tr -d '\r\n' < "$PID_PATH")"
  if [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null; then ok "Agent process $AGENT_PID is running."
  else fail "Agent process $AGENT_PID is not running. Start it with start.sh."; fi
fi

python3 - "$WORKER_URL" <<'PY'
import json
import sys
import urllib.error
import urllib.request

base = sys.argv[1]
try:
    with urllib.request.urlopen(base + "/api/ai/backend", timeout=5) as response:
        body = json.load(response)
except (urllib.error.URLError, TimeoutError, OSError) as error:
    print("FAIL: Worker unreachable at %s (%s). Check config.json and start the worker." % (base, type(error).__name__))
    raise SystemExit(1)
print("OK: Worker reachable at %s (execution mode: %s)." % (base, body.get("execution_mode")))
last = body.get("last_agent_activity_at")
if not last:
    print("FAIL: Worker has not observed an agent job claim. Start the agent, approve a plan, then retry. Idle agents leave no trace in D1.")
    raise SystemExit(1)
if body.get("agent_status") != "connected":
    print("FAIL: Last observed activity (%s) is stale (window %ss). Check agent.log." % (
        last, body.get("freshness_window_seconds")))
    raise SystemExit(1)
print("OK: Last observed agent activity: %s." % last)
PY
if [ "$?" -ne 0 ]; then FAILURES=$((FAILURES + 1)); fi

if [ "$FAILURES" -gt 0 ]; then printf '%s check(s) failed.\n' "$FAILURES"; exit 1; fi
printf 'All agent health checks passed.\n'
exit 0
