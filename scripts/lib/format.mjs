import { normalizeTaskDateValue, resolveDueDateFromStart } from "./dates.mjs";

export const TASK_SYMBOLS = {
	priority: {
		highest: "🔺",
		high: "⏫",
		medium: "🔼",
		low: "🔽",
		lowest: "⏬",
	},
	start: "🛫",
	created: "➕",
	scheduled: "⏳",
	due: "📅",
	done: "✅",
	cancelled: "❌",
	recurrence: "🔁",
	onCompletion: "🏁",
	dependsOn: "⛔",
	id: "🆔",
	assignee: "👤",
	remind: "⏰",
	location: "📍",
};

const BUILT_IN_STATUSES = [
	{ symbol: " ", name: "Todo", nextStatusSymbol: "x", availableAsCommand: true, type: "TODO" },
	{ symbol: "x", name: "Done", nextStatusSymbol: " ", availableAsCommand: true, type: "DONE" },
	{ symbol: "/", name: "In progress", nextStatusSymbol: "x", availableAsCommand: true, type: "IN_PROGRESS" },
	{ symbol: "-", name: "Cancelled", nextStatusSymbol: " ", availableAsCommand: true, type: "CANCELLED" },
];

function inferStatusType(symbol) {
	if (symbol === "x" || symbol === "X") return "DONE";
	if (symbol === "/") return "IN_PROGRESS";
	if (symbol === "-") return "CANCELLED";
	if (symbol === "") return "EMPTY";
	return "TODO";
}

export class StatusRegistry {
	constructor() {
		this.bySymbol = new Map(BUILT_IN_STATUSES.map((s) => [s.symbol, { ...s }]));
	}

	register(config) {
		this.bySymbol.set(config.symbol, { ...config });
	}

	registerAll(configs) {
		for (const config of configs) {
			this.register(config);
		}
	}

	get(symbol) {
		return this.bySymbol.get(symbol) ?? {
			symbol,
			name: `Unknown (${symbol || "empty"})`,
			nextStatusSymbol: "x",
			availableAsCommand: false,
			type: inferStatusType(symbol),
		};
	}

	has(symbol) {
		return this.bySymbol.has(symbol);
	}

	getAll() {
		return [...this.bySymbol.values()];
	}

	next(status) {
		return this.get(status.nextStatusSymbol);
	}

	getByType(type) {
		for (const config of this.bySymbol.values()) {
			if (config.type === type) return config;
		}
		if (type === "DONE") return this.get("x");
		if (type === "IN_PROGRESS") return this.get("/");
		if (type === "CANCELLED") return this.get("-");
		return this.get(" ");
	}

	recurrenceStatus(afterCompletedStatusSymbol) {
		let candidate = this.next(this.get(afterCompletedStatusSymbol));
		for (let index = 0; index < this.bySymbol.size + 1; index++) {
			if (candidate.type === "TODO" || candidate.type === "IN_PROGRESS") {
				return candidate;
			}
			candidate = this.next(candidate);
		}
		return this.get(" ");
	}
}

export function normalizeStatusInput(raw) {
	if (raw === undefined || raw === null) return " ";
	const str = String(raw);
	if (str === " " || str === "x" || str === "X" || str === "/" || str === "-") {
		return str === "X" ? "x" : str;
	}
	const norm = str.trim().toLowerCase();
	if (norm === "" || norm === "todo" || norm === "open") return " ";
	if (norm === "done" || norm === "complete" || norm === "completed" || norm === "x") return "x";
	if (norm === "in-progress" || norm === "in_progress" || norm === "inprogress" || norm === "doing" || norm === "active" || norm === "/") return "/";
	if (norm === "cancelled" || norm === "canceled" || norm === "cancel" || norm === "-") return "-";
	throw new Error(`Unsupported status "${raw}". Use: todo (" "), done ("x"), in-progress ("/"), cancelled ("-"), or toggle.`);
}

export function normalizeAssignees(value) {
	if (!Array.isArray(value)) return [];
	const assignees = value
		.filter((name) => typeof name === "string")
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
	return Array.from(new Set(assignees)).sort();
}

export function normalizePriority(pri) {
	if (pri === null || pri === undefined || pri === "") return null;
	const raw = String(pri).trim().toLowerCase();
	if (raw === "none" || raw === "clear") return null;
	if (raw === "highest" || pri === "🔺") return "highest";
	if (raw === "high" || pri === "⏫") return "high";
	if (raw === "medium" || raw === "med" || pri === "🔼") return "medium";
	if (raw === "low" || pri === "🔽") return "low";
	if (raw === "lowest" || pri === "⏬") return "lowest";
	throw new Error(`Invalid priority "${pri}". Expected highest/high/medium/low/lowest or 🔺⏫🔼🔽⏬.`);
}

export const taskLineRegex = /^([\s\t>]*)([-*+]|[0-9]+[.)]) +\[(.)\] *(.*)$/u;
export const listItemRegex = /^([\s\t>]*)([-*+]|[0-9]+[.)]) *(?:\[(.)\] *)?(.*)$/u;
const DATE_REGEX_SRC = "\\d{4}-\\d{1,2}-\\d{1,2}(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[AaPp][Mm])?)?";
const blockLinkRegex = / \^[a-zA-Z0-9-]+$/u;
const tagRegex = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+/gu;

export function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createDateExtractor(key, symbol) {
	return {
		label: symbol,
		extract(description, data) {
			const regex = new RegExp(`${escapeRegExp(symbol)}\\ufe0f? *(${DATE_REGEX_SRC})`, "u");
			const match = description.match(regex);
			if (!match) return [description, false];
			data.dates[key] = match[1] ? normalizeTaskDateValue(match[1]) : null;
			return [description.replace(regex, "").replace(/ {2,}/gu, " ").trim(), true];
		},
	};
}

function createStringExtractor(key, symbol, valuePattern) {
	return {
		label: symbol,
		extract(description, data) {
			const regex = new RegExp(`${escapeRegExp(symbol)}\\ufe0f? *(${valuePattern})`, "u");
			const match = description.match(regex);
			if (!match) return [description, false];
			data[key] = (match[1] ?? "").trim();
			return [description.replace(regex, "").replace(/ {2,}/gu, " ").trim(), true];
		},
	};
}

const priorityExtractor = {
	label: "priority",
	extract(description, data) {
		const priorities = Object.values(TASK_SYMBOLS.priority).join("|");
		const regex = new RegExp(` ?(${priorities})$`, "u");
		const match = description.match(regex);
		if (!match) return [description, false];
		const emoji = match[1];
		if (emoji === "🔺") data.priority = "highest";
		else if (emoji === "⏫") data.priority = "high";
		else if (emoji === "🔼") data.priority = "medium";
		else if (emoji === "🔽") data.priority = "low";
		else if (emoji === "⏬") data.priority = "lowest";
		return [description.replace(regex, "").trim(), true];
	},
};

const assigneeExtractor = {
	label: TASK_SYMBOLS.assignee,
	extract(description, data) {
		const symbol = TASK_SYMBOLS.assignee;
		const regex = new RegExp(
			`${escapeRegExp(symbol)}\\ufe0f? *([^📍📅⏳🛫➕✅❌⏰🔺⏫🔼🔽⏬🔁🏁⛔🆔\\^\\n]+)`,
			"u",
		);
		const match = description.match(regex);
		if (!match) return [description, false];
		const raw = (match[1] ?? "").trim();
		data.assignee = raw ? raw.split("&").map((p) => p.trim()).filter(Boolean) : [];
		return [description.replace(regex, "").replace(/ {2,}/gu, " ").trim(), true];
	},
};

const locationExtractor = {
	label: TASK_SYMBOLS.location,
	extract(description, data) {
		const symbol = TASK_SYMBOLS.location;
		const regex = new RegExp(
			`${escapeRegExp(symbol)}\\ufe0f? *([^📍📅⏳🛫➕✅❌⏰🔺⏫🔼🔽⏬🔁🏁⛔🆔👤\\^\\n]+)`,
			"u",
		);
		const match = description.match(regex);
		if (!match) return [description, false];
		data.location = (match[1] ?? "").trim();
		return [description.replace(regex, "").replace(/ {2,}/gu, " ").trim(), true];
	},
};

const INLINE_FIELD_REGEX =
	/(?:\[|\()([a-zA-Z0-9_\u4e00-\u9fa5📅⏳🛫➕✅❌⏰🔺⏫🔼🔽⏬🔁🏁⛔🆔👤📍]+)::\s*([^\])]+?)(?:\]|\))/gu;

function parseInlinePriority(val) {
	const lower = val.toLowerCase().trim();
	if (lower === "highest" || lower === "🔺") return "highest";
	if (lower === "high" || lower === "⏫") return "high";
	if (lower === "medium" || lower === "🔼") return "medium";
	if (lower === "lowest" || lower === "⏬") return "lowest";
	if (lower === "low" || lower === "🔽") return "low";
	return null;
}

const inlineFieldExtractor = {
	label: "inlineField",
	extract(description, data) {
		const matches = [...description.matchAll(INLINE_FIELD_REGEX)];
		for (const match of matches) {
			const fullMatch = match[0];
			const rawKey = match[1]?.trim() ?? "";
			const key = rawKey.toLowerCase();
			const val = match[2]?.trim() ?? "";
			let matchedField = true;

			if (key === "due" || rawKey === TASK_SYMBOLS.due) {
				data.dates.due = normalizeTaskDateValue(val);
			} else if (key === "scheduled" || rawKey === TASK_SYMBOLS.scheduled) {
				data.dates.scheduled = normalizeTaskDateValue(val);
			} else if (key === "start" || rawKey === TASK_SYMBOLS.start) {
				data.dates.start = normalizeTaskDateValue(val);
			} else if (key === "created" || rawKey === TASK_SYMBOLS.created) {
				data.dates.created = normalizeTaskDateValue(val);
			} else if (key === "completion" || key === "done" || rawKey === TASK_SYMBOLS.done) {
				data.dates.done = normalizeTaskDateValue(val);
			} else if (key === "cancelled" || rawKey === TASK_SYMBOLS.cancelled) {
				data.dates.cancelled = normalizeTaskDateValue(val);
			} else if (key === "remind" || rawKey === TASK_SYMBOLS.remind) {
				data.dates.remind = normalizeTaskDateValue(val);
			} else if (key === "priority") {
				const prio = parseInlinePriority(val);
				if (prio) data.priority = prio;
			} else if (rawKey === "🔺") {
				data.priority = "highest";
			} else if (rawKey === "⏫") {
				data.priority = "high";
			} else if (rawKey === "🔼") {
				data.priority = "medium";
			} else if (rawKey === "🔽") {
				data.priority = "low";
			} else if (rawKey === "⏬") {
				data.priority = "lowest";
			} else if (key === "repeat" || key === "recurrence" || rawKey === TASK_SYMBOLS.recurrence) {
				data.recurrence = val;
			} else if (key === "oncompletion" || rawKey === TASK_SYMBOLS.onCompletion) {
				if (val === "delete" || val === "keep") {
					data.onCompletion = val;
				}
			} else if (key === "dependson" || key === "blockedby" || rawKey === TASK_SYMBOLS.dependsOn) {
				data.dependsOn = val;
			} else if (key === "id" || rawKey === TASK_SYMBOLS.id) {
				data.id = val;
			} else if (key === "assignee" || key === "assigned" || key === "person" || rawKey === TASK_SYMBOLS.assignee) {
				data.assignee = val ? val.split("&").map((p) => p.trim()).filter(Boolean) : [];
			} else if (key === "location" || key === "place" || key === "loc" || rawKey === TASK_SYMBOLS.location) {
				data.location = val;
			} else {
				matchedField = false;
			}

			if (matchedField) {
				const cleaned = description.replace(fullMatch, "").replace(/ {2,}/gu, " ").trim();
				return [cleaned, true];
			}
		}
		return [description, false];
	},
};

export const DEFAULT_EXTRACTORS = [
	inlineFieldExtractor,
	priorityExtractor,
	createDateExtractor("done", TASK_SYMBOLS.done),
	createDateExtractor("cancelled", TASK_SYMBOLS.cancelled),
	createDateExtractor("due", TASK_SYMBOLS.due),
	createDateExtractor("scheduled", TASK_SYMBOLS.scheduled),
	createDateExtractor("start", TASK_SYMBOLS.start),
	createDateExtractor("created", TASK_SYMBOLS.created),
	createDateExtractor("remind", TASK_SYMBOLS.remind),
	createStringExtractor("recurrence", TASK_SYMBOLS.recurrence, "[a-zA-Z0-9, !]+"),
	createStringExtractor("onCompletion", TASK_SYMBOLS.onCompletion, "delete|keep"),
	createStringExtractor("dependsOn", TASK_SYMBOLS.dependsOn, "[a-zA-Z0-9-_, ]+"),
	createStringExtractor("id", TASK_SYMBOLS.id, "[a-zA-Z0-9-_]+"),
	assigneeExtractor,
	locationExtractor,
];

function extractTags(description) {
	return [...description.matchAll(tagRegex)].map((match) => match[0].trim());
}

export function parseTaskBody(body, status, extractors = DEFAULT_EXTRACTORS) {
	let remaining = String(body).trim();
	let blockLink = null;
	const blockLinkMatch = remaining.match(blockLinkRegex);
	if (blockLinkMatch) {
		blockLink = blockLinkMatch[0].trim();
		remaining = remaining.replace(blockLinkRegex, "").trim();
	}

	const data = {
		status,
		description: remaining,
		priority: null,
		dates: {
			start: null,
			created: null,
			scheduled: null,
			due: null,
			done: null,
			cancelled: null,
			remind: null,
		},
		recurrence: null,
		onCompletion: null,
		dependsOn: null,
		id: null,
		assignee: [],
		location: null,
		blockLink,
		tags: [],
		unmatched: null,
	};

	let matched = true;
	let guard = 0;
	while (matched && guard < 30) {
		guard++;
		matched = false;
		for (const extractor of extractors) {
			const [newRemaining, didMatch] = extractor.extract(remaining, data);
			if (didMatch) {
				remaining = newRemaining;
				matched = true;
				break;
			}
		}
	}

	data.description = remaining.replace(/ {2,}/gu, " ").trim();
	data.unmatched = remaining.trim() || null;
	data.tags = extractTags(data.description);
	if (data.dates.due && data.dates.start) {
		const resolved = resolveDueDateFromStart(data.dates.due, data.dates.start);
		if (resolved) {
			data.dates.due = resolved;
		}
	}
	return data;
}

export function parseTaskLine(line, statusType) {
	const match = String(line).match(taskLineRegex);
	if (!match) return null;
	const listMarker = match[2] ?? "-";
	const body = (match[4] ?? "").trim();
	return {
		listMarker,
		data: parseTaskBody(body, statusType),
		original: line,
	};
}

export function parseLineWithStatus(line, registry) {
	const statusSymbol = String(line).match(/\[(.)\]/u)?.[1] ?? " ";
	return parseTaskLine(line, registry.get(statusSymbol).type);
}

function addDate(parts, symbol, value) {
	if (value) parts.push(`${symbol} ${value}`);
}

function serializeTaskBodyEmoji(data) {
	const parts = [data.description.trim()];
	if (data.priority && TASK_SYMBOLS.priority[data.priority]) {
		parts.push(TASK_SYMBOLS.priority[data.priority]);
	}
	addDate(parts, TASK_SYMBOLS.start, data.dates.start);
	addDate(parts, TASK_SYMBOLS.created, data.dates.created);
	addDate(parts, TASK_SYMBOLS.scheduled, data.dates.scheduled);
	addDate(parts, TASK_SYMBOLS.due, data.dates.due);
	addDate(parts, TASK_SYMBOLS.done, data.dates.done);
	addDate(parts, TASK_SYMBOLS.cancelled, data.dates.cancelled);
	addDate(parts, TASK_SYMBOLS.remind, data.dates.remind);
	if (data.recurrence) parts.push(`${TASK_SYMBOLS.recurrence} ${data.recurrence}`);
	if (data.onCompletion) parts.push(`${TASK_SYMBOLS.onCompletion} ${data.onCompletion}`);
	if (data.dependsOn) parts.push(`${TASK_SYMBOLS.dependsOn} ${data.dependsOn}`);
	if (data.id) parts.push(`${TASK_SYMBOLS.id} ${data.id}`);
	if (data.assignee && data.assignee.length > 0) parts.push(`${TASK_SYMBOLS.assignee} ${data.assignee.join(" & ")}`);
	if (data.location) parts.push(`${TASK_SYMBOLS.location} ${data.location}`);
	if (data.blockLink) parts.push(data.blockLink);
	return parts.filter(Boolean).join(" ");
}

function serializeTaskBodyDataview(data) {
	const parts = [data.description.trim()];
	if (data.priority) parts.push(`[priority:: ${data.priority}]`);
	if (data.dates.start) parts.push(`[start:: ${data.dates.start}]`);
	if (data.dates.created) parts.push(`[created:: ${data.dates.created}]`);
	if (data.dates.scheduled) parts.push(`[scheduled:: ${data.dates.scheduled}]`);
	if (data.dates.due) parts.push(`[due:: ${data.dates.due}]`);
	if (data.dates.done) parts.push(`[completion:: ${data.dates.done}]`);
	if (data.dates.cancelled) parts.push(`[cancelled:: ${data.dates.cancelled}]`);
	if (data.dates.remind) parts.push(`[remind:: ${data.dates.remind}]`);
	if (data.recurrence) parts.push(`[recurrence:: ${data.recurrence}]`);
	if (data.onCompletion) parts.push(`[onCompletion:: ${data.onCompletion}]`);
	if (data.dependsOn) parts.push(`[dependsOn:: ${data.dependsOn}]`);
	if (data.id) parts.push(`[id:: ${data.id}]`);
	if (data.assignee && data.assignee.length > 0) parts.push(`[assignee:: ${data.assignee.join(" & ")}]`);
	if (data.location) parts.push(`[location:: ${data.location}]`);
	if (data.blockLink) parts.push(data.blockLink);
	return parts.filter(Boolean).join(" ");
}

export function serializeTaskBody(data, format = "dataview") {
	return format === "emoji" ? serializeTaskBodyEmoji(data) : serializeTaskBodyDataview(data);
}

export function serializeTaskLine(task, indentPrefix, registry, format = "dataview", explicitStatusSymbol) {
	const symbol = explicitStatusSymbol ?? registry.getByType(task.data.status).symbol;
	return `${indentPrefix}${task.listMarker} [${symbol}] ${serializeTaskBody(task.data, format)}`.trimEnd();
}

export function copyTaskData(data) {
	return {
		status: data.status,
		description: data.description,
		priority: data.priority ?? null,
		dates: data.dates
			? { ...data.dates }
			: {
				start: null,
				created: null,
				scheduled: null,
				due: null,
				done: null,
				cancelled: null,
				remind: null,
			},
		recurrence: data.recurrence ?? null,
		onCompletion: data.onCompletion ?? null,
		dependsOn: data.dependsOn ?? null,
		id: data.id ?? null,
		assignee: data.assignee ? [...data.assignee] : [],
		location: data.location ?? null,
		blockLink: data.blockLink ?? null,
		tags: data.tags ? [...data.tags] : [],
		unmatched: data.unmatched ?? null,
	};
}

export function applyTaskStatus(task, statusType, settings, options = {}, todayFn) {
	const data = copyTaskData(task);
	const today = todayFn();
	if (statusType === "DONE") {
		if (settings.setDoneDate && (task.status !== "DONE" || options.fillMissingStatusDate) && !data.dates.done) {
			data.dates.done = today;
		}
		data.dates.cancelled = null;
	} else {
		data.dates.done = null;
	}
	if (statusType === "CANCELLED") {
		if (settings.setCancelledDate && (task.status !== "CANCELLED" || options.fillMissingStatusDate) && !data.dates.cancelled) {
			data.dates.cancelled = today;
		}
	} else {
		data.dates.cancelled = null;
	}
	data.status = statusType;
	return data;
}

export function taskIdentityKey(task) {
	return [
		task.description.trim(),
		task.priority ?? "",
		task.recurrence ?? "",
		task.id ?? "",
		task.dates.start ?? "",
		task.dates.scheduled ?? "",
		task.dates.due ?? "",
	].join("\0");
}

export function normalizeLineIndentation(line, useTab, tabSize) {
	const match = line.match(listItemRegex);
	if (!match) return line;

	const rawIndent = match[1] ?? "";
	const lastQuoteIdx = rawIndent.lastIndexOf(">");
	let quotePart = "";
	let indentPart = rawIndent;
	if (lastQuoteIdx >= 0) {
		if (rawIndent[lastQuoteIdx + 1] === " " || rawIndent[lastQuoteIdx + 1] === "\t") {
			quotePart = rawIndent.slice(0, lastQuoteIdx + 2);
			indentPart = rawIndent.slice(lastQuoteIdx + 2);
		} else {
			quotePart = rawIndent.slice(0, lastQuoteIdx + 1);
			indentPart = rawIndent.slice(lastQuoteIdx + 1);
		}
	}

	const spacesCount = indentPart.replace(/\t/gu, " ".repeat(tabSize)).length;
	const newIndentPart = useTab
		? "\t".repeat(Math.floor(spacesCount / tabSize)) + " ".repeat(spacesCount % tabSize)
		: " ".repeat(spacesCount);

	const newIndent = quotePart + newIndentPart;
	if (rawIndent !== newIndent) {
		return newIndent + line.slice(rawIndent.length);
	}
	return line;
}
