/**
 * Git Checkpoint Extension (hardened)
 *
 * Creates a git stash commit at each turn start, keyed to the current session
 * leaf entry. When /fork lands on a checkpointed entry, offers to restore the
 * working tree to that point.
 *
 * Differs from the shipped example:
 * - no-op outside a git repo instead of running git anyway
 * - checkpoint keyed to the actual leaf at turn_start (the entry you fork at)
 * - checkpoints survive until session shutdown instead of being cleared after
 *   every agent run, so /fork after the agent settles still offers a restore
 * - restore failures are reported instead of silently ignored
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_CHECKPOINTS = 200;

export default function (pi: ExtensionAPI): void {
	const checkpoints = new Map<string, string>();
	let isRepo: boolean | undefined;

	async function inGitRepo(): Promise<boolean> {
		if (isRepo !== undefined) return isRepo;
		const result = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
		isRepo = result.code === 0 && result.stdout.trim() === "true";
		return isRepo;
	}

	pi.on("turn_start", async (_event, ctx) => {
		if (!(await inGitRepo())) return;

		const leaf = ctx.sessionManager.getLeafEntry();
		if (!leaf) return;

		const result = await pi.exec("git", ["stash", "create"]);
		const ref = result.stdout.trim();
		if (result.code !== 0 || !ref) return;

		checkpoints.set(leaf.id, ref);
		while (checkpoints.size > MAX_CHECKPOINTS) {
			const oldest = checkpoints.keys().next().value;
			if (oldest === undefined) break;
			checkpoints.delete(oldest);
		}
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const ref = checkpoints.get(event.entryId);
		if (!ref || !ctx.hasUI) return;

		const choice = await ctx.ui.select("Restore code state?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);
		if (!choice?.startsWith("Yes")) return;

		const result = await pi.exec("git", ["stash", "apply", ref]);
		if (result.code === 0) {
			ctx.ui.notify("Code restored to checkpoint", "info");
			return;
		}

		const reason = result.stderr.trim() || `git stash apply exited with ${result.code}`;
		ctx.ui.notify(`Checkpoint restore failed: ${reason}`, "error");
	});

	pi.on("session_shutdown", async () => {
		checkpoints.clear();
		isRepo = undefined;
	});
}
