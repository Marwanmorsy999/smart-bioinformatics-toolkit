# Local agent setup (M6.2)

Use these scripts only when you want heavy analyses (phylogenetics, taxonomy,
BLAST-backed workflows). FASTA validation and statistics need **no terminal**:
open the AI workspace, leave **Browser (local)** selected, paste or upload
FASTA, and run. That route computes in the page with the existing browser
modules and shows `Execution: browser-local`.

The scripts install everything under one user-scoped directory
(`%USERPROFILE%\.smartbio-agent` on Windows, `~/.smartbio-agent` on Linux /
macOS). They never install globally, never print the token, and never rewrite
git history. Override the directory with `-AgentHome` / `--agent-home` or the
`SMARTBIO_AGENT_HOME` environment variable.

## Exact commands

Run from the repository root. Paths are relative to that root.

### Windows (PowerShell)

```powershell
# 1. Install (creates venv, installs requirements, writes a token + config)
powershell -ExecutionPolicy Bypass -File scripts\agent-setup\install.ps1 -WorkerUrl http://127.0.0.1:8787

# 2. Copy the token into the Worker secret (same value as agent.token; not displayed here)
Get-Content "$env:USERPROFILE\.smartbio-agent\agent.token" | wrangler secret put AI_AGENT_TOKEN
#    (run this from web-platform, with wrangler pointed at your Worker)

# 3. Start the Worker, then start the agent (foreground; Ctrl+C stops it)
powershell -ExecutionPolicy Bypass -File scripts\agent-setup\start.ps1

#    detached alternative (writes a PID file and logs):
powershell -ExecutionPolicy Bypass -File scripts\agent-setup\start.ps1 -Background

# 4. Health check (non-zero exit with actionable messages on failure)
powershell -ExecutionPolicy Bypass -File scripts\agent-setup\health.ps1

# 5. Update (fast-forward only)
powershell -ExecutionPolicy Bypass -File scripts\agent-setup\update.ps1

# 6. Removal
powershell -ExecutionPolicy Bypass -File scripts\agent-setup\uninstall.ps1
```

### Linux / macOS (bash)

```bash
# 1. Install
./scripts/agent-setup/install.sh --worker-url http://127.0.0.1:8787

# 2. Copy the token into the Worker secret (run from web-platform)
cat "$HOME/.smartbio-agent/agent.token" | wrangler secret put AI_AGENT_TOKEN

# 3. Start the Worker, then start the agent (foreground; Ctrl+C stops it)
./scripts/agent-setup/start.sh

#    detached alternative:
./scripts/agent-setup/start.sh --background

# 4. Health check
./scripts/agent-setup/health.sh

# 5. Update (fast-forward only)
./scripts/agent-setup/update.sh

# 6. Removal
./scripts/agent-setup/uninstall.sh
```

If the scripts are not executable, run them with `bash scripts/agent-setup/<name>.sh`.
Python 3.10+ is required (the agent uses `list[str] | None` syntax).

## What each script does

| Script | Actions |
| --- | --- |
| `install` | Creates the runtime directory (owner-only), creates a venv, installs `python-engine/requirements.txt`, generates `agent.token` with `secrets.token_urlsafe(32)` if absent, writes `config.json` (URL + paths only), prints next steps. Re-running keeps an existing token. |
| `start` | Reads config, loads the token into memory, sets `PYTHONPATH` to `python-engine/src`, runs `python -m smartbio.aiagent.agent --loop --url <worker> --token <token>`. Foreground by default; `-Background` / `--background` detaches and writes `agent.pid` plus logs. Refuses a second concurrent start. |
| `health` | Checks venv Python version, agent imports, token presence/permissions, PID liveness, Worker reachability via `GET /api/ai/backend`, and the last *observed* agent job claim. Exits non-zero with an actionable message for each failure. Never prints the token. |
| `update` | `git pull --ff-only` followed by a requirements reinstall into the venv. No rebase, reset or history rewrite. |
| `uninstall` | Stops the PID, removes PID file, config, token, logs and venv. Leaves user data and Worker/D1 results untouched. |

## Token handling

- `agent.token` is mode `600` on Linux/macOS and restricted to the current
  user SID with `icacls` on Windows. `config.json` stores only the **path** to
  the token, never the value.
- The Worker must have the *same* value as the secret `AI_AGENT_TOKEN`. Set it
  with `wrangler secret put AI_AGENT_TOKEN` from `web-platform`. Installing
  again does not replace an existing token, so the secret stays valid.
- The token is passed to the agent on its command line because the agent CLI
  requires `--token`. It is therefore visible to local process inspection;
  these scripts never echo it or write it to a log. Do not paste real tokens
  into issue reports or shell transcripts.
- `health` checks presence and permissions only; it does not send the token
  anywhere. The backend status endpoint is unauthenticated and read-only.

## Availability semantics (important)

`GET /api/ai/backend` reports `connected` only when all of these are true:

1. the Worker has `AI_AGENT_TOKEN` configured,
2. execution mode is `real`, and
3. a job row has a recent `agent_id` + `started_at` claim (default window:
   10 minutes).

An agent that is idle with no queued jobs leaves no trace in D1, so it will be
reported as **not observed** and heavy analyses will be blocked. This is a
deliberate fail-closed choice: the UI never presents simulated output as real
science. After starting the agent, approve a plan once so a claim is recorded;
`health` then reports the last observed activity. The AI workspace re-checks
backend status immediately before queueing an agent job.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `No config at ...` | Run `install` first, or pass the same `-AgentHome` / `--agent-home` to every script. |
| `Python 3.10 or newer is required` | Pass `--python /path/to/python3.11` (or `-Python`) to `install`. |
| `pip install` fails offline | Configure an internal mirror or install the wheels from `python-engine/requirements.txt` into the venv; no global install is performed. |
| `Token file is readable by other accounts` / mode not `600` | Re-run `install` to restore owner-only permissions. |
| `Agent already running` | Stop it with `uninstall`, or remove a stale `agent.pid` if the process is gone. |
| `Worker unreachable at ...` | Start the Worker and check `worker_url` in `config.json`; default is `http://127.0.0.1:8787`. |
| `Worker has not observed an agent job claim` | Start the agent and approve a plan. Idle agents cannot be distinguished from stopped agents from the Worker alone. |
| `Agent imports failed` | Run `update`, then `health` again. |
| `git pull --ff-only failed` | Resolve local changes manually. These scripts never revert or rewrite your work. |
| Heavy request says `Agent not connected` | Use **Browser (local)** for validation/statistics, or start the agent and set the Worker secret as above. No mock result is produced. |

## Removal

Run `uninstall` (exact commands above). It stops the agent and deletes only
the runtime directory's config, token, PID file, logs and venv. Your FASTA
files, downloaded reports, D1 data and repository source are preserved. To
also remove the Worker secret, run `wrangler secret delete AI_AGENT_TOKEN` from
`web-platform`.

## Verification performed

PowerShell parser checks and `bash -n` syntax checks were run for every script
on the development machine. Actual installation, startup and health runs were
**not** performed on Linux or macOS here; cross-platform behaviour beyond
syntax is therefore not claimed.
