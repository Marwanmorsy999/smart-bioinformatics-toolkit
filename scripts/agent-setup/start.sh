#!/usr/bin/env bash
# Foreground by default (Ctrl+C stops the agent). --background detaches and
# writes a PID file. The token is never printed or logged by these scripts.
set -euo pipefail

AGENT_HOME="${SMARTBIO_AGENT_HOME:-$HOME/.smartbio-agent}"
MODE="foreground"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-home) AGENT_HOME="$2"; shift 2 ;;
    --background|-b) MODE="background"; shift ;;
    --foreground) MODE="foreground"; shift ;;
    -h|--help) printf 'Usage: start.sh [--agent-home DIR] [--background|--foreground]\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

CONFIG_PATH="$AGENT_HOME/config.json"
if [ ! -f "$CONFIG_PATH" ]; then
  printf 'No config at %s. Run install.sh first.\n' "$CONFIG_PATH" >&2
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
    print(json.load(handle)["worker_url"])
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
TOKEN="$(tr -d '\r\n' < "$TOKEN_PATH")"

if [ -z "$TOKEN" ]; then printf 'Token file is empty: %s\n' "$TOKEN_PATH" >&2; exit 1; fi
if [ ! -x "$PYTHON_BIN" ]; then printf 'venv python not found: %s\n' "$PYTHON_BIN" >&2; exit 1; fi
if [ ! -d "$SRC_PATH" ]; then printf 'smartbio source path not found: %s\n' "$SRC_PATH" >&2; exit 1; fi

PID_PATH="$AGENT_HOME/agent.pid"
if [ -f "$PID_PATH" ]; then
  PRIOR_PID="$(tr -d '\r\n' < "$PID_PATH")"
  if [ -n "$PRIOR_PID" ] && kill -0 "$PRIOR_PID" 2>/dev/null; then
    printf 'Agent already running with PID %s. Stop it before starting another.\n' "$PRIOR_PID" >&2
    exit 1
  fi
  rm -f "$PID_PATH"
fi

if [ -n "${PYTHONPATH:-}" ]; then export PYTHONPATH="$SRC_PATH:$PYTHONPATH"
else export PYTHONPATH="$SRC_PATH"; fi

if [ "$MODE" = "background" ]; then
  LOG_PATH="$AGENT_HOME/agent.log"
  nohup "$PYTHON_BIN" -m smartbio.aiagent.agent --loop --url "$WORKER_URL" --token "$TOKEN" \
    > "$LOG_PATH" 2>&1 < /dev/null &
  AGENT_PID=$!
  printf '%s\n' "$AGENT_PID" > "$PID_PATH"
  printf 'Started local agent with PID %s. Log: %s\n' "$AGENT_PID" "$LOG_PATH"
  printf 'Stop with: ./scripts/agent-setup/uninstall.sh\n'
  exit 0
fi

trap 'rm -f "$PID_PATH"' EXIT INT TERM
printf '%s\n' "$$" > "$PID_PATH"
"$PYTHON_BIN" -m smartbio.aiagent.agent --loop --url "$WORKER_URL" --token "$TOKEN"
exit $?
