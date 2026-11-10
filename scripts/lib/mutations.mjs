import { parseCliDateInput, resolveDueDateFromStart, todayString } from "./dates.mjs";
import {
	applyTaskStatus,
	normalizePriority,
	normalizeStatusInput,
	parseTaskLine,
	serializeTaskLine,
} from "./format.mjs";
import {
	applyFrontmatterPatchToContent,
	buildFrontmatterPatch,
	isIgnoredByFrontmatter,
	parseFrontmatter,
	parseFrontmatterTask,
} from "./frontmatter.mjs";
import { buildRecurringTaskOccurrence } from "./recurrence.mjs";
import { generateSemanticId } from "./semantic-id.mjs";
import { findAllExistingIds, getUnfinishedDependencies, listVaultTasks, resolveTaskTarget } from "./store.mjs";
import { buildTaskTree, getSubtreeLineRange, getSubtreeNodes, taskDepth, getIndentPrefix } from "./tree.mjs";
import { readMarkdownFile, resolveVaultFilePath, writeMarkdownFile } from "./vault.mjs";

function isTerminalStatus(status) {
	return status === "DONE" || status === "CANCELLED";
}

function areAllTaskChildrenTerminated(node, changedTasks) {
	const taskChildren = node.children.filter((c) => c.task !== null);
	if (taskChildren.length === 0) return false;
	return taskChildren.every((c) => {
		const status = changedTasks.get(c.lineNumber)?.status ?? c.task?.data.status;
		return isTerminalStatus(status);
	});
}

function areNonCancelledChildrenDone(node, changedTasks) {
	const taskChildren = node.children.filter((c) => c.task !== null);
	if (taskChildren.length === 0) return false;
	let hasDone = false;
	for (const c of taskChildren) {
		const status = changedTasks.get(c.lineNumber)?.status ?? c.task?.data.status;
		if (status === "DONE") hasDone = true;
		else if (status !== "CANCELLED") return false;
	}
	return hasDone;
}

function shouldCascade(behavior, settings) {
	if (behavior === "finish") return settings.toggleBehavior.cascadeFinish;
	if (behavior === "cancel") return settings.toggleBehavior.cascadeCancel;
	if (behavior === "unfinish") return settings.toggleBehavior.cascadeUnfinish;
	return settings.toggleBehavior.cascadeUncancel;
}

function shouldPropagateToParent(behavior, settings) {
	if (behavior === "finish") return settings.toggleBehavior.parentOnFinish;
	if (behavior === "cancel") return settings.toggleBehavior.parentOnCancel;
	if (behavior === "unfinish") return settings.toggleBehavior.parentOnUnfinish;
	return settings.toggleBehavior.parentOnUncancel;
}

function needsMissingStatusDate(task, status) {
	return (status.type === "DONE" && !task.dates.done) || (status.type === "CANCELLED" && !task.dates.cancelled);
}

function statusForSubtreeBehavior(node, behavior, registry, changedTasks, settings) {
	const type = node.task.data.status;
	if (behavior === "finish") return type === "CANCELLED" ? null : registry.get("x");
	if (behavior === "cancel") {
		if (type === "DONE") return null;
		if (settings.toggleBehavior.parentOnCancel && node.children.length > 0 && areNonCancelledChildrenDone(node, changedTasks)) {
			return registry.get("x");
		}
		return registry.get("-");
	}
	if (behavior === "unfinish") return registry.get(" ");
	return type === "CANCELLED" ? registry.get(" ") : null;
}

function statusForParentBehavior(parent, behavior, changedTasks, registry) {
	if (!parent.task) return null;
	const type = parent.task.data.status;
	if (behavior === "finish") {
		if (type === "CANCELLED" || type === "DONE") return null;
		return areAllTaskChildrenTerminated(parent, changedTasks) ? registry.get("x") : null;
	}
	if (behavior === "cancel") {
		if (type === "DONE" || type === "CANCELLED") return null;
		return areNonCancelledChildrenDone(parent, changedTasks) ? registry.get("x") : null;
	}
	if (behavior === "unfinish") {
		return type === "DONE" || type === "CANCELLED" ? registry.get(" ") : null;
	}
	return type === "CANCELLED" ? registry.get(" ") : null;
}

function replaceTaskStatus(node, status, changedTasks, replacementByLine, ctx) {
	if (!node.task) return;
	const currentTask = changedTasks.get(node.lineNumber) ?? node.task.data;
	if (currentTask.status === status.type && !needsMissingStatusDate(currentTask, status)) return;
	const updatedTask = applyTaskStatus(currentTask, status.type, ctx.settings, { fillMissingStatusDate: true }, todayString);
	changedTasks.set(node.lineNumber, updatedTask);
	const depth = taskDepth(node);
	const indent = getIndentPrefix(depth, ctx.indentConfig, ctx.lines);
	const format = ctx.settings.preferredTaskFormat ?? "dataview";
	replacementByLine.set(
		node.lineNumber,
		serializeTaskLine({ ...node.task, data: updatedTask }, indent, ctx.registry, format),
	);
}

function applyBehaviorToSubtree(node, behavior, changedTasks, replacementByLine, ctx) {
	for (const current of getSubtreeNodes(node)) {
		if (!current.task) continue;
		const nextStatus = statusForSubtreeBehavior(current, behavior, ctx.registry, changedTasks, ctx.settings);
		if (!nextStatus) continue;
		replaceTaskStatus(current, nextStatus, changedTasks, replacementByLine, ctx);
	}
}

function applyBehaviorToTarget(node, behavior, changedTasks, replacementByLine, ctx) {
	if (!node.task) return;
	const nextStatus = statusForSubtreeBehavior(node, behavior, ctx.registry, changedTasks, ctx.settings);
	if (!nextStatus) return;
	replaceTaskStatus(node, nextStatus, changedTasks, replacementByLine, ctx);
}

function applyBehaviorToParents(node, behavior, changedTasks, replacementByLine, ctx) {
	let parent = node.parent;
	while (parent?.task) {
		const nextStatus = statusForParentBehavior(parent, behavior, changedTasks, ctx.registry);
		if (!nextStatus) break;
		replaceTaskStatus(parent, nextStatus, changedTasks, replacementByLine, ctx);
		parent = parent.parent;
	}
}

function findRecurringTerminatedNode(node, changedTasks) {
	let current = node;
	while (current) {
		const changedTask = changedTasks.get(current.lineNumber);
		const statusType = changedTask ? changedTask.status : current.task?.data.status;
		if (current.task?.data.recurrence && isTerminalStatus(statusType) && !isTerminalStatus(current.task.data.status)) {
			return current;
		}
		current = current.parent;
	}
	return null;
}

function findTerminatedNode(node, changedTasks) {
	const changedTask = changedTasks.get(node.lineNumber);
	if (node.task && isTerminalStatus(changedTask?.status) && !isTerminalStatus(node.task.data.status)) {
		return node;
	}
	return null;
}

function getReplacementRange(range, replacementByLine) {
	let from = range.from;
	let to = range.to;
	for (const lineNumber of replacementByLine.keys()) {
		if (lineNumber < from) from = lineNumber;
		if (lineNumber > to) to = lineNumber;
	}
	return { from, to };
}

function buildTaskMutationResult({ lines, node, changedTasks, replacementByLine, indentConfig, registry, settings }) {
	const baseRange = getSubtreeLineRange(node);
	const recurringNode = findRecurringTerminatedNode(node, changedTasks);
	const recurringRange = recurringNode ? getSubtreeLineRange(recurringNode) : null;
	const replacementRange = getReplacementRange(recurringRange ?? baseRange, replacementByLine);
	const originalLines = lines
		.slice(replacementRange.from, replacementRange.to + 1)
		.map((line, index) => replacementByLine.get(replacementRange.from + index) ?? line);

	if (!recurringNode?.task) {
		const completedNode = findTerminatedNode(node, changedTasks);
		if (completedNode?.task?.data.onCompletion === "delete") {
			const deleteRange = getSubtreeLineRange(completedNode);
			return { fromLine: deleteRange.from, toLine: deleteRange.to, replacement: [], recurrenceCreated: null, deletedOnCompletion: true };
		}
		return { fromLine: replacementRange.from, toLine: replacementRange.to, replacement: originalLines, recurrenceCreated: null, deletedOnCompletion: false };
	}

	const completedTask = changedTasks.get(recurringNode.lineNumber);
	if (!completedTask) {
		return { fromLine: replacementRange.from, toLine: replacementRange.to, replacement: originalLines, recurrenceCreated: null, deletedOnCompletion: false };
	}

	const occurrence = buildRecurringTaskOccurrence({
		lines,
		recurringNode,
		terminatedTask: completedTask,
		indentConfig,
		registry,
		settings,
		unsupportedWarning: "TaskLite: unsupported recurrence rule; updated without creating the next copy.",
	});
	if (!occurrence) {
		return { fromLine: replacementRange.from, toLine: replacementRange.to, replacement: originalLines, recurrenceCreated: null, deletedOnCompletion: false };
	}

	const onDelete = recurringNode.task.data.onCompletion === "delete";
	if (occurrence.warning) {
		return {
			fromLine: replacementRange.from,
			toLine: replacementRange.to,
			replacement: originalLines,
			warning: occurrence.warning,
			recurrenceCreated: null,
			deletedOnCompletion: false,
		};
	}

	if (occurrence.skippedBecauseExisting && !onDelete) {
		return { fromLine: replacementRange.from, toLine: replacementRange.to, replacement: originalLines, recurrenceCreated: null, deletedOnCompletion: false };
	}

	if (onDelete) {
		return {
			fromLine: recurringRange.from,
			toLine: recurringRange.to,
			replacement: occurrence.skippedBecauseExisting ? [] : occurrence.nextLines,
			recurrenceCreated: occurrence.skippedBecauseExisting ? null : occurrence.nextLines,
			deletedOnCompletion: true,
		};
	}

	return {
		fromLine: replacementRange.from,
		toLine: replacementRange.to,
		replacement: [...occurrence.nextLines, ...originalLines],
		recurrenceCreated: occurrence.nextLines,
		deletedOnCompletion: false,
	};
}

function mutateLineStatus(lines, lineNumber, targetStatusSymbol, ctx) {
	const tree = buildTaskTree(lines, ctx.registry);
	const node = tree.byLine.get(lineNumber);
	if (!node?.task) return null;

	const targetStatus = ctx.registry.get(targetStatusSymbol);
	if (node.task.data.status === targetStatus.type && !needsMissingStatusDate(node.task.data, targetStatus)) {
		return { noChange: true, changedTasks: new Map() };
	}

	const mutCtx = {
		lines,
		indentConfig: ctx.indentConfig,
		registry: ctx.registry,
		settings: ctx.settings,
	};

	const changedTasks = new Map();
	const replacementByLine = new Map();

	if (targetStatus.type === "DONE" || targetStatus.type === "CANCELLED" || targetStatus.type === "TODO") {
		const behavior =
			targetStatus.type === "DONE"
				? "finish"
				: targetStatus.type === "CANCELLED"
					? "cancel"
					: node.task.data.status === "CANCELLED"
						? "uncancel"
						: "unfinish";

		if (shouldCascade(behavior, ctx.settings)) {
			applyBehaviorToSubtree(node, behavior, changedTasks, replacementByLine, mutCtx);
		} else {
			applyBehaviorToTarget(node, behavior, changedTasks, replacementByLine, mutCtx);
		}
		if (shouldPropagateToParent(behavior, ctx.settings)) {
			applyBehaviorToParents(node, behavior, changedTasks, replacementByLine, mutCtx);
		}
		if (changedTasks.size === 0) return { noChange: true, changedTasks };
	} else {
		const changedTask = applyTaskStatus(node.task.data, targetStatus.type, ctx.settings, { fillMissingStatusDate: true }, todayString);
		changedTasks.set(node.lineNumber, changedTask);
		const indent = getIndentPrefix(taskDepth(node), ctx.indentConfig, lines);
		const format = ctx.settings.preferredTaskFormat ?? "dataview";
		replacementByLine.set(
			node.lineNumber,
			serializeTaskLine({ ...node.task, data: changedTask }, indent, ctx.registry, format),
		);
		if (targetStatus.type === "IN_PROGRESS" && shouldPropagateToParent("unfinish", ctx.settings)) {
			applyBehaviorToParents(node, "unfinish", changedTasks, replacementByLine, mutCtx);
		}
	}

	const result = buildTaskMutationResult({ ...mutCtx, node, changedTasks, replacementByLine });
	return { ...result, changedTasks, noChange: false };
}

async function unblockDependentTasks(ctx, completedIds) {
	if (!completedIds || completedIds.length === 0) return [];
	const records = await listVaultTasks(ctx, {
		includeCompleted: true,
		includeCancelled: true,
		includeChildren: true,
	});

	const updatesByFile = new Map();
	const unblocked = [];

	for (const record of records) {
		if (!record.task.dependsOn) continue;
		const depIds = record.task.dependsOn.split(",").map((id) => id.trim()).filter(Boolean);
		const removed = depIds.filter((id) => completedIds.includes(id));
		if (removed.length === 0) continue;
		const remaining = depIds.filter((id) => !completedIds.includes(id));
		const newDependsOn = remaining.length > 0 ? remaining.join(", ") : null;

		let list = updatesByFile.get(record.path);
		if (!list) {
			list = [];
			updatesByFile.set(record.path, list);
		}
		list.push({ lineNumber: record.lineNumber, newDependsOn, removed, description: record.task.description });
	}

	for (const [relPath, updates] of updatesByFile.entries()) {
		const fileInfo = resolveVaultFilePath(ctx.vaultRoot, relPath);
		const doc = await readMarkdownFile(fileInfo.absPath);
		let lines = [...doc.lines];
		let fmPatchToApply = null;

		updates.sort((a, b) => b.lineNumber - a.lineNumber);
		for (const upd of updates) {
			if (upd.lineNumber === -1) {
				const { frontmatter } = parseFrontmatter(lines);
				const tree = buildTaskTree(lines, ctx.registry);
				const fmRecord = parseFrontmatterTask(
					{ path: fileInfo.vaultPath, basename: fileInfo.basename },
					frontmatter,
					ctx.registry,
					tree.nodes.some((n) => Boolean(n.task)),
				);
				if (fmRecord) {
					const data = { ...fmRecord.task, dependsOn: upd.newDependsOn };
					fmPatchToApply = buildFrontmatterPatch(fmRecord.task, data, ctx.registry, fmRecord.rawStatus);
				}
			} else if (lines[upd.lineNumber] !== undefined) {
				const parsedLine = parseTaskLine(
					lines[upd.lineNumber],
					ctx.registry.get(lines[upd.lineNumber].match(/\[(.)\]/u)?.[1] ?? " ").type,
				);
				if (parsedLine) {
					parsedLine.data.dependsOn = upd.newDependsOn;
					const tempTree = buildTaskTree(lines, ctx.registry);
					const node = tempTree.byLine.get(upd.lineNumber);
					const depth = node ? taskDepth(node) : 0;
					const indent = getIndentPrefix(depth, ctx.indentConfig, lines);
					const format = ctx.settings.preferredTaskFormat ?? "dataview";
					lines[upd.lineNumber] = serializeTaskLine(parsedLine, indent, ctx.registry, format);
				}
			}
			unblocked.push({
				path: relPath,
				lineNumber: upd.lineNumber,
				description: upd.description,
				removedDependencies: upd.removed,
				dependsOn: upd.newDependsOn,
			});
		}

		let nextContent = lines.join("\n");
		if (fmPatchToApply) {
			nextContent = applyFrontmatterPatchToContent(nextContent, fmPatchToApply);
		}
		await writeMarkdownFile(fileInfo.absPath, nextContent, { eol: doc.eol, hasBom: doc.hasBom });
	}

	return unblocked;
}

export async function createTask(ctx, input) {
	if (!input.description?.trim()) {
		throw new TypeError("TaskLite createTask: description must not be empty.");
	}
	if (input.isFileTask && input.parentLineNumber !== undefined && input.parentLineNumber !== null) {
		throw new TypeError("TaskLite createTask: file-level tasks cannot have a parentLineNumber.");
	}
	if (input.isFileTask && input.parentId) {
		throw new TypeError("TaskLite createTask: file-level tasks cannot have a parentId.");
	}

	let parentLineNumber = input.parentLineNumber;
	let resolvedTargetPath = input.path || "Tasks/New_Tasks.md";
	if (input.parentId) {
		const parentRecord = await resolveTaskTarget(ctx, { id: input.parentId });
		if (parentRecord.lineNumber === -1) {
			throw new Error("Frontmatter task cannot be targeted as a line parent; create a root task in the same file instead.");
		}
		if (input.path) {
			const explicitInfo = resolveVaultFilePath(ctx.vaultRoot, input.path);
			if (parentRecord.path !== explicitInfo.vaultPath) {
				throw new Error(`Parent task "${input.parentId}" is in "${parentRecord.path}", not "${explicitInfo.vaultPath}".`);
			}
		}
		resolvedTargetPath = parentRecord.path;
		parentLineNumber = parentRecord.lineNumber;
	}

	const fileInfo = resolveVaultFilePath(ctx.vaultRoot, resolvedTargetPath);
	const statusSymbol = normalizeStatusInput(input.status ?? " ");
	const statusConfig = ctx.registry.get(statusSymbol);
	const priority = normalizePriority(input.priority);

	const start = input.dates?.start ? parseCliDateInput(input.dates.start) : null;
	const rawDue = input.dates?.due ? parseCliDateInput(input.dates.due, { allowTimeOnly: true }) : null;
	const due = rawDue ? (resolveDueDateFromStart(rawDue, start) ?? rawDue) : null;

	const dates = {
		start,
		created: input.dates?.created ? parseCliDateInput(input.dates.created) : null,
		scheduled: input.dates?.scheduled ? parseCliDateInput(input.dates.scheduled) : null,
		due,
		done: input.dates?.done ? parseCliDateInput(input.dates.done) : null,
		cancelled: input.dates?.cancelled ? parseCliDateInput(input.dates.cancelled) : null,
		remind: input.dates?.remind ? parseCliDateInput(input.dates.remind) : null,
	};

	let taskId = input.id ? String(input.id).trim() : null;
	if (input.autoId && !taskId) {
		const existingIds = await findAllExistingIds(ctx);
		taskId = generateSemanticId(input.description, {
			isRecurring: Boolean(input.recurrence),
			dueDate: dates.due,
			existingIds,
		});
	}

	const assignee = Array.isArray(input.assignee) ? input.assignee.map((a) => String(a).trim()).filter(Boolean) : [];
	const tags = Array.isArray(input.tags)
		? input.tags.map((t) => String(t).trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`))
		: [];
	let description = input.description.trim();
	for (const tag of tags) {
		if (!new RegExp(`(?:^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "u").test(description)) {
			description = `${description} ${tag}`;
		}
	}

	let existingDoc = null;
	try {
		existingDoc = await readMarkdownFile(fileInfo.absPath);
	} catch (err) {
		if (!err || err.code !== "ENOENT") throw err;
	}

	if (input.isFileTask) {
		const fmPatch = {
			task: true,
			description,
			status: statusConfig.symbol,
		};
		if (priority !== null) fmPatch.priority = priority;
		if (input.recurrence) fmPatch.recurrence = input.recurrence;
		if (input.onCompletion) fmPatch.onCompletion = input.onCompletion;
		if (taskId) fmPatch.id = taskId;
		if (input.dependsOn) fmPatch.dependsOn = input.dependsOn;
		if (assignee.length > 0) fmPatch.assignee = assignee;
		if (input.location) fmPatch.location = input.location;
		if (tags.length > 0) fmPatch.tags = tags.map((t) => t.replace(/^#/u, ""));
		for (const k of ["start", "created", "scheduled", "due", "done", "cancelled", "remind"]) {
			if (dates[k]) fmPatch[k] = dates[k];
		}

		const nextContent = applyFrontmatterPatchToContent(existingDoc?.content ?? "", fmPatch);
		await writeMarkdownFile(fileInfo.absPath, nextContent, existingDoc ?? {});
		return {
			path: fileInfo.vaultPath,
			lineNumber: -1,
			parentLine: null,
			isFileTask: true,
			id: taskId,
			description,
		};
	}

	const content = existingDoc?.content ?? "";
	const lines = content.length > 0 ? content.split("\n") : [];
	const tree = buildTaskTree(lines, ctx.registry);

	let parentNode;
	if (typeof parentLineNumber === "number") {
		parentNode = tree.byLine.get(parentLineNumber);
		if (!parentNode?.task) {
			throw new Error(`Parent task not found at "${fileInfo.vaultPath}" line ${parentLineNumber}.`);
		}
	}

	const { useTab, tabSize } = ctx.indentConfig;
	const oneLevelIndent = useTab ? "\t" : " ".repeat(tabSize);
	const parentPrefix = parentNode ? parentNode.indentation : "";
	const indentPrefix = parentNode ? `${parentPrefix}${oneLevelIndent}` : "";
	const format = ctx.settings.preferredTaskFormat ?? "dataview";

	const taskLine = {
		listMarker: "-",
		data: {
			status: statusConfig.type,
			description,
			priority,
			dates,
			recurrence: input.recurrence ?? null,
			onCompletion: input.onCompletion ?? null,
			dependsOn: input.dependsOn ?? null,
			id: taskId,
			assignee,
			location: input.location ?? null,
			blockLink: null,
			tags: [],
			unmatched: null,
		},
		original: "",
	};

	const serialized = serializeTaskLine(taskLine, indentPrefix, ctx.registry, format);
	const insertion = parentNode ? `${parentPrefix}${oneLevelIndent}${serialized.trimStart()}` : serialized;

	if (parentNode) {
		const insertionLineNumber = getSubtreeLineRange(parentNode).to;
		lines.splice(insertionLineNumber + 1, 0, insertion);
		const nextContent = lines.join("\n");
		await writeMarkdownFile(fileInfo.absPath, nextContent, existingDoc ?? {});
		return {
			path: fileInfo.vaultPath,
			lineNumber: insertionLineNumber + 1,
			parentLine: parentNode.lineNumber,
			isFileTask: false,
			id: taskId,
			line: insertion,
		};
	}

	const hadTrailingNewline = content.endsWith("\n");
	const separator = content.length > 0 && !hadTrailingNewline ? "\n" : "";
	const newLineNumber = content.length === 0 ? 0 : (hadTrailingNewline ? lines.length - 1 : lines.length);
	const nextContent = `${content}${separator}${insertion}\n`;
	await writeMarkdownFile(fileInfo.absPath, nextContent, existingDoc ?? {});
	return {
		path: fileInfo.vaultPath,
		lineNumber: newLineNumber,
		parentLine: null,
		isFileTask: false,
		id: taskId,
		line: insertion,
	};
}

export async function updateTaskStatus(ctx, selector, targetStatusInput, options = {}) {
	const target = await resolveTaskTarget(ctx, selector);
	const targetSymbol =
		String(targetStatusInput).trim().toLowerCase() === "toggle"
			? (target.task.status === "DONE" || target.task.status === "CANCELLED" ? " " : "x")
			: normalizeStatusInput(targetStatusInput);

	const statusConfig = ctx.registry.get(targetSymbol);
	if (statusConfig.type === "DONE" && !options.force) {
		const unfinished = await getUnfinishedDependencies(ctx, target.task.dependsOn);
		if (unfinished.length > 0) {
			throw new Error(`Task is blocked by unfinished dependencies: ${unfinished.join(", ")}`);
		}
	}

	const fileInfo = resolveVaultFilePath(ctx.vaultRoot, target.path);
	const doc = await readMarkdownFile(fileInfo.absPath);
	let lines = [...doc.lines];
	const { frontmatter } = parseFrontmatter(lines);
	const tree = buildTaskTree(lines, ctx.registry);
	const hasBodyTasks = tree.nodes.some((n) => Boolean(n.task));
	const completedIds = new Set();

	if (target.lineNumber === -1) {
		const fmRecord = parseFrontmatterTask(
			{ path: fileInfo.vaultPath, basename: fileInfo.basename },
			frontmatter,
			ctx.registry,
			hasBodyTasks,
		);
		if (!fmRecord) throw new Error(`Frontmatter task not found in "${target.path}".`);

		const updatedData = applyTaskStatus(
			fmRecord.task,
			statusConfig.type,
			ctx.settings,
			{ fillMissingStatusDate: true },
			todayString,
		);
		if (statusConfig.type === "DONE" && fmRecord.task.id && fmRecord.task.status !== "DONE") {
			completedIds.add(fmRecord.task.id);
		}

		const behavior =
			statusConfig.type === "DONE"
				? "finish"
				: statusConfig.type === "CANCELLED"
					? "cancel"
					: fmRecord.task.status === "CANCELLED"
						? "uncancel"
						: "unfinish";
		if (shouldCascade(behavior, ctx.settings)) {
			const format = ctx.settings.preferredTaskFormat ?? "dataview";
			for (let i = 0; i < lines.length; i++) {
				const node = tree.byLine.get(i);
				if (node?.task) {
					const oldNodeStatus = node.task.data.status;
					const nodeUpdated = applyTaskStatus(
						node.task.data,
						statusConfig.type,
						ctx.settings,
						{ fillMissingStatusDate: true },
						todayString,
					);
					if (statusConfig.type === "DONE" && node.task.data.id && oldNodeStatus !== "DONE") {
						completedIds.add(node.task.data.id);
					}
					const indent = getIndentPrefix(taskDepth(node), ctx.indentConfig, lines);
					lines[i] = serializeTaskLine({ ...node.task, data: nodeUpdated }, indent, ctx.registry, format);
				}
			}
		}

		const fmPatch = buildFrontmatterPatch(fmRecord.task, updatedData, ctx.registry, fmRecord.rawStatus);
		const nextContent = applyFrontmatterPatchToContent(lines.join("\n"), fmPatch);
		await writeMarkdownFile(fileInfo.absPath, nextContent, doc);
		const unblocked = completedIds.size > 0 ? await unblockDependentTasks(ctx, [...completedIds]) : [];
		return {
			path: target.path,
			lineNumber: -1,
			previousStatus: target.task.status,
			status: updatedData.status,
			statusSymbol: ctx.registry.getByType(updatedData.status).symbol,
			changedCount: 1 + completedIds.size,
			recurrenceCreated: null,
			deletedOnCompletion: false,
			unblocked,
		};
	}

	const mutResult = mutateLineStatus(lines, target.lineNumber, targetSymbol, ctx);
	if (!mutResult) {
		throw new Error(`Task not found at "${target.path}" line ${target.lineNumber}.`);
	}
	if (mutResult.noChange) {
		return {
			path: target.path,
			lineNumber: target.lineNumber,
			previousStatus: target.task.status,
			status: target.task.status,
			statusSymbol: targetSymbol,
			changedCount: 0,
			recurrenceCreated: null,
			deletedOnCompletion: false,
			unblocked: [],
		};
	}

	for (const [ln, updatedTask] of mutResult.changedTasks.entries()) {
		const origNode = tree.byLine.get(ln);
		if (updatedTask.status === "DONE" && origNode?.task?.data.id && origNode.task.data.status !== "DONE") {
			completedIds.add(origNode.task.data.id);
		}
	}

	lines.splice(mutResult.fromLine, mutResult.toLine - mutResult.fromLine + 1, ...mutResult.replacement);

	let nextContent = lines.join("\n");
	const postTree = buildTaskTree(lines, ctx.registry);
	const fmRecord = parseFrontmatterTask(
		{ path: fileInfo.vaultPath, basename: fileInfo.basename },
		frontmatter,
		ctx.registry,
		postTree.nodes.some((n) => Boolean(n.task)),
	);
	if (fmRecord) {
		const rootTasks = postTree.nodes.filter((n) => n.task && n.parentLine === null);
		if (rootTasks.length > 0) {
			const currentType = fmRecord.task.status;
			let targetType = null;
			const hasIncomplete = rootTasks.some(
				(n) => n.task && n.task.data.status !== "DONE" && n.task.data.status !== "CANCELLED",
			);
			const allDoneOrCancelled = rootTasks.every(
				(n) => n.task && (n.task.data.status === "DONE" || n.task.data.status === "CANCELLED"),
			);
			const allCancelled = rootTasks.every((n) => n.task && n.task.data.status === "CANCELLED");

			if (hasIncomplete) {
				if ((currentType === "DONE" || currentType === "CANCELLED") && ctx.settings.toggleBehavior.parentOnUnfinish) {
					targetType = "TODO";
				}
			} else if (allDoneOrCancelled) {
				if (currentType === "TODO" || currentType === "IN_PROGRESS" || currentType === "ON_HOLD") {
					if (allCancelled && ctx.settings.toggleBehavior.parentOnCancel) {
						targetType = "CANCELLED";
					} else if (ctx.settings.toggleBehavior.parentOnFinish) {
						targetType = "DONE";
					}
				}
			}
			if (targetType && targetType !== currentType) {
				const updatedFmData = applyTaskStatus(
					fmRecord.task,
					targetType,
					ctx.settings,
					{ fillMissingStatusDate: true },
					todayString,
				);
				if (targetType === "DONE" && fmRecord.task.id && currentType !== "DONE") {
					completedIds.add(fmRecord.task.id);
				}
				const fmPatch = buildFrontmatterPatch(fmRecord.task, updatedFmData, ctx.registry, fmRecord.rawStatus);
				nextContent = applyFrontmatterPatchToContent(nextContent, fmPatch);
			}
		}
	}

	await writeMarkdownFile(fileInfo.absPath, nextContent, doc);
	const unblocked = completedIds.size > 0 ? await unblockDependentTasks(ctx, [...completedIds]) : [];

	return {
		path: target.path,
		lineNumber: target.lineNumber,
		previousStatus: target.task.status,
		status: mutResult.changedTasks.get(target.lineNumber)?.status ?? statusConfig.type,
		statusSymbol: targetSymbol,
		changedCount: mutResult.changedTasks.size,
		recurrenceCreated: mutResult.recurrenceCreated ?? null,
		deletedOnCompletion: Boolean(mutResult.deletedOnCompletion),
		warning: mutResult.warning ?? null,
		unblocked,
	};
}

export async function deleteTask(ctx, selector, options = {}) {
	const target = await resolveTaskTarget(ctx, selector);
	const fileInfo = resolveVaultFilePath(ctx.vaultRoot, target.path);
	const doc = await readMarkdownFile(fileInfo.absPath);
	const lines = [...doc.lines];

	if (target.lineNumber === -1) {
		const preview = {
			path: target.path,
			lineNumber: -1,
			action: "remove-frontmatter-task",
			deletedLines: [],
			dryRun: Boolean(options.dryRun),
		};
		if (!options.dryRun) {
			const nextContent = applyFrontmatterPatchToContent(doc.content, { task: null });
			await writeMarkdownFile(fileInfo.absPath, nextContent, doc);
		}
		return preview;
	}

	const tree = buildTaskTree(lines, ctx.registry);
	const node = tree.byLine.get(target.lineNumber);
	if (!node) {
		throw new Error(`Task not found at "${target.path}" line ${target.lineNumber}.`);
	}

	const subtreeLines = getSubtreeNodes(node).map((n) => n.lineNumber).sort((a, b) => a - b);
	const preview = {
		path: target.path,
		lineNumber: target.lineNumber,
		action: "delete-lines",
		deletedLineNumbers: subtreeLines,
		deletedLines: subtreeLines.map((ln) => lines[ln]),
		dryRun: Boolean(options.dryRun),
	};

	if (!options.dryRun) {
		for (const ln of [...subtreeLines].sort((a, b) => b - a)) {
			lines.splice(ln, 1);
		}
		await writeMarkdownFile(fileInfo.absPath, lines.join("\n"), doc);
	}
	return preview;
}
