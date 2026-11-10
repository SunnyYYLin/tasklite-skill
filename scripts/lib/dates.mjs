const TIME_ONLY_REGEX = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?$/u;

let overriddenToday = null;

export function setTodayOverride(value) {
	if (value === null || value === undefined || value === "") {
		overriddenToday = null;
		return;
	}
	const trimmed = String(value).trim();
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
		throw new Error(`Invalid --today date "${value}". Expected YYYY-MM-DD.`);
	}
	overriddenToday = trimmed;
}

export function getTodayOverride() {
	if (overriddenToday) return overriddenToday;
	const env = process.env.TASKLITE_TODAY?.trim();
	if (env && /^\d{4}-\d{2}-\d{2}$/u.test(env)) {
		return env;
	}
	return null;
}

export function todayString(now = new Date()) {
	const override = getTodayOverride();
	if (override) return override;
	const y = String(now.getFullYear()).padStart(4, "0");
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function nowTimeString(now = new Date()) {
	const envTime = process.env.TASKLITE_NOW_TIME?.trim();
	if (envTime && /^\d{2}:\d{2}$/u.test(envTime)) {
		return envTime;
	}
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

export function todayUtcDate() {
	const [y, m, d] = todayString().split("-").map((n) => Number.parseInt(n, 10));
	return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function formatUtcDate(date) {
	const y = String(date.getUTCFullYear()).padStart(4, "0");
	const m = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function parseIsoDateUtc(value) {
	const datePart = parseCanonicalDateTime(value)?.date ?? String(value).trim();
	const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	const dt = new Date(Date.UTC(year, month - 1, day));
	if (
		dt.getUTCFullYear() !== year ||
		dt.getUTCMonth() !== month - 1 ||
		dt.getUTCDate() !== day
	) {
		return null;
	}
	return dt;
}

export function isValidCalendarDate(year, month, day) {
	const dt = new Date(Date.UTC(year, month - 1, day));
	return (
		dt.getUTCFullYear() === year &&
		dt.getUTCMonth() === month - 1 &&
		dt.getUTCDate() === day
	);
}

/**
 * Normalize a task date or date-time string so that single-digit months, days,
 * and 24-hour hours are zero-padded (`YYYY-MM-DD` or `YYYY-MM-DD HH:mm`), while
 * preserving 12-hour `AM`/`PM` formatting when explicitly present.
 */
export function normalizeTaskDateValue(raw) {
	const trimmed = String(raw).trim();
	const match = trimmed.match(
		/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(\s*[AaPp][Mm])?)?$/u,
	);
	if (!match) return trimmed;
	const year = match[1];
	const month = match[2].padStart(2, "0");
	const day = match[3].padStart(2, "0");
	const datePart = `${year}-${month}-${day}`;
	if (match[4] === undefined || match[5] === undefined) {
		return datePart;
	}
	const rawHour = match[4];
	const minute = match[5];
	const second = match[6];
	const meridiem = match[7];
	const secSuffix = second !== undefined ? `:${second}` : "";
	if (meridiem) {
		return `${datePart} ${rawHour}:${minute}${secSuffix}${meridiem}`;
	}
	const hour = rawHour.padStart(2, "0");
	return `${datePart} ${hour}:${minute}${secSuffix}`;
}

/**
 * Parse a date or date-time string into canonical 24-hour components for
 * comparison and sorting (`date`: `YYYY-MM-DD`, `time`: `HH:mm:ss` or `null`,
 * `full`: `YYYY-MM-DD` or `YYYY-MM-DD HH:mm:ss`).
 */
export function parseCanonicalDateTime(raw) {
	if (!raw) return null;
	const trimmed = String(raw).trim();
	const match = trimmed.match(
		/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?)?$/u,
	);
	if (!match) return null;
	const year = match[1];
	const month = match[2].padStart(2, "0");
	const day = match[3].padStart(2, "0");
	const date = `${year}-${month}-${day}`;
	if (match[4] === undefined || match[5] === undefined) {
		return { date, time: null, full: date, hasTime: false };
	}
	let hour = Number.parseInt(match[4], 10);
	const minute = match[5];
	const second = match[6] ?? "00";
	const meridiem = match[7]?.toLowerCase();
	if (meridiem === "pm" && hour < 12) {
		hour += 12;
	} else if (meridiem === "am" && hour === 12) {
		hour = 0;
	}
	const time = `${String(hour).padStart(2, "0")}:${minute}:${second}`;
	return { date, time, full: `${date} ${time}`, hasTime: true };
}

export function resolveDueDateFromStart(due, start) {
	if (!due) return due;
	const trimmedDue = String(due).trim();
	if (TIME_ONLY_REGEX.test(trimmedDue) && start) {
		const normalizedStart = normalizeTaskDateValue(start);
		const startMatch = normalizedStart.match(/^(\d{4}-\d{2}-\d{2})/u);
		if (startMatch?.[1]) {
			return normalizeTaskDateValue(`${startMatch[1]} ${trimmedDue}`);
		}
	}
	return normalizeTaskDateValue(trimmedDue);
}

export function isTimeOnlyDateValue(value) {
	return Boolean(value && TIME_ONLY_REGEX.test(String(value).trim()));
}

const WEEKDAY_ALIASES = {
	monday: 1, mon: 1, mo: 1,
	tuesday: 2, tue: 2, tu: 2,
	wednesday: 3, wed: 3, we: 3,
	thursday: 4, thu: 4, th: 4,
	friday: 5, fri: 5, fr: 5,
	saturday: 6, sat: 6, sa: 6,
	sunday: 7, sun: 7, su: 7,
};

const CN_WEEKDAY_MAP = {
	"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
};

function offsetDays(days) {
	const dt = todayUtcDate();
	dt.setUTCDate(dt.getUTCDate() + days);
	return formatUtcDate(dt);
}

function offsetMonths(months) {
	const dt = todayUtcDate();
	const originalDay = dt.getUTCDate();
	dt.setUTCDate(1);
	dt.setUTCMonth(dt.getUTCMonth() + months);
	const maxDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
	dt.setUTCDate(Math.min(originalDay, maxDay));
	return formatUtcDate(dt);
}

function nextWeekdayFromToday(isoWd, weekOffset = 1) {
	const dt = todayUtcDate();
	const todayDow = dt.getUTCDay() || 7;
	let diff = isoWd - todayDow;
	if (weekOffset > 0 && diff <= 0) diff += 7;
	if (weekOffset < 0 && diff >= 0) diff -= 7;
	diff += (weekOffset > 0 ? weekOffset - 1 : weekOffset + 1) * 7;
	dt.setUTCDate(dt.getUTCDate() + diff);
	return formatUtcDate(dt);
}

function thisWeekday(isoWd) {
	const dt = todayUtcDate();
	const todayDow = dt.getUTCDay() || 7;
	dt.setUTCDate(dt.getUTCDate() + (isoWd - todayDow));
	return formatUtcDate(dt);
}

/**
 * Parse a date shorthand or ISO date string into YYYY-MM-DD.
 */
export function parseDateShorthand(input) {
	const s = String(input).trim().toLowerCase();
	if (!s) return null;

	if (s === "today" || s === "今天") return offsetDays(0);
	if (s === "yesterday" || s === "昨天") return offsetDays(-1);
	if (s === "tomorrow" || s === "明天") return offsetDays(1);
	if (s === "后天") return offsetDays(2);
	if (s === "大后天") return offsetDays(3);
	if (s === "前天") return offsetDays(-2);

	if (/^\d{4}-\d{1,2}-\d{1,2}$/u.test(s)) {
		const norm = normalizeTaskDateValue(s);
		return parseIsoDateUtc(norm) ? norm : null;
	}

	const monthDayMatch = s.match(/^(\d{1,2})-(\d{1,2})$/u);
	if (monthDayMatch) {
		const year = todayUtcDate().getUTCFullYear();
		const m = Number.parseInt(monthDayMatch[1], 10);
		const d = Number.parseInt(monthDayMatch[2], 10);
		if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && isValidCalendarDate(year, m, d)) {
			return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
		}
	}

	const dayMatch = s.match(/^(\d{1,2})$/u);
	if (dayMatch) {
		const today = todayUtcDate();
		const year = today.getUTCFullYear();
		const month = today.getUTCMonth() + 1;
		const d = Number.parseInt(dayMatch[1], 10);
		if (d >= 1 && d <= 31 && isValidCalendarDate(year, month, d)) {
			return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
		}
	}

	if (s === "next week" || s === "下周") return nextWeekdayFromToday(1, 1);
	if (s === "last week") return nextWeekdayFromToday(1, -1);

	const nextWdMatch = s.match(/^next\s+([a-z]+)$/u);
	if (nextWdMatch) {
		const wd = WEEKDAY_ALIASES[nextWdMatch[1]];
		if (wd) return nextWeekdayFromToday(wd, 1);
	}
	const thisWdMatch = s.match(/^this\s+([a-z]+)$/u);
	if (thisWdMatch) {
		const wd = WEEKDAY_ALIASES[thisWdMatch[1]];
		if (wd) return thisWeekday(wd);
	}
	const lastWdMatch = s.match(/^last\s+([a-z]+)$/u);
	if (lastWdMatch) {
		const wd = WEEKDAY_ALIASES[lastWdMatch[1]];
		if (wd) return nextWeekdayFromToday(wd, -1);
	}

	const daysMatch = s.match(/^(?:in\s+)?(\d+)\s*days?(?:\s+(?:later|ago))?$/u);
	if (daysMatch) {
		const n = Number.parseInt(daysMatch[1], 10);
		return offsetDays(s.includes("ago") ? -n : n);
	}
	const weeksMatch = s.match(/^(?:in\s+)?(\d+)\s*weeks?(?:\s+(?:later|ago))?$/u);
	if (weeksMatch) {
		const n = Number.parseInt(weeksMatch[1], 10);
		return offsetDays(n * 7 * (s.includes("ago") ? -1 : 1));
	}
	const monthsMatch = s.match(/^(?:in\s+)?(\d+)\s*months?(?:\s+(?:later|ago))?$/u);
	if (monthsMatch) {
		const n = Number.parseInt(monthsMatch[1], 10);
		return offsetMonths(n * (s.includes("ago") ? -1 : 1));
	}

	const cnDaysAfter = s.match(/^(\d+)天后?$/u);
	if (cnDaysAfter) return offsetDays(Number.parseInt(cnDaysAfter[1], 10));
	const cnDaysBefore = s.match(/^(\d+)天前$/u);
	if (cnDaysBefore) return offsetDays(-Number.parseInt(cnDaysBefore[1], 10));
	const cnWeeksAfter = s.match(/^(\d+)周后?$/u);
	if (cnWeeksAfter) return offsetDays(Number.parseInt(cnWeeksAfter[1], 10) * 7);
	const cnMonthsAfter = s.match(/^(\d+)个?月后?$/u);
	if (cnMonthsAfter) return offsetMonths(Number.parseInt(cnMonthsAfter[1], 10));

	const cnNextWeekday = s.match(/^下周([一二三四五六日天])$/u);
	if (cnNextWeekday) {
		const wd = CN_WEEKDAY_MAP[cnNextWeekday[1]];
		if (wd) return nextWeekdayFromToday(wd, 1);
	}
	const cnThisWeekday = s.match(/^(?:本|这)周([一二三四五六日天])$/u);
	if (cnThisWeekday) {
		const wd = CN_WEEKDAY_MAP[cnThisWeekday[1]];
		if (wd) return thisWeekday(wd);
	}

	return null;
}

/**
 * Parse CLI date input (ISO date/datetime, time-only, or shorthand like
 * `tomorrow 09:30` / `today` / `明天`). Throws on invalid date values.
 */
export function parseCliDateInput(raw, options = {}) {
	if (raw === null) return null;
	const trimmed = String(raw).trim();
	if (!trimmed) return null;

	if (options.allowTimeOnly && TIME_ONLY_REGEX.test(trimmed)) {
		return trimmed;
	}

	const canonical = parseCanonicalDateTime(trimmed);
	if (canonical) {
		if (!parseIsoDateUtc(canonical.date)) {
			throw new Error(`Invalid calendar date "${raw}".`);
		}
		return normalizeTaskDateValue(trimmed);
	}

	// Support "<shorthand> <HH:mm>" (e.g. "tomorrow 09:30", "today 6:30pm")
	const timeSuffixMatch = trimmed.match(/^(.+?)\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)$/u);
	if (timeSuffixMatch) {
		const datePart = parseDateShorthand(timeSuffixMatch[1]);
		if (datePart) {
			return normalizeTaskDateValue(`${datePart} ${timeSuffixMatch[2]}`);
		}
	}

	const shorthand = parseDateShorthand(trimmed);
	if (shorthand) {
		return shorthand;
	}

	throw new Error(
		`Invalid date "${raw}". Expected YYYY-MM-DD[ HH:mm], or shorthand like today, tomorrow, in 3 days, next monday.`,
	);
}
