/**
 * Auto-format extension
 *
 * After a successful `edit` or `write`, runs the project's own formatter on the
 * touched file:
 *   - biome   (biome.json / biome.jsonc)
 *   - prettier (.prettierrc* / prettier.config.* / "prettier" in package.json)
 *
 * Only local binaries are used (node_modules/.bin), never npx/network. The
 * formatter runs inside pi's per-file mutation queue so it cannot race another
 * edit of the same file. Failures are reported as warnings, never blocks.
 *
 * Toggle: /format
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const FORMATTABLE = new Set([
	".js", ".jsx", ".mjs", ".cjs",
	".ts", ".tsx", ".mts", ".cts",
	".json", ".jsonc",
	".css", ".scss", ".less",
	".html", ".vue", ".svelte", ".astro",
	".yaml", ".yml", ".graphql", ".gql",
]);

type Formatter = { name: "biome" | "prettier"; bin: string; root: string };
const cache = new Map<string, Formatter | null>();

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function hasPrettierConfig(dir: string): Promise<boolean> {
	if (await exists(resolve(dir, ".prettierrc"))) return true;
	for (const name of [".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.json5", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs", "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs"]) {
		if (await exists(resolve(dir, name))) return true;
	}
	try {
		const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf8")) as { prettier?: unknown };
		return pkg.prettier !== undefined;
	} catch {
		return false;
	}
}

async function hasBiomeConfig(dir: string): Promise<boolean> {
	return (await exists(resolve(dir, "biome.json"))) || (await exists(resolve(dir, "biome.jsonc")));
}

/** Walk up from the file and use the first directory with a local formatter + config. */
async function findFormatter(file: string): Promise<Formatter | null> {
	const fileDir = dirname(file);
	const cached = cache.get(fileDir);
	if (cached !== undefined) return cached;

	let dir = fileDir;
	for (;;) {
		const biomeBin = resolve(dir, "node_modules/.bin/biome");
		if ((await isExecutable(biomeBin)) && (await hasBiomeConfig(dir))) {
			const formatter: Formatter = { name: "biome", bin: biomeBin, root: dir };
			cache.set(fileDir, formatter);
			return formatter;
		}
		const prettierBin = resolve(dir, "node_modules/.bin/prettier");
		if ((await isExecutable(prettierBin)) && (await hasPrettierConfig(dir))) {
			const formatter: Formatter = { name: "prettier", bin: prettierBin, root: dir };
			cache.set(fileDir, formatter);
			return formatter;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	cache.set(fileDir, null);
	return null;
}

export default function (pi: ExtensionAPI): void {
	let enabled = true;

	pi.registerCommand("format", {
		description: "Toggle auto-format after edit/write",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(enabled ? "Auto-format enabled" : "Auto-format disabled", "info");
		},
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!enabled) return undefined;
		if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
		if (event.isError) return undefined;

		const rawPath = (event.input as { path?: unknown; file_path?: unknown }).path ?? (event.input as { file_path?: unknown }).file_path;
		if (typeof rawPath !== "string" || !rawPath) return undefined;

		const file = resolve(ctx.cwd, rawPath);
		if (!FORMATTABLE.has(extname(file).toLowerCase())) return undefined;
		if (file.includes("/node_modules/") || file.includes("/.git/")) return undefined;

		const formatter = await findFormatter(file);
		if (!formatter) return undefined;

		const args = formatter.name === "biome" ? ["format", "--write", file] : ["--write", file];

		try {
			const result = await withFileMutationQueue(file, () =>
				pi.exec(formatter.bin, args, { cwd: formatter.root, timeout: 20_000 }),
			);
			if (result.code !== 0) {
				const reason = result.stderr.trim().split("\n").slice(0, 3).join(" ") || `exit ${result.code}`;
				ctx.ui.notify(`${formatter.name} failed on ${rawPath}: ${reason}`, "warning");
				return undefined;
			}
		} catch (error) {
			ctx.ui.notify(`${formatter.name} could not run: ${error instanceof Error ? error.message : String(error)}`, "warning");
			return undefined;
		}

		// Tell the model the file changed after its write so later reads make sense.
		return {
			content: [...event.content, { type: "text" as const, text: `\n[autoformatted ${rawPath} with ${formatter.name}]` }],
		};
	});
}
