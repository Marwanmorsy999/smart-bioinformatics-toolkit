#!/bin/sh
# M7.1 replacement-credential installer (POSIX sh).
#
# Reads each value interactively with no terminal echo (the portable equivalent
# of `read -s`) and pipes it to `npx wrangler secret put <NAME>` on stdin.
# Values are NEVER printed, echoed in a command, logged, or written to disk.
# Only secret NAMES are emitted, and only in --dry-run mode.
#
# Rotate the credential at the provider FIRST: the previous Galaxy / smarts.bio
# keys were exposed in chat and must be treated as compromised.

set -eu

ENVIRONMENT="staging"
PROVIDER="all"
DRY_RUN=0

usage() {
  printf '%s\n' \
    "Usage: set-provider-secrets.sh [--environment staging|production]" \
    "                               [--provider galaxy|smartsbio|ninerouter|storage|all]" \
    "                               [--dry-run]" \
    "  --dry-run prints ONLY the secret names. Nothing is prompted or uploaded."
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment|-e)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      ENVIRONMENT="$2"; shift 2 ;;
    --provider|-p)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      PROVIDER="$2"; shift 2 ;;
    --dry-run|-WhatIf)
      DRY_RUN=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2 ;;
  esac
done

case "$ENVIRONMENT" in
  staging|production) ;;
  *) printf 'Invalid environment: %s\n' "$ENVIRONMENT" >&2; exit 2 ;;
esac

case "$PROVIDER" in
  galaxy)
    NAMES="GALAXY_BASE_URL GALAXY_API_KEY" ;;
  smartsbio)
    NAMES="SMARTSBIO_ENABLED SMARTSBIO_BASE_URL SMARTSBIO_API_KEY SMARTSBIO_WORKSPACE_ID SMARTSBIO_PUBLIC_AUTHORIZED" ;;
  ninerouter)
    NAMES="NINEROUTER_ENABLED NINEROUTER_BASE_URL NINEROUTER_API_KEY NINEROUTER_MODEL NINEROUTER_TIMEOUT" ;;
  storage)
    NAMES="ARTIFACT_SIGNING_KEY" ;;
  all)
    NAMES="GALAXY_BASE_URL GALAXY_API_KEY SMARTSBIO_ENABLED SMARTSBIO_BASE_URL SMARTSBIO_API_KEY SMARTSBIO_WORKSPACE_ID SMARTSBIO_PUBLIC_AUTHORIZED NINEROUTER_ENABLED NINEROUTER_BASE_URL NINEROUTER_API_KEY NINEROUTER_MODEL NINEROUTER_TIMEOUT ARTIFACT_SIGNING_KEY" ;;
  *)
    printf 'Invalid provider: %s\n' "$PROVIDER" >&2
    exit 2 ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  # Deliberately one bare name per line and nothing else.
  for name in $NAMES; do printf '%s\n' "$name"; done
  exit 0
fi

# Never read a secret from a pipe or a redirected file: that would defeat the
# interactive-hidden requirement and could leak into shell history or logs.
if [ ! -t 0 ]; then
  printf 'An interactive terminal is required; refusing to read hidden values from a non-tty.\n' >&2
  exit 1
fi
if ! command -v stty >/dev/null 2>&1; then
  printf 'stty is required for hidden input; refusing to continue.\n' >&2
  exit 1
fi
# Always restore terminal echo, even if an interrupt or failure occurs.
trap 'stty echo 2>/dev/null || true' EXIT HUP INT TERM

read_hidden() {
  label="$1"
  printf 'Hidden value for %s: ' "$label" >&2
  value=""
  if [ -n "${BASH_VERSION:-}" ]; then
    # bash supports the requested `read -s` directly.
    IFS= read -r -s value || return 1
    printf '\n' >&2
  else
    # POSIX sh fallback: disable echo around the read (same effect as -s).
    stty -echo
    if IFS= read -r value; then
      rc=0
    else
      rc=1
    fi
    stty echo
    printf '\n' >&2
    [ "$rc" -eq 0 ] || return 1
  fi
  printf '%s' "$value"
}

# wrangler.toml lives in web-platform/, regardless of the caller's cwd.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WEB_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)/web-platform
if [ ! -f "$WEB_DIR/wrangler.toml" ]; then
  printf 'Expected wrangler.toml in %s; refusing to run from an unknown directory.\n' "$WEB_DIR" >&2
  exit 1
fi
cd "$WEB_DIR"

for name in $NAMES; do
  value=$(read_hidden "$name")
  # The value is passed only on stdin; the argv contains the NAME only.
  if [ "$ENVIRONMENT" = "production" ]; then
    # Production is the default environment: deliberately no --env flag.
    printf '%s' "$value" | npx wrangler secret put "$name" || {
      printf 'wrangler secret put failed for %s (value not shown).\n' "$name" >&2
      exit 1
    }
  else
    printf '%s' "$value" | npx wrangler secret put "$name" --env "$ENVIRONMENT" || {
      printf 'wrangler secret put failed for %s (value not shown).\n' "$name" >&2
      exit 1
    }
  fi
  # Drop the in-memory copy before the next prompt.
  value=""
  printf 'Installed secret name: %s (environment: %s)\n' "$name" "$ENVIRONMENT"
done
