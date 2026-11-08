/**
 * OpenCode-style TUI
 *
 * Replaces Pi's header, footer, and editor with a minimal OpenCode-inspired
 * layout:
 *   - small header with the pi wordmark and current directory
 *   - a left-accent prompt border
 *   - a status row under the prompt: agent · model · context
 *   - no full-width footer
 *
 * Toggle at runtime with /opencode-ui, or start without it using
 * --no-opencode-ui / --no-ui.
 */

import {
	CustomEditor,
	VERSION,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MODE_CHANNEL = "ui-mode";

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function contextLabel(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	if (!usage || usage.percent === null) return "ctx ?";
	return `ctx ${Math.round(usage.percent)}%`;
}

function fitStatus(left: string, right: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(left) + visibleWidth(right) + 1 > width) {
		const available = Math.max(0, width - visibleWidth(left) - 1);
		right = truncateToWidth(right, available, "");
	}
	if (visibleWidth(left) + visibleWidth(right) + 1 > width) {
		left = truncateToWidth(left, Math.max(0, width - visibleWidth(right) - 1), "");
	}
	const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
	return truncateToWidth(left + " ".repeat(gap) + right, width);
}

function headerComponent(ctx: ExtensionContext) {
	return (_tui: TUI, theme: Theme) => ({
		render(width: number): string[] {
			const brand = `${theme.fg("accent", "▌")} ${theme.fg("text", "pi")}${theme.fg("dim", ` v${VERSION}`)}`;
			const dot = theme.fg("borderMuted", " · ");
			const cwd = theme.fg("muted", formatCwd(ctx.cwd));
			return ["", truncateToWidth(`${brand}${dot}${cwd}`, width), ""];
		},
		invalidate(): void {},
	});
}

class EmptyFooter implements Component {
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

class OpenCodeEditor extends CustomEditor {
	private lastStatus = "";

	constructor(
		tui: TUI,
		editorTheme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly currentTheme: () => Theme,
		private readonly ctx: ExtensionContext,
		private readonly thinkingLevel: () => string,
	) {
		super(tui, editorTheme, keybindings, { paddingX: 2 });
		this.borderColor = (text) => currentTheme().fg("borderMuted", text);
	}

	protected renderTopBorder(width: number, _hiddenLineCount: number): string {
		// OpenCode's prompt has no top rule; the left accent border is enough.
		return " ".repeat(Math.max(0, width));
	}

	protected renderBottomBorder(width: number, _hiddenLineCount: number): string {
		const theme = this.currentTheme();
		const model = this.ctx.model?.id ?? "no-model";
		const thinking = this.thinkingLevel();
		const left =
			`${theme.fg("accent", "Build")} ${theme.fg("borderMuted", "·")} ${theme.fg("text", model)}` +
			(thinking === "off" ? "" : `${theme.fg("borderMuted", " · ")}${theme.fg("muted", thinking)}`);
		const right = theme.fg("muted", contextLabel(this.ctx));
		const status = fitStatus(left, right, width);
		this.lastStatus = status;
		return status;
	}

	render(width: number): string[] {
		if (width <= 4) return super.render(width);

		const theme = this.currentTheme();
		const accent = (text: string) => theme.fg("accent", text);
		const inner = super.render(width - 2);
		const lines = inner.map((line) => `${accent("▌")} ${line}`);
		if (this.getText().trim() === "" && lines.length > 1) {
			lines[1] = truncateToWidth(`${accent("▌")}  ${theme.fg("dim", "Ask anything…")}`, width);
		}

		// Pi appends autocomplete below the editor's bottom border. Move the
		// status row to the very bottom so the prompt keeps its OpenCode shape.
		const statusIndex = this.lastStatus ? inner.lastIndexOf(this.lastStatus) : -1;
		if (statusIndex >= 0 && statusIndex < lines.length - 1) {
			const [status] = lines.splice(statusIndex, 1);
			lines.push(status);
		}

		return lines;
	}
}

export default function (pi: ExtensionAPI): void {
	let enabled = false;

	function enable(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setHeader(headerComponent(ctx));
		ctx.ui.setFooter(() => new EmptyFooter());
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) =>
				new OpenCodeEditor(tui, theme, keybindings, () => ctx.ui.theme, ctx, () => pi.getThinkingLevel()),
		);
		enabled = true;
		pi.events.emit(MODE_CHANNEL, { mode: "opencode" });
	}

	function disable(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setHeader(undefined);
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setFooter(undefined);
		enabled = false;
		pi.events.emit(MODE_CHANNEL, { mode: "default" });
	}

	pi.registerFlag("no-opencode-ui", {
		description: "Start with the built-in header, editor, and footer",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("opencode-ui", {
		description: "Toggle the OpenCode-style header, prompt, and status row",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("OpenCode UI requires interactive mode", "error");
				return;
			}
			if (enabled) {
				disable(ctx);
				ctx.ui.notify("OpenCode UI disabled", "info");
			} else {
				enable(ctx);
				ctx.ui.notify("OpenCode UI enabled", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (pi.getFlag("no-ui") === true) return;
		if (pi.getFlag("no-opencode-ui") === true) return;
		enable(ctx);
	});

	pi.on("session_shutdown", async () => {
		enabled = false;
	});
}
