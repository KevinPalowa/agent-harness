/**
 * UI Extension - compact, informative status bar + terminal title spinner
 *
 * Footer (replaces the built-in footer):
 *   model · thinking · context bar % · ↑in ↓out · $cost · branch · extension statuses
 * Segments are dropped from the middle when the terminal is narrow, so the
 * model and git branch always stay visible.
 *
 * Title:
 *   animated spinner while the agent is working, project name when idle.
 *
 * Commands:
 *   /ui   toggle between this footer and the built-in one
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 8;

function fmtTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

function contextSegments(usage: { percent: number | null } | undefined, theme: ExtensionContext["ui"]["theme"]) {
	if (!usage || usage.percent === null) return { bar: "", label: "" };
	const pct = usage.percent;
	const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH)));
	const color = pct >= 90 ? "error" : pct >= 70 ? "warning" : "success";
	return {
		bar: theme.fg(color, "█".repeat(filled)) + theme.fg("borderMuted", "░".repeat(BAR_WIDTH - filled)),
		label: theme.fg("muted", `${Math.round(pct)}%`),
	};
}

function tokenTotals(ctx: ExtensionContext): { input: number; output: number; cost: number } {
	let input = 0;
	let output = 0;
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const message = entry.message as AssistantMessage;
			input += message.usage.input;
			output += message.usage.output;
			cost += message.usage.cost.total;
		}
	}
	return { input, output, cost };
}

export default function (pi: ExtensionAPI): void {
	let footerEnabled = true;
	let opencodeMode = false;
	let activeCtx: ExtensionContext | undefined;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	let spinnerFrame = 0;
	let titleCtx: ExtensionContext | undefined;

	function baseTitle(ctx: ExtensionContext): string {
		return `${basename(ctx.cwd)} — pi`;
	}

	function stopSpinner(ctx?: ExtensionContext): void {
		if (spinnerTimer) {
			clearInterval(spinnerTimer);
			spinnerTimer = undefined;
		}
		const target = ctx ?? titleCtx;
		if (target) {
			target.ui.setTitle(baseTitle(target));
			titleCtx = undefined;
		}
	}

	function startSpinner(ctx: ExtensionContext): void {
		stopSpinner(ctx);
		titleCtx = ctx;
		spinnerTimer = setInterval(() => {
			if (!titleCtx) return;
			const frame = SPINNER[spinnerFrame++ % SPINNER.length];
			titleCtx.ui.setTitle(`${frame} ${baseTitle(titleCtx)}`);
		}, 120);
	}

	function installFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			// Cheap cache so long sessions do not rescan the branch on every render.
			let cacheKey = "";
			let totals = { input: 0, output: 0, cost: 0 };

			function getTotals(): typeof totals {
				const branch = ctx.sessionManager.getBranch();
				const key = `${branch.length}:${branch.at(-1)?.id ?? ""}`;
				if (key !== cacheKey) {
					cacheKey = key;
					totals = tokenTotals(ctx);
				}
				return totals;
			}

			return {
				dispose: unsubscribe,
				invalidate() {
					cacheKey = "";
				},
				render(width: number): string[] {
					const { input, output, cost } = getTotals();
					const usage = ctx.getContextUsage();
					const { bar, label } = contextSegments(usage, theme);

					// Left: identity. Always shown.
					const model = theme.fg("accent", ctx.model?.id ?? "no-model");
					const thinking = ctx.thinkingLevel ? theme.fg("muted", `·${ctx.thinkingLevel}`) : "";
					const left = `${model}${thinking}`;

					// Right: location. Always shown.
					const branch = footerData.getGitBranch();
					const branchText = branch
						? theme.fg(branch === "detached" ? "warning" : "muted", `⎇ ${branch}`)
						: "";
					const cwdText = theme.fg("dim", basename(ctx.cwd));
					const right = [cwdText, branchText].filter(Boolean).join(" ");

					// Middle: optional detail, dropped from the right when narrow.
					const statuses = [...footerData.getExtensionStatuses().values()];
					const middleParts = [
						bar ? `${bar} ${label}` : "",
						theme.fg("dim", `↑${fmtTokens(input)} ↓${fmtTokens(output)}`),
						cost > 0 ? theme.fg("dim", `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`) : "",
						...statuses,
					].filter(Boolean);

					const sep = theme.fg("borderMuted", " · ");
					const fixedWidth = visibleWidth(left) + visibleWidth(right) + 2;
					const available = width - fixedWidth;

					const kept: string[] = [];
					let used = 0;
					for (const part of middleParts) {
						const partWidth = visibleWidth(part) + visibleWidth(sep);
						if (used + partWidth > available) continue;
						kept.push(part);
						used += partWidth;
					}

					const middle = kept.length ? ` ${kept.join(sep)} ` : " ";
					const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(middle) - visibleWidth(right));
					return [truncateToWidth(left + middle + " ".repeat(gap) + right, width)];
				},
			};
		});
	}

	function removeFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter(undefined);
	}

	pi.registerFlag("no-ui", {
		description: "Start with the built-in footer instead of the custom status bar",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("ui", {
		description: "Toggle the custom status bar",
		handler: async (_args, ctx) => {
			if (opencodeMode) {
				ctx.ui.notify("OpenCode UI owns the footer; run /opencode-ui to switch back", "info");
				return;
			}
			footerEnabled = !footerEnabled;
			if (footerEnabled) {
				installFooter(ctx);
				ctx.ui.notify("Custom status bar enabled", "info");
			} else {
				removeFooter(ctx);
				ctx.ui.notify("Built-in footer restored", "info");
			}
		},
	});

	// The OpenCode-style extension drives the whole bottom chrome. Keep the
	// custom footer out of its way, and restore it when OpenCode UI is off.
	pi.events.on("ui-mode", (data) => {
		const mode = (data as { mode?: string } | undefined)?.mode;
		opencodeMode = mode === "opencode";
		if (opencodeMode) return;
		if (footerEnabled && activeCtx) installFooter(activeCtx);
	});

	pi.on("session_start", async (_event, ctx) => {
		activeCtx = ctx;
		if (!ctx.hasUI) return;
		if (pi.getFlag("no-ui") === true) footerEnabled = false;
		if (footerEnabled && !opencodeMode) installFooter(ctx);
		ctx.ui.setTitle(baseTitle(ctx));
	});

	pi.on("model_select", async (_event, ctx) => {
		if (ctx.hasUI && footerEnabled && !opencodeMode) installFooter(ctx);
	});

	pi.on("thinking_level_select", async () => {
		// Footer reads ctx.thinkingLevel on every render; nothing to install.
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (ctx.hasUI) startSpinner(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (ctx.hasUI) stopSpinner(ctx);
	});

	pi.on("session_shutdown", async () => {
		stopSpinner();
		activeCtx = undefined;
		opencodeMode = false;
	});
}
