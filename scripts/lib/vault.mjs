import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_TOGGLE_BEHAVIOR = {
	cascadeFinish: true,
	cascadeCancel: true,
	cascadeUnfinish: false,
	cascadeUncancel: true,
	parentOnFinish: true,
	parentOnCancel: true,
	parentOnUnfinish: true,
	parentOnUncancel: true,
};

export const DEFAULT_SETTINGS = {
	setCreatedDate: false,
	setDoneDate: true,
	setCancelledDate: true,
	copySubtasksOnRecurrence: true,
	autoSuggestInEditor: true,
	toggleBehavior: { ...DEFAULT_TOGGLE_BEHAVIOR },
	assignees: [],
	defaultAssignee: "",
	preferredTaskFormat: "dataview",
};

export function resolveVaultRoot(explicitVault, cwd = process.cwd()) {
	const candidate = explicitVault || process.env.TASKLITE_VAULT;
	if (candidate) {
		const resolved = path.resolve(cwd, candidate);
		if (!existsSync(resolved)) {
			throw new Error(`Vault directory does not exist: ${resolved}`);
		}
		return resolved;
	}

	let current = path.resolve(cwd);
	while (true) {
		if (existsSync(path.join(current, ".obsidian"))) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}

	throw new Error(
		"Could not auto-detect an Obsidian vault (.obsidian directory not found in current or parent directories). Pass --vault <dir> or set TASKLITE_VAULT.",
	);
}

export function normalizeVaultPath(relPath) {
	if (typeof relPath !== "string" || !relPath.trim()) {
		throw new TypeError("TaskLite: path must be a non-empty string.");
	}
	const normalized = relPath
		.trim()
		.replace(/\\/gu, "/")
		.replace(/\/+/gu, "/")
		.replace(/^(?:\.\/)+/u, "")
		.replace(/^\/+/u, "");
	const segments = normalized.split("/");
	if (!normalized || segments.some((seg) => seg === "..")) {
		throw new Error(`TaskLite: Invalid path "${relPath}" — path traversal not allowed.`);
	}
	return normalized;
}

export function resolveVaultFilePath(vaultRoot, inputPath) {
	if (typeof inputPath !== "string" || !inputPath.trim()) {
		throw new TypeError("TaskLite: path must be a non-empty string.");
	}
	const trimmed = inputPath.trim();
	let relPath;
	if (path.isAbsolute(trimmed)) {
		const resolvedRoot = path.resolve(vaultRoot);
		const resolvedTarget = path.resolve(trimmed);
		const relative = path.relative(resolvedRoot, resolvedTarget);
		if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(`TaskLite: Path "${trimmed}" is outside vault "${resolvedRoot}".`);
		}
		relPath = relative;
	} else {
		relPath = trimmed;
	}

	const vaultPath = normalizeVaultPath(relPath);
	const absPath = path.resolve(vaultRoot, vaultPath);
	const resolvedRoot = path.resolve(vaultRoot);
	const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
	if (absPath !== resolvedRoot && !absPath.startsWith(rootPrefix)) {
		throw new Error(`TaskLite: Path "${inputPath}" escapes vault root.`);
	}

	return {
		vaultPath,
		absPath,
		basename: path.posix.basename(vaultPath, path.posix.extname(vaultPath)),
	};
}

async function readJsonIfExists(filePath) {
	try {
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw.replace(/^\uFEFF/u, ""));
	} catch (err) {
		if (err && err.code === "ENOENT") {
			return null;
		}
		throw new Error(`Failed to parse JSON config "${filePath}": ${err.message}`);
	}
}

export async function loadVaultConfig(vaultRoot) {
	const appJsonPath = path.join(vaultRoot, ".obsidian", "app.json");
	const pluginDataPath = path.join(vaultRoot, ".obsidian", "plugins", "taskslite", "data.json");

	const [appJson, pluginJson] = await Promise.all([
		readJsonIfExists(appJsonPath),
		readJsonIfExists(pluginDataPath),
	]);

	const useTab = typeof appJson?.useTab === "boolean" ? appJson.useTab : true;
	const rawTabSize = appJson?.tabSize;
	const tabSize = typeof rawTabSize === "number" && Number.isFinite(rawTabSize) && rawTabSize > 0
		? Math.floor(rawTabSize)
		: 4;

	const settings = {
		...DEFAULT_SETTINGS,
		...(pluginJson && typeof pluginJson === "object" ? pluginJson : {}),
		toggleBehavior: {
			...DEFAULT_TOGGLE_BEHAVIOR,
			...(pluginJson?.toggleBehavior && typeof pluginJson.toggleBehavior === "object"
				? pluginJson.toggleBehavior
				: {}),
		},
		assignees: Array.isArray(pluginJson?.assignees)
			? pluginJson.assignees.map((x) => String(x).trim()).filter(Boolean)
			: [],
		defaultAssignee: typeof pluginJson?.defaultAssignee === "string"
			? pluginJson.defaultAssignee
			: "",
		preferredTaskFormat: pluginJson?.preferredTaskFormat === "emoji" ? "emoji" : "dataview",
	};

	return {
		indentConfig: { useTab, tabSize },
		settings,
	};
}

export async function listVaultMarkdownFiles(vaultRoot) {
	const results = [];

	async function walk(absDir, relPrefix) {
		const entries = await readdir(absDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") {
				continue;
			}
			const nextAbs = path.join(absDir, entry.name);
			const nextRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				await walk(nextAbs, nextRel);
			} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
				results.push({
					path: nextRel,
					absPath: nextAbs,
					basename: entry.name.slice(0, -3),
				});
			}
		}
	}

	await walk(vaultRoot, "");
	results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return results;
}

export async function readMarkdownFile(absPath) {
	const raw = await readFile(absPath, "utf8");
	const hasBom = raw.startsWith("\uFEFF");
	const body = hasBom ? raw.slice(1) : raw;
	const eol = body.includes("\r\n") ? "\r\n" : "\n";
	const normalizedContent = eol === "\r\n" ? body.replace(/\r\n/gu, "\n") : body;
	const lines = normalizedContent.length > 0 ? normalizedContent.split("\n") : [];
	return {
		raw,
		content: normalizedContent,
		lines,
		eol,
		hasBom,
	};
}

export async function writeMarkdownFile(absPath, normalizedContent, options = {}) {
	const eol = options.eol === "\r\n" ? "\r\n" : "\n";
	const hasBom = Boolean(options.hasBom);
	const outBody = eol === "\r\n"
		? normalizedContent.replace(/\r?\n/gu, "\r\n")
		: normalizedContent;
	const finalText = hasBom ? `\uFEFF${outBody}` : outBody;

	await mkdir(path.dirname(absPath), { recursive: true });
	const tempPath = `${absPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	await writeFile(tempPath, finalText, "utf8");
	try {
		await rename(tempPath, absPath);
	} catch (err) {
		await unlink(tempPath).catch(() => {});
		throw err;
	}
}
