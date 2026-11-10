import { setTodayOverride } from "./dates.mjs";

const STATUS_BADGE = {
	TODO: "[ ]",
	DONE: "[x]",
	IN_PROGRESS: "[/]",
	CANCELLED: "[-]",
	ON_HOLD: "[?]",
	NON_TASK: "[~]",
	EMPTY: "[]",
};

export function parseArgs(argv, spec = {}) {
	const booleans = new Set([...(spec.booleans ?? []), "help", "h", "json"]);
	const repeatables = new Set(spec.repeatables ?? []);
	const flags = {};
	const positionals = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--") {
			positionals.push(...argv.slice(i + 1));
			break;
		}
		if (arg === "-h") {
			flags.help = true;
			continue;
		}
		if (arg.startsWith("--")) {
			const eqIdx = arg.indexOf("=");
			let key;
			let inlineVal;
			if (eqIdx >= 0) {
				key = arg.slice(2, eqIdx);
				inlineVal = arg.slice(eqIdx + 1);
			} else {
				key = arg.slice(2);
			}

			if (booleans.has(key)) {
				flags[key] = inlineVal === undefined ? true : inlineVal !== "false";
				continue;
			}

			let value;
			if (inlineVal !== undefined) {
				value = inlineVal;
			} else if (i + 1 < argv.length) {
				value = argv[++i];
			} else {
				throw new Error(`Missing value for flag --${key}.`);
			}

			if (repeatables.has(key)) {
				if (!Array.isArray(flags[key])) flags[key] = [];
				flags[key].push(value);
			} else {
				flags[key] = value;
			}
			continue;
		}
		positionals.push(arg);
	}

	return { flags, positionals };
}

export function applyGlobalFlags(flags) {
	if (flags.today !== undefined) {
		setTodayOverride(flags.today);
	}
}

export function formatRecordLine(record) {
	const badge = STATUS_BADGE[record.task.status] ?? "[ ]";
	const loc = record.lineNumber === -1 ? `${record.path}:-1 (fm)` : `${record.path}:${record.lineNumber}`;
	const indent = record.depth > 0 ? "  ".repeat(record.depth) : "";
	const meta = [];
	if (record.task.priority) meta.push(`priority=${record.task.priority}`);
	if (record.task.dates.start) meta.push(`start=${record.task.dates.start}`);
	if (record.task.dates.scheduled) meta.push(`scheduled=${record.task.dates.scheduled}`);
	if (record.task.dates.due) meta.push(`due=${record.task.dates.due}`);
	if (record.task.dates.done) meta.push(`done=${record.task.dates.done}`);
	if (record.task.dates.cancelled) meta.push(`cancelled=${record.task.dates.cancelled}`);
	if (record.task.dates.remind) meta.push(`remind=${record.task.dates.remind}`);
	if (record.task.recurrence) meta.push(`repeat="${record.task.recurrence}"`);
	if (record.task.id) meta.push(`id=${record.task.id}`);
	if (record.task.dependsOn) meta.push(`dependsOn=${record.task.dependsOn}`);
	if (record.task.assignee?.length) meta.push(`assignee=${record.task.assignee.join("&")}`);
	if (record.task.location) meta.push(`location=${record.task.location}`);
	const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";
	return `${indent}${badge} ${record.task.description}${metaStr}  [${loc}]`;
}

export function parseAssigneeFlagValues(values) {
	if (!values) return undefined;
	const list = Array.isArray(values) ? values : [values];
	const out = [];
	for (const raw of list) {
		if (!String(raw).trim()) continue;
		for (const part of String(raw).split("&")) {
			const trimmed = part.trim();
			if (trimmed && !out.includes(trimmed)) out.push(trimmed);
		}
	}
	return out;
}

export function runCli(helpText, argSpec, handler) {
	Promise.resolve()
		.then(async () => {
			const { flags, positionals } = parseArgs(process.argv.slice(2), argSpec);
			if (flags.help || flags.h) {
				console.log(helpText.trimEnd());
				return;
			}
			applyGlobalFlags(flags);
			await handler({ flags, positionals });
		})
		.catch((err) => {
			const wantsJson = process.argv.includes("--json");
			const message = err instanceof Error ? err.message : String(err);
			if (wantsJson) {
				console.error(JSON.stringify({ ok: false, error: message }));
			} else {
				console.error(`Error: ${message}`);
			}
			process.exitCode = 1;
		});
}
