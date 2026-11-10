import { formatUtcDate, parseCanonicalDateTime, todayString } from "./dates.mjs";

export class TaskQueryError extends Error {
	constructor(message) {
		super(message);
		this.name = "TaskQueryError";
	}
}

const PRIORITY_RANKS = {
	highest: 5,
	"🔺": 5,
	high: 4,
	"⏫": 4,
	medium: 3,
	"🔼": 3,
	low: 2,
	"🔽": 2,
	lowest: 1,
	"⏬": 1,
	none: 0,
	"": 0,
};

const VALID_QUERY_FIELDS = new Set([
	"status",
	"completed",
	"description",
	"priority",
	"path",
	"basename",
	"tags",
	"assignee",
	"assigned",
	"person",
	"location",
	"place",
	"loc",
	"haschildren",
	"parentline",
	"linenumber",
	"depth",
	"due",
	"scheduled",
	"start",
	"created",
	"completion",
	"done",
	"cancelled",
	"remind",
	"repeat",
	"recurrence",
	"oncompletion",
	"dependson",
	"blockedby",
	"id",
]);

const VALID_IS_STATES = new Set([
	"open",
	"done",
	"cancelled",
	"in_progress",
	"overdue",
	"overdate",
	"blocked",
	"root",
	"subtask",
]);

export function computeRelativeDate(base, amount, unit) {
	const parts = base.split("-").map(Number);
	if (parts.length < 3 || Number.isNaN(parts[0]) || Number.isNaN(parts[1]) || Number.isNaN(parts[2])) {
		return base;
	}
	const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
	if (unit === "d") dt.setUTCDate(dt.getUTCDate() + amount);
	else if (unit === "w") dt.setUTCDate(dt.getUTCDate() + amount * 7);
	else if (unit === "m") dt.setUTCMonth(dt.getUTCMonth() + amount);
	else if (unit === "y") dt.setUTCFullYear(dt.getUTCFullYear() + amount);
	return formatUtcDate(dt);
}

function parseOffset(str) {
	const match = /^([+-]?\d+)\s*([dwmy])$/i.exec(str.trim());
	if (!match) return null;
	return {
		amount: Number.parseInt(match[1], 10),
		unit: match[2].toLowerCase(),
	};
}

function resolveBaseDate(val) {
	const trimmed = val.trim();
	const lower = trimmed.toLowerCase();
	const today = todayString();
	if (lower === "today") return today;
	if (lower === "tomorrow") return computeRelativeDate(today, 1, "d");
	if (lower === "yesterday") return computeRelativeDate(today, -1, "d");
	if (lower === "next-week" || lower === "next_week") return computeRelativeDate(today, 7, "d");
	const offset = parseOffset(trimmed);
	if (offset) return computeRelativeDate(today, offset.amount, offset.unit);
	return parseCanonicalDateTime(trimmed)?.date ?? trimmed;
}

function applyDateOffset(base, offsetStr) {
	const offset = parseOffset(offsetStr);
	if (!offset) return base;
	return computeRelativeDate(base, offset.amount, offset.unit);
}

function readString(input, start, quoteChar) {
	let index = start + 1;
	let value = "";
	while (index < input.length) {
		const char = input[index];
		if (char === quoteChar) return { value, nextIndex: index + 1 };
		if (char === "\\") {
			const next = input[index + 1];
			if (next === undefined) throw new TaskQueryError(`Unterminated string. Position ${start}.`);
			value += next;
			index += 2;
			continue;
		}
		value += char;
		index++;
	}
	throw new TaskQueryError(`Unterminated string. Position ${start}.`);
}

function tokenize(input) {
	const tokens = [];
	let index = 0;
	while (index < input.length) {
		const char = input[index];
		if (/\s/u.test(char)) {
			index++;
			continue;
		}
		if (char === "(" || char === ")") {
			tokens.push({ type: "paren", value: char, position: index });
			index++;
			continue;
		}
		if (char === ",") {
			tokens.push({ type: "comma", value: char, position: index });
			index++;
			continue;
		}
		if (char === '"' || char === "'") {
			const parsed = readString(input, index, char);
			tokens.push({ type: "string", value: parsed.value, position: index });
			index = parsed.nextIndex;
			continue;
		}
		const twoChar = input.slice(index, index + 2);
		if (twoChar === "<=" || twoChar === ">=" || twoChar === "!=" || twoChar === "=~") {
			tokens.push({ type: "operator", value: twoChar, position: index });
			index += 2;
			continue;
		}
		if (char === "=" || char === "<" || char === ">") {
			tokens.push({ type: "operator", value: char, position: index });
			index++;
			continue;
		}
		if (char === "+") {
			if (index + 1 < input.length && /[0-9]/u.test(input[index + 1])) {
				const start = index;
				index++;
				while (index < input.length && /[A-Za-z0-9_.#/-]/u.test(input[index])) index++;
				tokens.push({ type: "identifier", value: input.slice(start, index), position: start });
				continue;
			}
			tokens.push({ type: "operator", value: "+", position: index });
			index++;
			continue;
		}
		if (/[A-Za-z0-9_.#/-]/u.test(char)) {
			const start = index;
			while (index < input.length && /[A-Za-z0-9_.#/-]/u.test(input[index])) index++;
			const value = input.slice(start, index);
			const lowerValue = value.toLowerCase();
			const type =
				lowerValue === "true" || lowerValue === "false"
					? "boolean"
					: lowerValue === "null"
						? "null"
						: "identifier";
			tokens.push({ type, value, position: start });
			continue;
		}
		throw new TaskQueryError(`Unexpected character '${char}'. Position ${index}.`);
	}
	tokens.push({ type: "eof", value: "", position: input.length });
	return tokens;
}

class Parser {
	constructor(tokens) {
		this.tokens = tokens;
		this.index = 0;
	}

	parse() {
		const expression = this.parseOr();
		this.expect("eof");
		return expression;
	}

	parseOr() {
		let expression = this.parseAnd();
		while (this.matchKeyword("OR")) {
			expression = { type: "binary", operator: "OR", left: expression, right: this.parseAnd() };
		}
		return expression;
	}

	parseAnd() {
		let expression = this.parseNot();
		while (this.matchKeyword("AND")) {
			expression = { type: "binary", operator: "AND", left: expression, right: this.parseNot() };
		}
		return expression;
	}

	parseNot() {
		if (this.matchKeyword("NOT")) {
			return { type: "not", expression: this.parseNot() };
		}
		return this.parsePrimary();
	}

	parsePrimary() {
		if (this.matchParen("(")) {
			const expression = this.parseOr();
			this.expectParen(")");
			return expression;
		}
		if (this.isMacroAhead()) {
			return this.parseMacro();
		}
		return this.parseComparison();
	}

	isMacroAhead() {
		const token = this.current();
		if (token.type !== "identifier") return false;
		const name = token.value.toLowerCase();
		if (name !== "happens" && name !== "is" && name !== "covers") return false;
		const next = this.tokens[this.index + 1];
		return next?.type === "paren" && next.value === "(";
	}

	parseMacro() {
		const nameToken = this.expect("identifier");
		const rawName = nameToken.value.toLowerCase();
		if (rawName !== "happens" && rawName !== "is" && rawName !== "covers") {
			throw this.error(nameToken, `Unknown macro '${rawName}'.`);
		}
		this.expectParen("(");
		const args = [];
		if (rawName === "happens" || rawName === "covers") {
			if (this.current().type === "paren" && this.current().value === ")") {
				args.push(todayString());
			} else if (this.current().type === "identifier" && this.current().value.toLowerCase() === "date") {
				args.push(this.parseDateFunction());
			} else if (this.current().type === "string" || this.current().type === "identifier") {
				const val = this.current().value;
				this.index++;
				args.push(resolveBaseDate(val));
			} else {
				throw this.error(this.current(), `Expected date argument in ${rawName}(...).`);
			}
		} else {
			const argToken = this.current();
			if (argToken.type === "identifier" || argToken.type === "string") {
				this.index++;
				const state = argToken.value.toLowerCase();
				if (!VALID_IS_STATES.has(state)) {
					throw new TaskQueryError(`Unknown macro state '${state}' in is(...).`);
				}
				args.push(state);
			} else {
				throw this.error(argToken, `Expected keyword in ${rawName}(...).`);
			}
		}
		this.expectParen(")");
		return { type: "macro", name: rawName, args };
	}

	parseComparison() {
		const fieldToken = this.expect("identifier");
		const field = fieldToken.value;
		if (!VALID_QUERY_FIELDS.has(field.toLowerCase().trim())) {
			throw new TaskQueryError(`Unknown query field '${field}'.`);
		}
		const operator = this.parseOperator();
		const value = this.parseValue();
		return { type: "comparison", field, operator, value };
	}

	parseOperator() {
		const token = this.current();
		if (token.type === "operator") {
			this.index++;
			return token.value;
		}
		if (token.type === "identifier" && token.value.toLowerCase() === "contains") {
			this.index++;
			return "contains";
		}
		throw this.error(token, "Expected an operator.");
	}

	parseValue() {
		const token = this.current();
		if (token.type === "string") {
			this.index++;
			return token.value;
		}
		if (token.type === "boolean") {
			this.index++;
			return token.value === "true";
		}
		if (token.type === "null") {
			this.index++;
			return null;
		}
		if (token.type === "identifier" && token.value.toLowerCase() === "date") {
			return this.parseDateFunction();
		}
		if (token.type === "identifier") {
			this.index++;
			return token.value;
		}
		throw this.error(token, "Expected a query value.");
	}

	parseDateFunction() {
		this.expect("identifier");
		this.expectParen("(");
		const firstToken = this.current();
		let baseDate = todayString();
		let offsetStr = null;

		if (firstToken.type === "string" || firstToken.type === "identifier") {
			this.index++;
			baseDate = resolveBaseDate(firstToken.value);
		} else {
			throw this.error(firstToken, "Expected today, relative date, or date string in date(...).");
		}

		if (this.current().type === "comma") {
			this.index++;
			const secondToken = this.current();
			if (secondToken.type === "string" || secondToken.type === "identifier") {
				this.index++;
				offsetStr = secondToken.value;
			} else {
				throw this.error(secondToken, "Expected offset in date(base, offset).");
			}
		} else if (this.current().value === "+" || this.current().value === "-") {
			const sign = this.current().value;
			this.index++;
			const offsetToken = this.current();
			if (offsetToken.type === "identifier" || offsetToken.type === "string") {
				this.index++;
				offsetStr = `${sign}${offsetToken.value}`;
			} else {
				throw this.error(offsetToken, "Expected offset after +/- in date(...).");
			}
		}

		if (offsetStr) {
			baseDate = applyDateOffset(baseDate, offsetStr);
		}
		this.expectParen(")");
		return baseDate;
	}

	matchKeyword(keyword) {
		const token = this.current();
		if (token.type !== "identifier" || token.value.toUpperCase() !== keyword) return false;
		this.index++;
		return true;
	}

	matchParen(value) {
		const token = this.current();
		if (token.type !== "paren" || token.value !== value) return false;
		this.index++;
		return true;
	}

	expectParen(value) {
		const token = this.current();
		if (token.type === "paren" && token.value === value) {
			this.index++;
			return token;
		}
		throw this.error(token, `Expected '${value}'.`);
	}

	expect(type) {
		const token = this.current();
		if (token.type === type) {
			this.index++;
			return token;
		}
		throw this.error(token, `Expected ${type}.`);
	}

	current() {
		return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
	}

	error(token, message) {
		return new TaskQueryError(`${message} Position ${token.position}.`);
	}
}

function extractDateOnly(value) {
	if (!value) return null;
	return parseCanonicalDateTime(value)?.date ?? String(value).trim().slice(0, 10);
}

function getFieldValue(record, field) {
	const norm = field.toLowerCase().trim();
	switch (norm) {
		case "status": return record.task.status;
		case "completed": return record.task.status === "DONE";
		case "description": return record.task.description;
		case "priority": return record.task.priority ?? "";
		case "path": return record.path;
		case "basename": return record.basename;
		case "tags": return record.task.tags.join(" ");
		case "assignee":
		case "assigned":
		case "person": return record.task.assignee;
		case "location":
		case "place":
		case "loc": return record.task.location ?? "";
		case "haschildren": return record.hasChildren;
		case "parentline": return record.parentLine;
		case "linenumber": return record.lineNumber;
		case "depth": return record.depth;
		case "due": return record.task.dates.due;
		case "scheduled": return record.task.dates.scheduled;
		case "start": return record.task.dates.start;
		case "created": return record.task.dates.created;
		case "completion":
		case "done": return record.task.dates.done;
		case "cancelled": return record.task.dates.cancelled;
		case "remind": return record.task.dates.remind;
		case "repeat":
		case "recurrence": return record.task.recurrence ?? "";
		case "oncompletion": return record.task.onCompletion ?? "";
		case "dependson":
		case "blockedby": return record.task.dependsOn ?? "";
		case "id": return record.task.id ?? "";
		default:
			throw new TaskQueryError(`Unknown query field '${field}'.`);
	}
}

function compareValues(left, right) {
	if (left === right) return 0;
	const leftStr = left === null ? "" : String(left).trim();
	const rightStr = right === null ? "" : String(right).trim();
	if (leftStr in PRIORITY_RANKS && rightStr in PRIORITY_RANKS) {
		return (PRIORITY_RANKS[leftStr] ?? 0) - (PRIORITY_RANKS[rightStr] ?? 0);
	}
	if (typeof left === "number" && typeof right === "number") return left - right;
	if (typeof left === "boolean" || typeof right === "boolean") {
		return String(left).localeCompare(String(right));
	}
	if (left === null || right === null) return left === null ? -1 : 1;

	const leftDt = parseCanonicalDateTime(leftStr);
	const rightDt = parseCanonicalDateTime(rightStr);
	if (leftDt && rightDt) {
		if (!leftDt.hasTime || !rightDt.hasTime) return leftDt.date.localeCompare(rightDt.date);
		return leftDt.full.localeCompare(rightDt.full);
	}
	return String(left).localeCompare(String(right));
}

function evaluateComparison(left, operator, right) {
	if (Array.isArray(left)) {
		const target = right === null ? "" : String(right).trim();
		if (operator === "=") return left.includes(target);
		if (operator === "!=") return !left.includes(target);
		if (operator === "contains" || operator === "=~") return left.some((item) => item.includes(target));
		return false;
	}
	if (operator === "contains" || operator === "=~") {
		if (left === null || right === null) return false;
		return String(left).includes(String(right));
	}
	if (operator === "=") return compareValues(left, right) === 0;
	if (operator === "!=") return compareValues(left, right) !== 0;
	if (left === null || right === null) return false;
	const comparison = compareValues(left, right);
	if (operator === "<") return comparison < 0;
	if (operator === "<=") return comparison <= 0;
	if (operator === ">") return comparison > 0;
	return comparison >= 0;
}

function evaluateMacro(name, args, record) {
	if (name === "happens") {
		const rawTarget = args[0] || todayString();
		const targetDate = extractDateOnly(rawTarget) ?? rawTarget;
		const dates = record.task.dates;
		return (
			extractDateOnly(dates.start) === targetDate ||
			extractDateOnly(dates.scheduled) === targetDate ||
			extractDateOnly(dates.due) === targetDate
		);
	}
	if (name === "covers") {
		const rawTarget = args[0] || todayString();
		const targetDate = extractDateOnly(rawTarget) ?? rawTarget;
		const dates = record.task.dates;
		const start = extractDateOnly(dates.start);
		const due = extractDateOnly(dates.due);
		if (!start || start > targetDate) return false;
		if (due) return due >= targetDate;
		return record.task.status !== "DONE" && record.task.status !== "CANCELLED";
	}
	if (name === "is") {
		const state = (args[0] || "").toLowerCase();
		const status = record.task.status;
		const today = todayString();
		const isOpen = status !== "DONE" && status !== "CANCELLED";
		switch (state) {
			case "open": return isOpen;
			case "done": return status === "DONE";
			case "cancelled": return status === "CANCELLED";
			case "in_progress": return status === "IN_PROGRESS";
			case "overdue": {
				if (!isOpen) return false;
				const due = extractDateOnly(record.task.dates.due);
				return Boolean(due && due < today);
			}
			case "overdate": {
				if (!isOpen) return false;
				const scheduled = extractDateOnly(record.task.dates.scheduled);
				return Boolean(scheduled && scheduled < today);
			}
			case "blocked": {
				if (!isOpen) return false;
				return Boolean(record.task.dependsOn && record.task.dependsOn.trim().length > 0);
			}
			case "root":
				return record.parentLine === null || record.parentLine === undefined || record.depth === 0;
			case "subtask":
				return record.parentLine !== null && record.parentLine !== undefined && record.depth > 0;
			default:
				throw new TaskQueryError(`Unknown macro state '${state}' in is(...).`);
		}
	}
	return false;
}

function evaluateExpression(expression, record) {
	switch (expression.type) {
		case "binary":
			return expression.operator === "AND"
				? evaluateExpression(expression.left, record) && evaluateExpression(expression.right, record)
				: evaluateExpression(expression.left, record) || evaluateExpression(expression.right, record);
		case "not":
			return !evaluateExpression(expression.expression, record);
		case "comparison":
			return evaluateComparison(getFieldValue(record, expression.field), expression.operator, expression.value);
		case "macro":
			return evaluateMacro(expression.name, expression.args, record);
	}
}

export function compileTaskQuery(query) {
	const normalizedQuery = String(query ?? "").trim();
	if (!normalizedQuery) {
		return {
			query: "",
			expression: null,
			matches: () => true,
		};
	}
	const parser = new Parser(tokenize(normalizedQuery));
	const expression = parser.parse();
	return {
		query: normalizedQuery,
		expression,
		matches: (record) => evaluateExpression(expression, record),
	};
}

export function filterTaskRecordsByQuery(records, query) {
	const compiled = compileTaskQuery(query);
	return records.filter((record) => compiled.matches(record));
}

function walkExprStatuses(expr, flags) {
	if (!expr) return;
	if (expr.type === "binary") {
		walkExprStatuses(expr.left, flags);
		walkExprStatuses(expr.right, flags);
	} else if (expr.type === "not") {
		walkExprStatuses(expr.expression, flags);
	} else if (expr.type === "comparison") {
		const f = expr.field.toLowerCase();
		if (f === "status" && typeof expr.value === "string") {
			const val = expr.value.toUpperCase();
			if (val === "DONE") flags.mentionsDone = true;
			if (val === "CANCELLED") flags.mentionsCancelled = true;
		} else if (f === "completed" && expr.value === true) {
			flags.mentionsDone = true;
		}
	} else if (expr.type === "macro" && expr.name === "is") {
		const arg = (expr.args[0] || "").toLowerCase();
		if (arg === "done") flags.mentionsDone = true;
		if (arg === "cancelled") flags.mentionsCancelled = true;
	}
}

export function detectQueryStatusHints(query) {
	const flags = { mentionsDone: false, mentionsCancelled: false };
	if (!query || !String(query).trim()) return flags;
	try {
		const compiled = compileTaskQuery(query);
		walkExprStatuses(compiled.expression, flags);
	} catch {
		// Let normal query evaluation throw syntax errors cleanly
	}
	return flags;
}
