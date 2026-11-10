import {
	formatUtcDate,
	normalizeTaskDateValue,
	nowTimeString,
	parseIsoDateUtc,
	todayString,
} from "./dates.mjs";
import { copyTaskData, serializeTaskLine } from "./format.mjs";
import { getIndentPrefix, getSubtreeLineRange, getSubtreeNodes, taskDepth } from "./tree.mjs";

const WEEKDAY_TOKEN_TO_ISO = {
	monday: 1, mon: 1,
	tuesday: 2, tue: 2, tues: 2,
	wednesday: 3, wed: 3,
	thursday: 4, thu: 4, thur: 4, thurs: 4,
	friday: 5, fri: 5,
	saturday: 6, sat: 6,
	sunday: 7, sun: 7,
};

const ORDINAL_MAP = {
	first: 1, "1st": 1,
	second: 2, "2nd": 2,
	third: 3, "3rd": 3,
	fourth: 4, "4th": 4,
	fifth: 5, "5th": 5,
	last: -1,
};

const MONTH_NAME_MAP = {
	january: 1, jan: 1,
	february: 2, feb: 2,
	march: 3, mar: 3,
	april: 4, apr: 4,
	may: 5,
	june: 6, jun: 6,
	july: 7, jul: 7,
	august: 8, aug: 8,
	september: 9, sep: 9, sept: 9,
	october: 10, oct: 10,
	november: 11, nov: 11,
	december: 12, dec: 12,
};

function daysInMonth(year, month1To12) {
	return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

function parseWeekdayList(raw) {
	const cleaned = raw
		.replace(/\band\b/giu, ",")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (cleaned.length === 0) return null;
	const out = [];
	for (const item of cleaned) {
		const iso = WEEKDAY_TOKEN_TO_ISO[item];
		if (!iso) return null;
		if (!out.includes(iso)) out.push(iso);
	}
	return out.sort((a, b) => a - b);
}

function parseMonthDayList(raw) {
	const cleaned = raw
		.replace(/\band\b/giu, ",")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (cleaned.length === 0) return null;
	const out = [];
	for (const item of cleaned) {
		if (item === "last" || item === "last day") {
			if (!out.includes(-1)) out.push(-1);
			continue;
		}
		const match = item.match(/^(\d{1,2})(?:st|nd|rd|th)?$/u);
		if (!match) return null;
		const day = Number.parseInt(match[1], 10);
		if (day < 1 || day > 31) return null;
		if (!out.includes(day)) out.push(day);
	}
	return out;
}

function parseRuleOptions(text) {
	let s = text.trim().toLowerCase().replace(/!/gu, "").replace(/\s+/gu, " ");
	if (!s) return null;

	if (s === "daily") return { freq: "DAILY", interval: 1 };
	if (s === "weekly") return { freq: "WEEKLY", interval: 1 };
	if (s === "monthly") return { freq: "MONTHLY", interval: 1 };
	if (s === "yearly" || s === "annually") return { freq: "YEARLY", interval: 1 };

	if (!s.startsWith("every ")) return null;
	s = s.slice(6).trim();

	// Shorthands: "every weekday(s)", "every work day(s)", "every weekend(s)"
	if (/^(?:week\s?days?|work\s?days?)$/u.test(s)) {
		return { freq: "WEEKLY", interval: 1, byweekday: [1, 2, 3, 4, 5] };
	}
	if (/^weekends?$/u.test(s)) {
		return { freq: "WEEKLY", interval: 1, byweekday: [6, 7] };
	}

	// Leading interval: "other" (= 2) or integer
	let interval = 1;
	const otherMatch = s.match(/^other\s+(.+)$/u);
	if (otherMatch) {
		interval = 2;
		s = otherMatch[1].trim();
	} else {
		const numMatch = s.match(/^(\d+)\s+(.+)$/u);
		if (numMatch) {
			interval = Number.parseInt(numMatch[1], 10);
			if (!Number.isFinite(interval) || interval < 1) return null;
			s = numMatch[2].trim();
		}
	}

	if (/^days?$/u.test(s)) {
		return { freq: "DAILY", interval };
	}

	if (/^weeks?$/u.test(s)) {
		return { freq: "WEEKLY", interval };
	}

	const weekOnMatch = s.match(/^weeks?\s+on\s+(?:the\s+)?(.+)$/u);
	if (weekOnMatch) {
		const byweekday = parseWeekdayList(weekOnMatch[1]);
		if (byweekday) {
			return { freq: "WEEKLY", interval, byweekday };
		}
	}

	// Direct weekday(s): "every Monday", "every 2 weeks" handled above, "every Monday, Wednesday"
	const directWeekdays = parseWeekdayList(s);
	if (directWeekdays) {
		return { freq: "WEEKLY", interval, byweekday: directWeekdays };
	}

	if (/^months?$/u.test(s)) {
		return { freq: "MONTHLY", interval };
	}

	const monthOnMatch = s.match(/^months?\s+on\s+(?:the\s+)?(.+)$/u);
	if (monthOnMatch) {
		const rest = monthOnMatch[1].trim();
		if (/^last(?:\s+day)?$/u.test(rest)) {
			return { freq: "MONTHLY", interval, bymonthday: [-1] };
		}
		const ordWdMatch = rest.match(/^(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+([a-z]+)$/u);
		if (ordWdMatch) {
			const nth = ORDINAL_MAP[ordWdMatch[1]];
			const wd = WEEKDAY_TOKEN_TO_ISO[ordWdMatch[2]];
			if (nth !== undefined && wd !== undefined) {
				return { freq: "MONTHLY", interval, bynweekday: [{ weekday: wd, nth }] };
			}
		}
		const monthDays = parseMonthDayList(rest);
		if (monthDays) {
			return { freq: "MONTHLY", interval, bymonthday: monthDays };
		}
		const monthWds = parseWeekdayList(rest);
		if (monthWds) {
			return { freq: "MONTHLY", interval, byweekday: monthWds };
		}
		return null;
	}

	if (/^years?$/u.test(s)) {
		return { freq: "YEARLY", interval };
	}

	const yearOnMatch = s.match(/^years?\s+on\s+(?:the\s+)?(.+)$/u);
	if (yearOnMatch) {
		const rest = yearOnMatch[1].trim();
		// "<month> <day>" e.g. "march 15th"
		const md = rest.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/u);
		if (md && MONTH_NAME_MAP[md[1]]) {
			const month = MONTH_NAME_MAP[md[1]];
			const day = Number.parseInt(md[2], 10);
			if (day >= 1 && day <= 31) {
				return { freq: "YEARLY", interval, bymonth: month, bymonthday: [day] };
			}
		}
		// "<day> of <month>" e.g. "15th of march"
		const dm = rest.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+of\s+([a-z]+)$/u);
		if (dm && MONTH_NAME_MAP[dm[2]]) {
			const day = Number.parseInt(dm[1], 10);
			const month = MONTH_NAME_MAP[dm[2]];
			if (day >= 1 && day <= 31) {
				return { freq: "YEARLY", interval, bymonth: month, bymonthday: [day] };
			}
		}
	}

	return null;
}

export function parseRecurrenceRule(rule) {
	if (!rule) return null;
	const match = String(rule).trim().match(/^([a-zA-Z0-9, !]+?)( +when +done)?$/i);
	if (!match) return null;

	const isolatedRuleText = (match[1] ?? "").trim();
	const baseOnToday = match[2] !== undefined;
	const options = parseRuleOptions(isolatedRuleText);
	if (!options) return null;
	return { options, baseOnToday };
}

function isoWeekday(utcDate) {
	return utcDate.getUTCDay() || 7;
}

function weekStartMonday(utcDate) {
	const copy = new Date(utcDate.getTime());
	const dow = isoWeekday(copy);
	copy.setUTCDate(copy.getUTCDate() - (dow - 1));
	return copy;
}

function nthWeekdayInMonth(year, month1To12, weekdayIso, nth) {
	const totalDays = daysInMonth(year, month1To12);
	const matches = [];
	for (let d = 1; d <= totalDays; d++) {
		const dt = new Date(Date.UTC(year, month1To12 - 1, d));
		if (isoWeekday(dt) === weekdayIso) {
			matches.push(dt);
		}
	}
	if (nth > 0) return matches[nth - 1] ?? null;
	if (nth < 0) return matches[matches.length + nth] ?? null;
	return null;
}

function nextDateAfter(afterDateStr, rule, dtstartDateStr) {
	const after = parseIsoDateUtc(afterDateStr);
	const dtstart = parseIsoDateUtc(dtstartDateStr);
	if (!after || !dtstart) return null;

	const opts = rule.options;
	const interval = opts.interval ?? 1;

	if (opts.freq === "DAILY") {
		const afterDays = Math.floor(after.getTime() / 86400000);
		const startDays = Math.floor(dtstart.getTime() / 86400000);
		let nextDays = afterDays + 1;
		if (interval > 1) {
			const diff = nextDays - startDays;
			const rem = ((diff % interval) + interval) % interval;
			if (rem !== 0) {
				nextDays += interval - rem;
			}
		}
		return formatUtcDate(new Date(nextDays * 86400000));
	}

	if (opts.freq === "WEEKLY") {
		if (!opts.byweekday || opts.byweekday.length === 0) {
			const next = new Date(after.getTime());
			next.setUTCDate(next.getUTCDate() + interval * 7);
			return formatUtcDate(next);
		}
		const afterWeekMon = weekStartMonday(after);
		const startWeekMon = weekStartMonday(dtstart);
		const daysPerWeekMs = 7 * 86400000;
		const startWeeksDiff = Math.round((afterWeekMon.getTime() - startWeekMon.getTime()) / daysPerWeekMs);

		for (let w = 0; w <= interval * 104; w++) {
			const weekIndex = startWeeksDiff + w;
			if (weekIndex < 0 || weekIndex % interval !== 0) continue;
			const monMs = startWeekMon.getTime() + weekIndex * daysPerWeekMs;
			for (const isoWd of opts.byweekday) {
				const candidate = new Date(monMs + (isoWd - 1) * 86400000);
				if (candidate.getTime() > after.getTime()) {
					return formatUtcDate(candidate);
				}
			}
		}
		return null;
	}

	if (opts.freq === "MONTHLY") {
		const hasSpecific = Boolean(opts.bymonthday || opts.byweekday || opts.bynweekday);
		if (!hasSpecific) {
			const afterYear = after.getUTCFullYear();
			const afterMonth = after.getUTCMonth() + 1;
			const afterDay = after.getUTCDate();
			const startYear = dtstart.getUTCFullYear();
			const startMonth = dtstart.getUTCMonth() + 1;
			const monthsSinceStart = (afterYear - startYear) * 12 + (afterMonth - startMonth);
			const nextStep = monthsSinceStart < 0
				? 0
				: Math.floor(monthsSinceStart / interval) * interval + interval;
			const totalMonths = (startYear * 12 + (startMonth - 1)) + nextStep;
			const targetYear = Math.floor(totalMonths / 12);
			const targetMonth = (totalMonths % 12) + 1;
			const clampedDay = Math.min(afterDay, daysInMonth(targetYear, targetMonth));
			return formatUtcDate(new Date(Date.UTC(targetYear, targetMonth - 1, clampedDay)));
		}

		const startYM = dtstart.getUTCFullYear() * 12 + dtstart.getUTCMonth();
		const afterYM = after.getUTCFullYear() * 12 + after.getUTCMonth();
		const startK = Math.max(0, Math.floor((afterYM - startYM) / interval) * interval);

		for (let k = startK; k <= startK + interval * 120; k += interval) {
			const ym = startYM + k;
			const year = Math.floor(ym / 12);
			const month = (ym % 12) + 1;
			const maxD = daysInMonth(year, month);
			const candidates = [];

			if (opts.bymonthday) {
				for (const dSpec of opts.bymonthday) {
					const actual = dSpec === -1 ? maxD : dSpec;
					if (actual >= 1 && actual <= maxD) {
						candidates.push(new Date(Date.UTC(year, month - 1, actual)));
					}
				}
			} else if (opts.bynweekday) {
				for (const spec of opts.bynweekday) {
					const dt = nthWeekdayInMonth(year, month, spec.weekday, spec.nth);
					if (dt) candidates.push(dt);
				}
			} else if (opts.byweekday) {
				for (let d = 1; d <= maxD; d++) {
					const dt = new Date(Date.UTC(year, month - 1, d));
					if (opts.byweekday.includes(isoWeekday(dt))) {
						candidates.push(dt);
					}
				}
			}

			candidates.sort((a, b) => a.getTime() - b.getTime());
			for (const c of candidates) {
				if (c.getTime() > after.getTime()) {
					return formatUtcDate(c);
				}
			}
		}
		return null;
	}

	if (opts.freq === "YEARLY") {
		const startYear = dtstart.getUTCFullYear();
		const afterYear = after.getUTCFullYear();
		const targetMonth = opts.bymonth ?? (dtstart.getUTCMonth() + 1);
		const targetDayBase = opts.bymonthday?.[0] ?? dtstart.getUTCDate();

		const startOffset = Math.max(0, Math.floor((afterYear - startYear) / interval) * interval);
		for (let yOff = startOffset; yOff <= startOffset + interval * 12; yOff += interval) {
			const year = startYear + yOff;
			const maxD = daysInMonth(year, targetMonth);
			const day = opts.bymonthday ? targetDayBase : Math.min(targetDayBase, maxD);
			if (day > maxD) continue;
			const candidate = new Date(Date.UTC(year, targetMonth - 1, day));
			if (candidate.getTime() > after.getTime()) {
				return formatUtcDate(candidate);
			}
		}
		return null;
	}

	return null;
}

function splitDateTime(value) {
	const normalized = normalizeTaskDateValue(value);
	const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(.*)$/u);
	if (match) {
		return { date: match[1] ?? normalized, time: match[2] ?? "" };
	}
	return { date: normalized, time: "" };
}

function daysBetween(from, to) {
	const fromDate = parseIsoDateUtc(from);
	const toDate = parseIsoDateUtc(to);
	if (!fromDate || !toDate) return 0;
	return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function addDays(value, days) {
	const { date: valDate, time: valTime } = splitDateTime(value);
	const dt = parseIsoDateUtc(valDate);
	if (!dt) return value;
	dt.setUTCDate(dt.getUTCDate() + days);
	return formatUtcDate(dt) + valTime;
}

function shiftDateByDelta(value, originalReference, nextReference, overrideTime = "") {
	if (!value) return null;
	if (!originalReference) {
		const { time } = splitDateTime(value);
		const finalTime = time && overrideTime ? overrideTime : time;
		return nextReference + finalTime;
	}
	const { date: valDate, time: valTime } = splitDateTime(value);
	const { date: refDate } = splitDateTime(originalReference);
	const dayOffset = daysBetween(refDate, valDate);
	const shiftedDate = addDays(nextReference, dayOffset);
	const finalTime = valTime && overrideTime ? overrideTime : valTime;
	return shiftedDate + finalTime;
}

export function nextRecurrenceDates(dates, rule, completedOn) {
	const referenceDate = dates.due ?? dates.scheduled ?? dates.start ?? dates.remind;
	if (!referenceDate && !rule.baseOnToday) {
		return { ...dates, done: null, cancelled: null };
	}

	const afterDate = rule.baseOnToday ? completedOn : (referenceDate ?? completedOn);
	const dtstartDate = rule.baseOnToday ? afterDate : (referenceDate ?? afterDate);
	const nextReferenceDate = nextDateAfter(afterDate, rule, dtstartDate);

	if (!nextReferenceDate) {
		return { ...dates, done: null, cancelled: null };
	}

	let completedTime = "";
	if (rule.baseOnToday) {
		const explicitCompletedTime = splitDateTime(completedOn).time;
		if (explicitCompletedTime) {
			completedTime = explicitCompletedTime;
		} else {
			const currentHm = nowTimeString();
			if (currentHm) {
				completedTime = ` ${currentHm}`;
			}
		}
	}

	const nextScheduled = !referenceDate && rule.baseOnToday
		? nextReferenceDate
		: shiftDateByDelta(dates.scheduled, referenceDate, nextReferenceDate, completedTime);

	return {
		...dates,
		start: shiftDateByDelta(dates.start, referenceDate, nextReferenceDate, completedTime),
		scheduled: nextScheduled,
		due: shiftDateByDelta(dates.due, referenceDate, nextReferenceDate, completedTime),
		remind: shiftDateByDelta(
			dates.remind,
			referenceDate,
			nextReferenceDate,
			referenceDate === dates.remind ? completedTime : "",
		),
		done: null,
		cancelled: null,
	};
}

function hasExistingOccurrence(lines, insertionLine, nextLines) {
	if (nextLines.length === 0 || insertionLine < nextLines.length) return false;
	const existing = lines.slice(insertionLine - nextLines.length, insertionLine);
	return existing.length === nextLines.length && existing.every((line, index) => line === nextLines[index]);
}

function makeNextOccurrence(original, terminated, registry, settings, shift) {
	const data = copyTaskData(original.data);
	const terminatedOn = terminated.dates.done ?? terminated.dates.cancelled ?? todayString();
	data.dates = nextRecurrenceDates(data.dates, shift, terminatedOn);
	data.dates.done = null;
	data.dates.cancelled = null;
	data.blockLink = null;
	data.id = null;
	data.dependsOn = null;
	if (settings.setCreatedDate) {
		data.dates.created = todayString();
	}
	const nextStatus = registry.recurrenceStatus(registry.getByType(terminated.status).symbol);
	data.status = nextStatus.type;
	return {
		...original,
		data,
		original: "",
	};
}

function copySubtreeForNextOccurrence(subtree, root, nextTask, registry, indentConfig, lines, format) {
	return subtree.map((node) => {
		const depth = taskDepth(node);
		const indent = getIndentPrefix(depth, indentConfig, lines);
		if (node.lineNumber === root.lineNumber) {
			return serializeTaskLine(nextTask, indent, registry, format);
		}
		if (!node.task) {
			return node.original;
		}
		const data = copyTaskData(node.task.data);
		data.dates.done = null;
		data.dates.cancelled = null;
		data.blockLink = null;
		data.id = null;
		data.dependsOn = null;
		data.status = registry.get(" ").type;
		return serializeTaskLine({ ...node.task, data }, indent, registry, format);
	});
}

export function buildRecurringTaskOccurrence({
	lines,
	recurringNode,
	terminatedTask,
	indentConfig,
	registry,
	settings,
	unsupportedWarning,
}) {
	const recurrence = recurringNode.task?.data.recurrence;
	const shift = parseRecurrenceRule(recurrence ?? null);
	if (!recurrence || !recurringNode.task) return null;
	if (!shift) {
		return { nextLines: [], warning: unsupportedWarning, skippedBecauseExisting: false };
	}

	const recurringSubtree = getSubtreeNodes(recurringNode);
	const nextTask = makeNextOccurrence(recurringNode.task, terminatedTask, registry, settings, shift);
	const format = settings.preferredTaskFormat ?? "dataview";
	const nextLines = settings.copySubtasksOnRecurrence
		? copySubtreeForNextOccurrence(recurringSubtree, recurringNode, nextTask, registry, indentConfig, lines, format)
		: [serializeTaskLine(nextTask, getIndentPrefix(taskDepth(recurringNode), indentConfig, lines), registry, format)];

	const insertionLine = getSubtreeLineRange(recurringNode).from;
	return {
		nextLines,
		skippedBecauseExisting: hasExistingOccurrence(lines, insertionLine, nextLines),
	};
}
