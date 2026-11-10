import { listItemRegex, parseTaskLine } from "./format.mjs";
import { findFrontmatterRange } from "./frontmatter.mjs";

function isFenceLine(trimmedLine) {
	const match = trimmedLine.match(/^(?:>\s*)*(`{3,}|~{3,})/u);
	return match ? match[1] : null;
}

function inferListItems(lines) {
	const stack = [];
	const result = [];
	const fmRange = findFrontmatterRange(lines);
	const startIdx = fmRange.hasFrontmatter ? fmRange.endLine + 1 : 0;

	let activeFenceChar = null;
	let activeFenceLen = 0;

	for (let index = startIdx; index < lines.length; index++) {
		const line = lines[index];
		const trimmed = line.trim();
		const fence = isFenceLine(trimmed);
		if (fence) {
			const ch = fence[0];
			if (!activeFenceChar) {
				activeFenceChar = ch;
				activeFenceLen = fence.length;
				continue;
			}
			if (activeFenceChar === ch && fence.length >= activeFenceLen && /^(`+|~+)\s*$/u.test(trimmed.replace(/^(?:>\s*)*/u, ""))) {
				activeFenceChar = null;
				activeFenceLen = 0;
				continue;
			}
		}
		if (activeFenceChar) continue;

		const match = line.match(listItemRegex);
		if (!match) continue;
		const indent = (match[1] ?? "").replace(/\t/gu, "    ").length;
		while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}
		const parent = stack.length > 0 ? stack[stack.length - 1].line : -1;
		result.push({
			id: index.toString(),
			parent,
			task: match[3],
			position: {
				start: { line: index, col: 0, offset: 0 },
				end: { line: index, col: line.length, offset: 0 },
			},
		});
		stack.push({ indent, line: index });
	}

	return result;
}

function parentLineFromItem(item, lineNumber) {
	if (typeof item.parent !== "number" || item.parent < 0 || item.parent === lineNumber) return null;
	return item.parent;
}

function wouldCreateCycle(node, parent) {
	let current = parent;
	while (current) {
		if (current === node) return true;
		current = current.parent;
	}
	return false;
}

export function buildTaskTree(lines, registry) {
	const byLine = new Map();
	const nodes = [];
	const listItems = inferListItems(lines);

	for (const item of listItems) {
		const lineNumber = item.position.start.line;
		const line = lines[lineNumber];
		if (line === undefined) continue;

		const match = line.match(listItemRegex);
		if (!match) continue;

		const statusCharacter = match[3] ?? null;
		const node = {
			lineNumber,
			parentLine: parentLineFromItem(item, lineNumber),
			parent: null,
			children: [],
			original: line,
			indentation: match[1] ?? "",
			listMarker: match[2] ?? "-",
			statusCharacter,
			description: (match[4] ?? "").trim(),
			task: statusCharacter === null ? null : parseTaskLine(line, registry.get(statusCharacter).type),
		};
		nodes.push(node);
		byLine.set(lineNumber, node);
	}

	for (const node of nodes) {
		const parent = node.parentLine === null ? null : byLine.get(node.parentLine);
		if (parent && parent !== node && !wouldCreateCycle(node, parent)) {
			node.parent = parent;
			parent.children.push(node);
		}
	}

	return { nodes, byLine };
}

export function getSubtreeNodes(root) {
	const result = [];
	const visited = new Set();
	const visit = (node) => {
		if (visited.has(node)) return;
		visited.add(node);
		result.push(node);
		for (const child of node.children) visit(child);
	};
	visit(root);
	return result.sort((a, b) => a.lineNumber - b.lineNumber);
}

export function getSubtreeLineRange(root) {
	const nodes = getSubtreeNodes(root);
	return {
		from: nodes[0]?.lineNumber ?? root.lineNumber,
		to: nodes[nodes.length - 1]?.lineNumber ?? root.lineNumber,
	};
}

export function taskDepth(node) {
	let depth = 0;
	let current = node.parent;
	while (current) {
		depth++;
		current = current.parent;
	}
	return depth;
}

export function getTaskParentLine(node) {
	let current = node.parent;
	while (current) {
		if (current.task) return current.lineNumber;
		current = current.parent;
	}
	return null;
}

export function getIndentPrefix(depth, indentConfig, lines = []) {
	if (depth <= 0) return "";
	if (indentConfig) {
		const oneLevel = indentConfig.useTab ? "\t" : " ".repeat(indentConfig.tabSize);
		return oneLevel.repeat(depth);
	}
	for (const line of lines) {
		const match = line.match(/^([\s\t]+)/u);
		if (match?.[1]) {
			if (match[1].startsWith(" ")) return match[1].repeat(depth);
			if (match[1].startsWith("\t")) return "\t".repeat(depth);
		}
	}
	return "\t".repeat(depth);
}
