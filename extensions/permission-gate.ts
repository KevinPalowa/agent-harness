/**
 * Permission gate
 *
 * Confirms bash commands that can destroy work or escalate privileges.
 * Adds an "allow for this session" option so repeated safe-ish commands
 * (e.g. a specific rm inside build/) do not prompt every time.
 *
 * Non-interactive runs block instead of guessing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Rule {
	pattern: RegExp;
	why: string;
}

const RULES: Rule[] = [
	{ pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, why: "recursive/force delete" },
	{ pattern: /\bsudo\b|\bdoas\b/i, why: "privilege escalation" },
	{ pattern: /\bmkfs(\.\w+)?\b|\bdd\b[^|]*\bof=/i, why: "disk write" },
	{ pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, why: "system power" },
	{ pattern: /\bchmod\s+(-R\s+)?[0-7]{3,4}\b|\bchown\s+-R\b/i, why: "permission changes" },
	{ pattern: /\bgit\s+(push\b[^|]*(--force|-f)\b|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.)/i, why: "destroys uncommitted git state" },
	{ pattern: /\b(npm|pnpm|yarn|bun)\s+publish\b/i, why: "publishes a package" },
	{ pattern: /\b(curl|wget)\b[^|]*\|\s*(ba|z|)sh\b/i, why: "pipes a download into a shell" },
	{ pattern: />\s*\/dev\/(sd|nvme|disk)/i, why: "writes to a block device" },
	{ pattern: /:\(\)\s*\{.*\}\s*;?\s*:/, why: "fork bomb" },
];

export default function (pi: ExtensionAPI): void {
	const allowedThisSession = new Set<string>();

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = String((event.input as { command?: unknown }).command ?? "");
		if (!command) return undefined;

		const rule = RULES.find((candidate) => candidate.pattern.test(command));
		if (!rule) return undefined;
		if (allowedThisSession.has(command)) return undefined;

		if (!ctx.hasUI) {
			return { block: true, reason: `Blocked ${rule.why}; no UI available to confirm.` };
		}

		const choice = await ctx.ui.select(`⚠️ ${rule.why}\n\n  ${command}\n\nAllow?`, [
			"Allow once",
			"Allow for this session",
			"Deny",
		]);

		if (choice === "Allow once") return undefined;
		if (choice === "Allow for this session") {
			allowedThisSession.add(command);
			return undefined;
		}
		return { block: true, reason: "Blocked by user (permission gate)" };
	});
}
