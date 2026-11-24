#!/usr/bin/env bash
# Local, user-scoped install. No global installs, no secrets printed or stored
# in the config file. Re-running keeps an existing token.
set -euo pipefail

AGENT_HOME="${SMARTBIO_AGENT_HOME:-$HOME/.smartbio-agent}"
WORKER_URL="${SMARTBIO_WORKER_URL:-http://127.0.0.1:8787}"
PYTHON="${PYTHON:-python3}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-home) AGENT_HOME="$2"; shift 2 ;;
    --worker-url) WORKER_URL="$2"; shift 2 ;;
    --python) PYTHON="$2"; shift 2 ;;
    -h|--help) printf 'Usage: install.sh [--agent-home DIR] [--worker-url URL] [--python PYTHON]\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REQUIREMENTS="$REPO_ROOT/python-engine/requirements.txt"
SRC_PATH="$REPO_ROOT/python-engine/src"

if [ ! -f "$REQUIREMENTS" ]; then
  printf 'Requirements file not found: %s\n' "$REQUIREMENTS" >&2
  exit 1
fi
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  printf 'Python not found: %s (use --python python3)\n' "$PYTHON" >&2
  exit 1
fi
if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  printf 'Python 3.10 or newer is required.\n' >&2
  exit 1
fi

umask 077
mkdir -p "$AGENT_HOME"
VENV="$AGENT_HOME/venv"
VENV_PYTHON="$VENV/bin/python"
if [ ! -x "$VENV_PYTHON" ]; then
  "$PYTHON" -m venv "$VENV"
fi
"$VENV_PYTHON" -m pip install --disable-pip-version-check -r "$REQUIREMENTS"

TOKEN_PATH="$AGENT_HOME/agent.token"
if [ ! -s "$TOKEN_PATH" ]; then
  "$VENV_PYTHON" -c 'import secrets; print(secrets.token_urlsafe(32))' > "$TOKEN_PATH"
  printf 'Generated a new agent token (not displayed).\n'
else
  printf 'Keeping the existing agent token (not displayed).\n'
fi
chmod 600 "$TOKEN_PATH"

CONFIG_PATH="$AGENT_HOME/config.json"
"$VENV_PYTHON" - "$CONFIG_PATH" "$WORKER_URL" "$TOKEN_PATH" "$VENV_PYTHON" "$SRC_PATH" <<'PY'
import json
import sys
from datetime import datetime, timezone

path, worker_url, token_path, venv_python, src_path = sys.argv[1:6]
config = {
    "worker_url": worker_url,
    "token_path": token_path,
    "venv_python": venv_python,
    "python_path": src_path,
    "created_at": datetime.now(timezone.utc).isoformat(),
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
PY
chmod 600 "$CONFIG_PATH"

printf '\nLocal agent installed in %s\n' "$AGENT_HOME"
printf 'Config: %s (no secret; only the token file path)\n' "$CONFIG_PATH"
printf 'Token:  %s (mode 600; never printed)\n' "$TOKEN_PATH"
printf '\nNext steps:\n'
printf '  1. Set the Worker secret to the same token value (from web-platform):\n'
printf '     cat "<token path>" | wrangler secret put AI_AGENT_TOKEN\n'
printf '  2. Start the worker at %s (for example: wrangler dev --local).\n' "$WORKER_URL"
printf '  3. Start the agent:  ./scripts/agent-setup/start.sh\n'
printf '  4. Check health:     ./scripts/agent-setup/health.sh\n'
