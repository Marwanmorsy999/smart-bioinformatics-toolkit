#!/usr/bin/env bash
# Removes only the local runtime directory created by install.sh.
# User data (FASTA files, Worker/D1 results, repository files) is preserved.
set -euo pipefail

AGENT_HOME="${SMARTBIO_AGENT_HOME:-$HOME/.smartbio-agent}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-home) AGENT_HOME="$2"; shift 2 ;;
    -h|--help) printf 'Usage: uninstall.sh [--agent-home DIR]\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

PID_PATH="$AGENT_HOME/agent.pid"
if [ -f "$PID_PATH" ]; then
  AGENT_PID="$(tr -d '\r\n' < "$PID_PATH")"
  if [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null; then
    kill "$AGENT_PID" 2>/dev/null || true
    sleep 1
    if kill -0 "$AGENT_PID" 2>/dev/null; then kill -9 "$AGENT_PID" 2>/dev/null || true; fi
    printf 'Stopped agent process %s.\n' "$AGENT_PID"
  fi
  rm -f "$PID_PATH"
fi

rm -f "$AGENT_HOME/config.json" "$AGENT_HOME/agent.token" "$AGENT_HOME/agent.log"
rm -rf "$AGENT_HOME/venv"
printf 'Removed local agent runtime at %s (config, token, PID, log, venv).\n' "$AGENT_HOME"
printf 'User data and Worker-side results were not touched.\n'
if [ -d "$AGENT_HOME" ]; then
  printf '%s still contains other files; it was left in place.\n' "$AGENT_HOME"
else
  rmdir "$AGENT_HOME" 2>/dev/null || true
fi
