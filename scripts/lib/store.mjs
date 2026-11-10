import { StatusRegistry } from "./format.mjs";
import { isIgnoredByFrontmatter, parseFrontmatter, parseFrontmatterTask } from "./frontmatter.mjs";
import { filterTaskRecordsByQuery } from "./query.mjs";
import { getSubtreeNodes, getTaskParentLine, buildTaskTree, taskDepth } from "./tree.mjs";
import { listVaultMarkdownFiles, loadVaultConfig, readMarkdownFile, resolveVaultFilePath } from "./vault.mjs";

export async function loadVaultContext(vaultRoot) {
	const config = await loadVaultConfig(vaultRoot);
	const registry = new StatusRegistry();
	return {
		vaultRoot,
		...config,
		registry,
	};
}

export async function parseDocumentRecords(fileInfo, registry) {
	const doc = await readMarkdownFile(fileInfo.absPath);
	const { frontmatter } = parseFrontmatter(doc.lines);
	if (isIgnoredByFrontmatter(frontmatter)) {
		return { ignored: true, doc, frontmatter, tree: null, frontmatterTask: null, records: [] };
	}

	const tree = buildTaskTree(doc.lines, registry);
	const hasBodyTasks = tree.nodes.some((n) => n.task);
	const fmRecord = parseFrontmatterTask(fileInfo, frontmatter, registry, hasBodyTasks);
	const records = [];

	if (fmRecord) {
		records.push(fmRecord);
	}

	for (const node of tree.nodes) {
		if (!node.task) continue;
		const taskParentLine = getTaskParentLine(node);
		const parentLine = fmRecord && taskParentLine === null ? -1 : taskParentLine;
		const depth = fmRecord && taskParentLine === null ? 0 : taskDepth(node);
		records.push({
			path: fileInfo.path,
			basename: fileInfo.basename,
			lineNumber: node.lineNumber,
			parentLine,
			depth,
			hasChildren: node.children.some((c) => Boolean(c.task)),
			task: node.task.data,
		});
	}

	return { ignored: false, doc, frontmatter, tree, frontmatterTask: fmRecord, records };
}

export async function listVaultTasks(ctx, options = {}) {
	const files = await listVaultMarkdownFiles(ctx.vaultRoot);
	const allRecords = [];
	const CONCURRENCY = 24;

	for (let i = 0; i < files.length; i += CONCURRENCY) {
		const chunk = files.slice(i, i + CONCURRENCY);
		const parsedChunk = await Promise.all(
			chunk.map((fileInfo) => parseDocumentRecords(fileInfo, ctx.registry)),
		);
		for (const parsed of parsedChunk) {
			if (!parsed.ignored && parsed.records.length > 0) {
				allRecords.push(...parsed.records);
			}
		}
	}

	const includeCompleted = Boolean(options.includeCompleted);
	const includeCancelled = Boolean(options.includeCancelled);
	const includeChildren = options.includeChildren !== false;

	const filtered = allRecords.filter((record) => {
		if (!includeChildren && record.parentLine !== null) return false;
		if (!includeCompleted && record.task.status === "DONE") return false;
		if (!includeCancelled && record.task.status === "CANCELLED") return false;
		if (options.frontmatterOnly && record.lineNumber !== -1) return false;
		if (options.pathPrefix) {
			const normPrefix = options.pathPrefix.replace(/\\/gu, "/").replace(/^\/+/u, "");
			if (!(record.path === normPrefix || record.path.startsWith(normPrefix))) return false;
		}
		return true;
	});

	return options.query ? filterTaskRecordsByQuery(filtered, options.query) : filtered;
}

export async function findAllExistingIds(ctx) {
	const records = await listVaultTasks(ctx, {
		includeCompleted: true,
		includeCancelled: true,
		includeChildren: true,
	});
	const ids = new Set();
	for (const r of records) {
		if (r.task.id) ids.add(r.task.id);
	}
	return ids;
}

export async function resolveTaskTarget(ctx, selector) {
	if (selector.id) {
		const targetId = String(selector.id).trim();
		const records = await listVaultTasks(ctx, {
			includeCompleted: true,
			includeCancelled: true,
			includeChildren: true,
		});
		const matches = records.filter(
			(r) => r.task.id === targetId && (!selector.path || r.path === resolveVaultFilePath(ctx.vaultRoot, selector.path).vaultPath),
		);
		if (matches.length === 0) {
			throw new Error(`Task with ID "${targetId}" was not found.`);
		}
		if (matches.length > 1) {
			throw new Error(
				`Multiple tasks share ID "${targetId}" (${matches.map((m) => `${m.path}:${m.lineNumber}`).join(", ")}). Disambiguate with --path and --line.`,
			);
		}
		return matches[0];
	}

	if (selector.path === undefined || selector.line === undefined || selector.line === null) {
		throw new Error("Specify target task via --id <id> or --path <file> --line <lineNumber> (-1 for frontmatter task).");
	}

	const fileInfo = resolveVaultFilePath(ctx.vaultRoot, selector.path);
	const lineNumber = Number(selector.line);
	if (!Number.isInteger(lineNumber) || lineNumber < -1) {
		throw new RangeError(`Invalid line number "${selector.line}". Expected integer >= -1.`);
	}

	let parsed;
	try {
		parsed = await parseDocumentRecords(
			{ path: fileInfo.vaultPath, absPath: fileInfo.absPath, basename: fileInfo.basename },
			ctx.registry,
		);
	} catch (err) {
		if (err && err.code === "ENOENT") {
			throw new Error(`File not found: ${fileInfo.vaultPath}`);
		}
		throw err;
	}

	if (parsed.ignored) {
		throw new Error(`File "${fileInfo.vaultPath}" is ignored by frontmatter (tasks: ignore).`);
	}

	const record = parsed.records.find((r) => r.lineNumber === lineNumber);
	if (!record) {
		throw new Error(
			lineNumber === -1
				? `No frontmatter task (task: true) found in "${fileInfo.vaultPath}".`
				: `No task found at "${fileInfo.vaultPath}" line ${lineNumber}.`,
		);
	}
	return record;
}

export async function inspectTaskDetails(ctx, selector) {
	const record = await resolveTaskTarget(ctx, selector);
	const fileInfo = resolveVaultFilePath(ctx.vaultRoot, record.path);
	const parsed = await parseDocumentRecords(
		{ path: fileInfo.vaultPath, absPath: fileInfo.absPath, basename: fileInfo.basename },
		ctx.registry,
	);

	const ancestors = [];
	if (record.lineNumber === -1) {
		// Top-level file task
	} else {
		let parentLine = record.parentLine;
		while (parentLine !== null) {
			const parentRecord = parsed.records.find((r) => r.lineNumber === parentLine);
			if (!parentRecord) break;
			ancestors.unshift(parentRecord);
			parentLine = parentRecord.parentLine;
		}
	}

	let subtree = [];
	if (record.lineNumber === -1) {
		subtree = parsed.records.filter((r) => r.lineNumber !== -1);
	} else {
		const node = parsed.tree?.byLine.get(record.lineNumber);
		if (node) {
			const subLines = new Set(getSubtreeNodes(node).map((n) => n.lineNumber).filter((l) => l !== record.lineNumber));
			subtree = parsed.records.filter((r) => subLines.has(r.lineNumber));
		}
	}

	let dependencies = [];
	if (record.task.dependsOn) {
		const depIds = record.task.dependsOn.split(",").map((s) => s.trim()).filter(Boolean);
		if (depIds.length > 0) {
			const all = await listVaultTasks(ctx, {
				includeCompleted: true,
				includeCancelled: true,
				includeChildren: true,
			});
			dependencies = depIds.map((depId) => {
				const found = all.find((r) => r.task.id === depId);
				return {
					id: depId,
					found: Boolean(found),
					status: found?.task.status ?? null,
					satisfied: found ? (found.task.status === "DONE" || found.task.status === "CANCELLED") : true,
					path: found?.path ?? null,
					lineNumber: found?.lineNumber ?? null,
					description: found?.task.description ?? null,
				};
			});
		}
	}

	return {
		task: record,
		ancestors,
		children: subtree,
		dependencies,
		unfinishedDependencies: dependencies.filter((d) => !d.satisfied).map((d) => d.id),
	};
}

export async function getUnfinishedDependencies(ctx, dependsOn) {
	if (!dependsOn) return [];
	const depIds = String(dependsOn).split(",").map((id) => id.trim()).filter(Boolean);
	if (depIds.length === 0) return [];

	const all = await listVaultTasks(ctx, {
		includeCompleted: true,
		includeCancelled: true,
		includeChildren: true,
	});
	const unfinished = new Set();
	for (const r of all) {
		if (r.task.id && depIds.includes(r.task.id)) {
			if (r.task.status !== "DONE" && r.task.status !== "CANCELLED") {
				unfinished.add(r.task.id);
			}
		}
	}
	return Array.from(unfinished);
}
