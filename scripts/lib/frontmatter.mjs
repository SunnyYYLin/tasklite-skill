import { resolveDueDateFromStart } from "./dates.mjs";
import { normalizeAssignees } from "./format.mjs";

const PRIORITY_MAP = {
	"🔺": "highest",
	highest: "highest",
	"⏫": "high",
	high: "high",
	"🔼": "medium",
	medium: "medium",
	"🔽": "low",
	low: "low",
	"⏬": "lowest",
	lowest: "lowest",
};

const STATUS_KEYWORD_MAP = {
	todo: " ",
	open: " ",
	done: "x",
	complete: "x",
	completed: "x",
	"in-progress": "/",
	inprogress: "/",
	doing: "/",
	active: "/",
	cancelled: "-",
	canceled: "-",
};

/**
 * Locate the YAML frontmatter block (`---` on line 0 through closing `---`).
 * Returns `{ hasFrontmatter: false, startLine: -1, endLine: -1 }` if none.
 */
export function findFrontmatterRange(lines) {
	if (!Array.isArray(lines) || lines.length < 2) {
		return { hasFrontmatter: false, startLine: -1, endLine: -1 };
	}
	if (lines[0].trim() !== "---") {
		return { hasFrontmatter: false, startLine: -1, endLine: -1 };
	}
	for (let i = 1; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === "---" || trimmed === "...") {
			return { hasFrontmatter: true, startLine: 0, endLine: i };
		}
	}
	return { hasFrontmatter: false, startLine: -1, endLine: -1 };
}

function unquoteScalar(raw) {
	const trimmed = raw.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1).replace(/''/gu, "'");
	}
	return null;
}

function stripUnquotedComment(raw) {
	// Strip `# comment` only when preceded by whitespace and not inside quotes
	const idx = raw.search(/\s+#/u);
	return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

function parseInlineArray(raw) {
	const inner = raw.slice(1, -1).trim();
	if (!inner) return [];
	const items = [];
	let current = "";
	let quote = null;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (quote) {
			if (ch === "\\" && quote === '"' && i + 1 < inner.length) {
				current += ch + inner[i + 1];
				i++;
				continue;
			}
			if (ch === "'" && quote === "'" && inner[i + 1] === "'") {
				current += "''";
				i++;
				continue;
			}
			current += ch;
			if (ch === quote) quote = null;
		} else {
			if (ch === '"' || ch === "'") {
				quote = ch;
				current += ch;
			} else if (ch === ",") {
				const parsed = parseYamlScalar(current);
				if (parsed !== "") items.push(parsed);
				current = "";
			} else {
				current += ch;
			}
		}
	}
	const last = parseYamlScalar(current);
	if (last !== "") items.push(last);
	return items;
}

export function parseYamlScalar(raw) {
	const quoted = unquoteScalar(raw);
	if (quoted !== null) return quoted;

	const stripped = stripUnquotedComment(raw);
	if (stripped === "" || stripped === "null" || stripped === "~") return null;
	if (stripped === "true") return true;
	if (stripped === "false") return false;
	if (stripped.startsWith("[") && stripped.endsWith("]")) {
		return parseInlineArray(stripped);
	}
	if (/^-?\d+(?:\.\d+)?$/u.test(stripped)) {
		// Keep ISO dates or pure numbers cleanly; dates are YYYY-MM-DD so they won't match here
		return Number(stripped);
	}
	return stripped;
}

export function parseFrontmatter(lines) {
	const range = findFrontmatterRange(lines);
	if (!range.hasFrontmatter) {
		return { hasFrontmatter: false, endLine: -1, frontmatter: null };
	}

	const frontmatter = {};
	const yamlLines = lines.slice(1, range.endLine);

	for (let i = 0; i < yamlLines.length; i++) {
		const line = yamlLines[i];
		if (!line.trim() || /^\s*#/u.test(line)) continue;
		const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
		if (!keyMatch) continue;

		const key = keyMatch[1];
		const rawRest = keyMatch[2] ?? "";
		const trimmedRest = rawRest.trim();

		if (trimmedRest && !trimmedRest.startsWith("#")) {
			frontmatter[key] = parseYamlScalar(rawRest);
			continue;
		}

		// Empty inline value: check for indented block list or same-indent list items (`- value`)
		const listItems = [];
		let j = i + 1;
		while (j < yamlLines.length) {
			const nextLine = yamlLines[j];
			if (!nextLine.trim() || /^\s*#/u.test(nextLine)) {
				j++;
				continue;
			}
			const listMatch = nextLine.match(/^\s*-\s+(.*)$/u);
			if (listMatch) {
				const itemVal = parseYamlScalar(listMatch[1]);
				listItems.push(itemVal === null ? "" : itemVal);
				j++;
				continue;
			}
			if (/^\s+/u.test(nextLine)) {
				// Indented nested object or multiline continuation: skip safely without crashing
				j++;
				continue;
			}
			break;
		}
		frontmatter[key] = listItems.length > 0 ? listItems : null;
		i = j - 1;
	}

	return {
		hasFrontmatter: true,
		endLine: range.endLine,
		frontmatter,
	};
}

function resolveStatusSymbol(rawStatus, registry) {
	if (typeof rawStatus !== "string") return " ";
	const normalized = rawStatus.trim().toLowerCase();
	if (registry.has(rawStatus)) return rawStatus;
	if (registry.has(normalized)) return normalized;
	if (normalized in STATUS_KEYWORD_MAP) return STATUS_KEYWORD_MAP[normalized] ?? " ";
	for (const config of registry.getAll()) {
		if (config.name.toLowerCase() === normalized) return config.symbol;
		if (config.type.toLowerCase() === normalized) return config.symbol;
		if (config.type.toLowerCase().replace("_", "-") === normalized) return config.symbol;
	}
	return " ";
}

function fmDateField(value) {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}

export function isTruthyFrontmatterTask(fm) {
	return Boolean(fm && fm.task);
}

export function isIgnoredByFrontmatter(fm) {
	return fm?.tasks === "ignore";
}

export function parseFrontmatterTask(fileInfo, frontmatter, registry, hasChildren) {
	if (!frontmatter || !frontmatter.task) return null;
	if (frontmatter.tasks === "ignore") return null;

	const rawStatus = typeof frontmatter.status === "string" ? frontmatter.status : null;
	const statusSymbol = resolveStatusSymbol(frontmatter.status, registry);
	const statusConfig = registry.get(statusSymbol);

	const rawPriority = frontmatter.priority;
	const priority = typeof rawPriority === "string" && rawPriority in PRIORITY_MAP
		? PRIORITY_MAP[rawPriority]
		: null;

	const rawOnCompletion = frontmatter.onCompletion ?? frontmatter.on_completion;
	const onCompletion = rawOnCompletion === "delete" || rawOnCompletion === "keep"
		? rawOnCompletion
		: null;

	const rawAssignee = frontmatter.assignee ?? frontmatter.person;
	let assignee = [];
	if (Array.isArray(rawAssignee)) {
		assignee = rawAssignee.map(String).map((p) => p.trim()).filter(Boolean);
	} else if (typeof rawAssignee === "string") {
		assignee = rawAssignee.split("&").map((p) => p.trim()).filter(Boolean);
	}
	assignee = normalizeAssignees(assignee);

	const rawTags = frontmatter.tags;
	let tags = [];
	if (Array.isArray(rawTags)) {
		tags = rawTags.map((t) => {
			const s = String(t).trim();
			if (!s) return "";
			return s.startsWith("#") ? s : `#${s}`;
		}).filter(Boolean);
	} else if (typeof rawTags === "string") {
		tags = rawTags.split(/[\s,]+/u).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
	}

	const start = fmDateField(frontmatter.start);
	const rawDue = fmDateField(frontmatter.due);
	const due = resolveDueDateFromStart(rawDue, start) ?? rawDue;

	const task = {
		status: statusConfig.type,
		description: typeof frontmatter.description === "string" && frontmatter.description.length > 0
			? frontmatter.description
			: fileInfo.basename,
		priority,
		dates: {
			start,
			created: fmDateField(frontmatter.created),
			scheduled: fmDateField(frontmatter.scheduled),
			due,
			done: fmDateField(frontmatter.done),
			cancelled: fmDateField(frontmatter.cancelled),
			remind: fmDateField(frontmatter.remind),
		},
		recurrence: typeof frontmatter.recurrence === "string" ? frontmatter.recurrence : null,
		onCompletion,
		id: typeof frontmatter.id === "string" ? frontmatter.id : null,
		dependsOn: typeof frontmatter.dependsOn === "string" ? frontmatter.dependsOn : null,
		assignee,
		location: typeof frontmatter.location === "string" ? frontmatter.location : null,
		blockLink: null,
		tags,
		unmatched: null,
	};

	return {
		path: fileInfo.path,
		basename: fileInfo.basename,
		lineNumber: -1,
		parentLine: null,
		depth: -1,
		hasChildren,
		task,
		rawStatus,
	};
}

export function buildFrontmatterPatch(current, updates, registry, currentStatusRaw) {
	const patch = {};
	const useKeyword = typeof currentStatusRaw === "string" && !registry.has(currentStatusRaw);

	if (updates.status !== undefined) {
		patch.status = useKeyword
			? updates.status.toLowerCase().replace("_", "-")
			: registry.getByType(updates.status).symbol;
	}
	if (updates.priority !== undefined) patch.priority = updates.priority;
	if (updates.description !== undefined) patch.description = updates.description;
	if (updates.recurrence !== undefined) patch.recurrence = updates.recurrence;
	if (updates.onCompletion !== undefined) patch.onCompletion = updates.onCompletion;
	if (updates.id !== undefined) patch.id = updates.id;
	if (updates.dependsOn !== undefined) patch.dependsOn = updates.dependsOn;
	if (updates.assignee !== undefined) patch.assignee = updates.assignee;
	if (updates.location !== undefined) patch.location = updates.location ?? null;

	if (updates.dates) {
		const d = updates.dates;
		const startDate = d.start !== undefined ? d.start : current.dates.start;
		const resolvedDue = d.due !== undefined ? (resolveDueDateFromStart(d.due, startDate) ?? d.due) : undefined;
		if (d.start !== undefined) patch.start = d.start ?? null;
		if (d.created !== undefined) patch.created = d.created ?? null;
		if (d.scheduled !== undefined) patch.scheduled = d.scheduled ?? null;
		if (d.due !== undefined) patch.due = resolvedDue ?? null;
		if (d.done !== undefined) patch.done = d.done ?? null;
		if (d.cancelled !== undefined) patch.cancelled = d.cancelled ?? null;
		if (d.remind !== undefined) patch.remind = d.remind ?? null;
	}

	if (!("status" in patch)) {
		patch.status = useKeyword
			? current.status.toLowerCase().replace("_", "-")
			: registry.getByType(current.status).symbol;
	}

	return patch;
}

function needsYamlQuotes(str) {
	if (str === "") return true;
	if (/^\s|\s$/u.test(str)) return true;
	if (/^(true|false|null|~)$/iu.test(str)) return true;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/u.test(str)) return true;
	if (/:\s|\s#/u.test(str) || str.endsWith(":")) return true;
	if (/[\r\n\t]/u.test(str)) return true;
	return false;
}

function formatYamlScalar(value) {
	if (typeof value === "boolean" || typeof value === "number") {
		return String(value);
	}
	const str = String(value);
	return needsYamlQuotes(str) ? JSON.stringify(str) : str;
}

function formatYamlKeyLines(key, value) {
	if (value === null || value === undefined) {
		return [];
	}
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return [`${key}: []`];
		}
		return [`${key}:`, ...value.map((item) => `  - ${formatYamlScalar(item)}`)];
	}
	return [`${key}: ${formatYamlScalar(value)}`];
}

export function applyFrontmatterPatchToContent(content, patch) {
	const normalized = content.replace(/\r\n/gu, "\n");
	const lines = normalized.length > 0 ? normalized.split("\n") : [];
	const range = findFrontmatterRange(lines);

	if (!range.hasFrontmatter) {
		const newYamlLines = [];
		for (const [key, value] of Object.entries(patch)) {
			newYamlLines.push(...formatYamlKeyLines(key, value));
		}
		if (newYamlLines.length === 0) return normalized;
		const header = `---\n${newYamlLines.join("\n")}\n---\n`;
		return normalized ? `${header}${normalized.replace(/^\n+/u, "")}` : `---\n${newYamlLines.join("\n")}\n---`;
	}

	const fmLines = lines.slice(1, range.endLine);
	const bodyLines = lines.slice(range.endLine + 1);
	const patchMap = new Map(Object.entries(patch));

	const resultLines = [];
	const handled = new Set();
	let skippingContinuation = false;

	for (let i = 0; i < fmLines.length; i++) {
		const line = fmLines[i];
		if (skippingContinuation) {
			// Continuation lines include indented lines and same-indent `- item` list lines
			if (/^\s*-\s+/u.test(line) || /^\s+/u.test(line) || !line.trim()) {
				continue;
			}
			skippingContinuation = false;
		}
		const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
		if (keyMatch) {
			const key = keyMatch[1];
			if (patchMap.has(key)) {
				handled.add(key);
				const rest = (keyMatch[2] ?? "").trim();
				if (!rest || rest.startsWith("#")) {
					skippingContinuation = true;
				}
				const replacementLines = formatYamlKeyLines(key, patchMap.get(key));
				resultLines.push(...replacementLines);
				continue;
			}
		}
		resultLines.push(line);
	}

	for (const [key, value] of patchMap) {
		if (!handled.has(key)) {
			resultLines.push(...formatYamlKeyLines(key, value));
		}
	}

	const after = bodyLines.join("\n");
	const fmBlock = resultLines.length > 0 ? `---\n${resultLines.join("\n")}\n---` : `---\n---`;
	if (bodyLines.length === 0) {
		return normalized.endsWith("\n") ? `${fmBlock}\n` : fmBlock;
	}
	return `${fmBlock}\n${after}`;
}
