/**
 * Protected paths
 *
 * - Hard block: secrets, git internals, dependencies, ssh material.
 * - Confirm: lockfiles (dependency changes are legitimate but rarely silent).
 *
 * Paths are resolved against the session cwd first, so `../.git/config` or
 * symlinked aliases cannot slip past a prefix check.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename, resolve, sep } from "node:path";

const BLOCKED_SEGMENTS = new Set([".git", "node_modules", ".ssh", ".gnupg"]);

const BLOCKED_NAMES = [
	/^\.env(\.|$)/i,
	/^auth\.json$/i,
	/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
	/\.(pem|key|p12|pfx|keystore)$/i,
	/^(credentials|secrets)(\.|$)/i,
	/^\.npmrc$/i,
	/^\.netrc$/i,
	/^\.pgpass$/i,
];

const LOCKFILES = new Set([
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lockb",
	"bun.lock",
	"Cargo.lock",
	"poetry.lock",
	"uv.lock",
	"composer.lock",
	"Gemfile.lock",
]);

/** Also protect pi's own credential store, wherever it lives. */
const ALWAYS_BLOCKED = [/[/\\]\.pi[/\\]agent[/\\]auth\.json$/];

function segmentsOf(path: string): string[] {
	return path.split(sep).filter(Boolean);
}

export default function (pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

		const raw = (event.input as { path?: unknown; file_path?: unknown }).path ?? (event.input as { file_path?: unknown }).file_path;
		if (typeof raw !== "string" || !raw) return undefined;

		const absolute = resolve(ctx.cwd, raw);
		const name = basename(absolute);

		if (ALWAYS_BLOCKED.some((pattern) => pattern.test(absolute))) {
			return { block: true, reason: `Protected: ${raw} holds credentials. Edit it yourself.` };
		}

		if (segmentsOf(absolute).some((segment) => BLOCKED_SEGMENTS.has(segment))) {
			return { block: true, reason: `Protected path: ${raw} (git internals, dependencies, or ssh material).` };
		}

		if (BLOCKED_NAMES.some((pattern) => pattern.test(name))) {
			return { block: true, reason: `Protected file: ${raw}. Change secrets and env files by hand.` };
		}

		if (LOCKFILES.has(name)) {
			if (!ctx.hasUI) {
				return { block: true, reason: `Lockfile ${raw} needs confirmation; no UI available.` };
			}
			const choice = await ctx.ui.select(`Lockfile write: ${raw}\n\nUsually changed by a package manager, not by hand. Allow?`, [
				"Allow once",
				"Deny",
			]);
			if (choice !== "Allow once") {
				return { block: true, reason: `Blocked lockfile write: ${raw}` };
			}
		}

		return undefined;
	});
}
