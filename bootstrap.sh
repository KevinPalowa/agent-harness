#!/usr/bin/env bash
# Restore this Pi setup into the agent directory without touching runtime state.
set -euo pipefail

REPO_URL="${PI_SETUP_REPO:-git@github.com:KevinPalowa/agent-harness.git}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required"

# Prefer this checkout; otherwise clone the repo to a temp directory.
if [ -d "$SCRIPT_DIR/.git" ]; then
	SRC="$SCRIPT_DIR"
	log "Using local checkout: $SRC"
else
	TMP="$(mktemp -d)"
	trap 'rm -rf "$TMP"' EXIT
	log "Cloning $REPO_URL"
	git clone --depth 1 "$REPO_URL" "$TMP/agent-harness"
	SRC="$TMP/agent-harness"
fi

mkdir -p "$AGENT_DIR"
SRC_REAL="$(cd "$SRC" && pwd -P)"
AGENT_REAL="$(cd "$AGENT_DIR" && pwd -P)"

if [ "$SRC_REAL" = "$AGENT_REAL" ]; then
	log "Agent directory is this checkout; nothing to copy."
	exit 0
fi

install_file() {
	local name="$1"
	[ -f "$SRC/$name" ] || return 0
	if [ -f "$AGENT_DIR/$name" ]; then
		cp "$AGENT_DIR/$name" "$AGENT_DIR/$name.backup-$STAMP"
	fi
	cp "$SRC/$name" "$AGENT_DIR/$name"
	log "Installed $name"
}

install_dir() {
	local name="$1"
	[ -d "$SRC/$name" ] || return 0
	if [ -d "$AGENT_DIR/$name" ]; then
		mv "$AGENT_DIR/$name" "$AGENT_DIR/$name.backup-$STAMP"
	fi
	cp -R "$SRC/$name" "$AGENT_DIR/$name"
	log "Installed $name/"
}

install_file settings.json
install_file keybindings.json
install_file AGENTS.md
install_file APPEND_SYSTEM.md
install_file SYSTEM.md

install_dir extensions
install_dir skills
install_dir prompts
install_dir themes

if command -v pi >/dev/null 2>&1; then
	log "Pi found: $(command -v pi)"
else
	log "warning: 'pi' is not on PATH; install Pi before running it"
fi

cat <<EOF

Done. Backups (if any) use the suffix .backup-$STAMP

Next steps:
  1. Start pi, or run /reload if it was already running.
  2. Run /login if this machine has no auth.json yet.
  3. If you use MCP servers, create mcp.json with \${ENV_VAR} references (never literal tokens).
  4. Remove old .backup-* directories once you are happy with the result.
EOF
