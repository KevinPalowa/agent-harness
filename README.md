# agent-harness

My personal [Pi](https://pi.dev) setup, kept public for reference and built so I can
restore it on another machine in a couple of minutes.

Pi's user-level configuration lives in the agent directory, normally `~/.pi/agent`.
This repo tracks only the portable parts of that directory. Secrets, sessions, and
the Pi installation itself stay machine-local and ignored.

## Layout

| Path | Purpose |
|---|---|
| `settings.json` | Default provider/model/thinking level and other preferences |
| `keybindings.json` | Custom TUI keybindings |
| `themes/` | OpenCode-inspired dark/light themes (`opencode`, `opencode-light`) |
| `extensions/` | Local Pi extensions (see `extensions/README.md`) |
| `bootstrap.sh` | Copies this setup into `~/.pi/agent` without touching runtime state |
| `.gitignore` | Keeps credentials, sessions, installs, and caches out of git |

Machine-local and intentionally **not** tracked:

- `auth.json`, `mcp-auth.json` — API keys / OAuth tokens
- `trust.json`, `models-store.json` — machine-specific state
- `sessions/` — conversation history
- `bin/`, `install/` — Pi binary and release install
- `tmp/`, `*.log`, `node_modules/`

## Restore on a new machine

Install Pi first, then:

```bash
git clone git@github.com:KevinPalowa/agent-harness.git ~/src/agent-harness
cd ~/src/agent-harness
./bootstrap.sh
```

Then start Pi and log in:

```bash
pi
# inside Pi: /login   (only if auth.json does not exist yet)
# inside Pi: /reload  (if Pi was already running)
```

The script backs up existing `settings.json`, `keybindings.json`, and
`extensions/` with a `.backup-<timestamp>` suffix before replacing them. It only
touches files tracked by this repo; `install/`, `bin/`, `sessions/`, and
`auth.json` are left alone.

## Update an existing machine

```bash
cd ~/src/agent-harness
git pull
./bootstrap.sh
```

Or edit files directly in `~/.pi/agent` and commit from there, since that directory
is itself the checkout on my main machine.

## Security

This repo is public. Everything committed is world-readable.

- Never commit `auth.json`, `mcp-auth.json`, `.env`, or literal API keys.
- Prefer `${ENV_VAR}` references in `mcp.json`; do not commit tokens in headers.
- If a credential is ever committed, rotate it immediately. Removing a file in a
  later commit does not remove it from history.
