#!/usr/bin/env bash
# Fast-forward only. Never rebases, resets, or rewrites history.
set -euo pipefail

AGENT_HOME="${SMARTBIO_AGENT_HOME:-$HOME/.smartbio-agent}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-home) AGENT_HOME="$2"; shift 2 ;;
    -h|--help) printf 'Usage: update.sh [--agent-home DIR]\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
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
if [ ! -x "$PYTHON_BIN" ]; then
  printf 'venv python not found: %s. Run install.sh.\n' "$PYTHON_BIN" >&2
  exit 1
fi

printf 'Fast-forwarding %s ...\n' "$REPO_ROOT"
if ! git -C "$REPO_ROOT" pull --ff-only; then
  printf 'git pull --ff-only failed. Resolve local changes manually; this script never rewrites history.\n' >&2
  exit 1
fi
"$PYTHON_BIN" -m pip install --disable-pip-version-check -r "$REPO_ROOT/python-engine/requirements.txt"
printf 'Update complete. Restart the agent (start.sh) and re-run health.sh.\n'
