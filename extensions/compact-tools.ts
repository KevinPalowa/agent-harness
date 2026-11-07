/**
 * Compact tool renderers (edit / write / read)
 *
 * The built-ins are already good but verbose: `edit` previews the full diff
 * before it runs, `write` previews the whole file, and `read` shows ten lines
 * collapsed. This keeps one-line call headers and summary-only results until
 * you expand the row (ctrl+o / app.tools.expand).
 *
 * bash, grep, find, ls keep their built-in renderers.
 *
 * Toggle: /toolview  (applies to new tool calls; existing rows keep theirs)
 */

import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { formatReadLineRange } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

function str(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function pathArg(args: Record<string, unknown> | undefined): string | null {
	return str(args?.path) ?? str(args?.file_path);
}

function shorten(path: string | null, cwd: string): string {
	if (!path) return "?";
	const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function countLines(text: string): number {
	if (text === "") return 0;
	const lines = text.split("\n");
	return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

/** `+4 / -2` from a display diff. */
function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { added, removed };
}

function styleDiff(diff: string, theme: any): string {
	const lines = diff.split("\n");
	return lines
		.map((line) => {
			if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("success", line);
			if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("error", line);
			if (line.startsWith("@@")) return theme.fg("accent", line);
			return theme.fg("dim", line);
		})
		.join("\n");
}

const MAX_EXPANDED_LINES = 40;

function headLines(text: string, max: number, theme: any, color = "toolOutput"): string {
	const lines = text.split("\n");
	const shown = lines.slice(0, max);
	let out = shown.map((line) => theme.fg(color, line)).join("\n");
	const hidden = lines.length - shown.length;
	if (hidden > 0) out += `\n${theme.fg("muted", `... ${hidden} more lines`)}`;
	return out;
}

export default function (pi: ExtensionAPI): void {
	let enabled = true;

	const readRenderers: ToolRenderers = {
		renderCall(args, theme, context) {
			const path = shorten(pathArg(args as Record<string, unknown>), context.cwd);
			const range = formatReadLineRange((args as any)?.offset, (args as any)?.limit);
			const text = theme.fg("toolTitle", theme.bold("read ")) + theme.fg("accent", path) + (range ? theme.fg("warning", range) : "");
			const component = context.lastComponent ?? new Text("", 0, 0);
			component.setText(text);
			return component;
		},
		renderResult(result, options, theme, context) {
			if (options.isPartial) return new Text(theme.fg("warning", "reading..."), 0, 0);
			if (context.isError) {
				const error = result.content.find((c) => c.type === "text");
				return new Text(theme.fg("error", error && "text" in error ? error.text.split("\n")[0] : "error"), 0, 0);
			}
			const content = result.content[0];
			if (content?.type === "image") return new Text(theme.fg("success", "image"), 0, 0);
			if (content?.type !== "text") return new Text(theme.fg("muted", "no content"), 0, 0);

			const lineCount = countLines(content.text);
			let text = theme.fg("muted", `${lineCount} lines`);
			const truncation = (result.details as { truncation?: { truncated?: boolean; totalLines?: number } } | undefined)?.truncation;
			if (truncation?.truncated && truncation.totalLines) {
				text += theme.fg("warning", ` (of ${truncation.totalLines})`);
			}
			if (options.expanded) text += `\n${headLines(content.text, MAX_EXPANDED_LINES, theme)}`;
			return new Text(text, 0, 0);
		},
	};

	const writeRenderers: ToolRenderers = {
		renderCall(args, theme, context) {
			const path = shorten(pathArg(args as Record<string, unknown>), context.cwd);
			const body = str((args as any)?.content) ?? "";
			const lineCount = countLines(body);
			const text =
				theme.fg("toolTitle", theme.bold("write ")) +
				theme.fg("accent", path) +
				(lineCount ? theme.fg("dim", ` ${lineCount} lines`) : "");
			const component = context.lastComponent ?? new Text("", 0, 0);
			component.setText(truncateToWidth(text, 200));
			return component;
		},
		renderResult(result, options, theme, context) {
			if (options.isPartial) return new Text(theme.fg("warning", "writing..."), 0, 0);
			if (context.isError) {
				const error = result.content.find((c) => c.type === "text");
				return new Text(theme.fg("error", error && "text" in error ? error.text.split("\n")[0] : "error"), 0, 0);
			}
			const body = str((context.args as any)?.content) ?? "";
			const lineCount = countLines(body);
			return new Text(theme.fg("success", "written") + (lineCount ? theme.fg("dim", ` ${lineCount} lines`) : ""), 0, 0);
		},
	};

	const editRenderers: ToolRenderers = {
		renderCall(args, theme, context) {
			const path = shorten(pathArg(args as Record<string, unknown>), context.cwd);
			const edits = (args as any)?.edits;
			const editCount = Array.isArray(edits) ? edits.length : 1;
			const text =
				theme.fg("toolTitle", theme.bold("edit ")) +
				theme.fg("accent", path) +
				(editCount > 1 ? theme.fg("dim", ` ${editCount} edits`) : "");
			const component = context.lastComponent ?? new Text("", 0, 0);
			component.setText(truncateToWidth(text, 200));
			return component;
		},
		renderResult(result, options, theme, context) {
			if (options.isPartial) return new Text(theme.fg("warning", "editing..."), 0, 0);
			if (context.isError) {
				const error = result.content.find((c) => c.type === "text");
				return new Text(theme.fg("error", error && "text" in error ? error.text.split("\n")[0] : "error"), 0, 0);
			}

			const path = shorten(pathArg(context.args as Record<string, unknown>), context.cwd);
			const diff = (result.details as { diff?: string } | undefined)?.diff;
			if (!diff) return new Text(theme.fg("success", "applied ") + theme.fg("muted", path), 0, 0);

			const { added, removed } = diffStats(diff);
			let text =
				theme.fg("success", `+${added}`) + theme.fg("dim", " / ") + theme.fg("error", `-${removed}`) + theme.fg("muted", ` ${path}`);
			if (options.expanded) {
				const lines = diff.split("\n");
				const shown = lines.slice(0, MAX_EXPANDED_LINES);
				text += `\n${styleDiff(shown.join("\n"), theme)}`;
				if (lines.length > shown.length) text += `\n${theme.fg("muted", `... ${lines.length - shown.length} more diff lines`)}`;
			}
			return new Text(text, 0, 0);
		},
	};

	pi.registerToolRenderer((toolName, next) => {
		if (!enabled) return next();
		if (toolName === "read") return readRenderers;
		if (toolName === "write") return writeRenderers;
		if (toolName === "edit") return editRenderers;
		return next();
	});

	pi.registerCommand("toolview", {
		description: "Toggle compact tool call rendering (edit/write/read)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(
				enabled ? "Compact tool view enabled (new calls only)" : "Built-in tool view restored (new calls only)",
				"info",
			);
		},
	});
}
