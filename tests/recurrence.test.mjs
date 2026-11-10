import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { setTodayOverride } from "../scripts/lib/dates.mjs";
import { StatusRegistry } from "../scripts/lib/format.mjs";
import { buildRecurringTaskOccurrence, nextRecurrenceDates, parseRecurrenceRule } from "../scripts/lib/recurrence.mjs";
import { buildTaskTree } from "../scripts/lib/tree.mjs";

const SETTINGS = {
	setCreatedDate: false,
	setDoneDate: true,
	setCancelledDate: true,
	copySubtasksOnRecurrence: true,
	preferredTaskFormat: "dataview",
};

describe("recurrence parser & next occurrence", () => {
	test("handles month-end and leap-day clamping plus explicit 31st rule", () => {
		const monthly = parseRecurrenceRule("every month");
		assert.ok(monthly);
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2026-01-31", done: null, cancelled: null, remind: null }, monthly, "2026-01-31").due,
			"2026-02-28",
		);

		const on31st = parseRecurrenceRule("every month on the 31st");
		assert.ok(on31st);
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2026-01-31", done: null, cancelled: null, remind: null }, on31st, "2026-01-31").due,
			"2026-03-31",
		);

		const biyearly = parseRecurrenceRule("every 2 years");
		assert.ok(biyearly);
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2024-02-29", done: null, cancelled: null, remind: null }, biyearly, "2024-02-29").due,
			"2026-02-28",
		);
	});

	test("handles weekly, weekday, nth-weekday, and last-day rules", () => {
		const weekday = parseRecurrenceRule("every weekday");
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2026-11-13", done: null, cancelled: null, remind: null }, weekday, "2026-11-13").due,
			"2026-11-16",
		);

		const biweekly = parseRecurrenceRule("every 2 weeks on Monday, Friday");
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2026-11-09", done: null, cancelled: null, remind: null }, biweekly, "2026-11-09").due,
			"2026-11-13",
		);
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2026-11-13", done: null, cancelled: null, remind: null }, biweekly, "2026-11-13").due,
			"2026-11-23",
		);

		const firstMon = parseRecurrenceRule("every month on the 1st Monday");
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2026-11-02", done: null, cancelled: null, remind: null }, firstMon, "2026-11-02").due,
			"2026-12-07",
		);

		const lastDay = parseRecurrenceRule("every month on the last day");
		assert.equal(
			nextRecurrenceDates({ start: null, created: null, scheduled: null, due: "2026-01-31", done: null, cancelled: null, remind: null }, lastDay, "2026-01-31").due,
			"2026-02-28",
		);
	});

	test("supports 'when done' with HH:mm preservation and builds subtree occurrence without duplicates", () => {
		const prevTime = process.env.TASKLITE_NOW_TIME;
		process.env.TASKLITE_NOW_TIME = "14:25";
		setTodayOverride("2026-11-10");
		try {
			const rule = parseRecurrenceRule("every 3 days when done");
			assert.ok(rule?.baseOnToday);
			const nextDates = nextRecurrenceDates(
				{
					start: "2026-11-01 09:00",
					created: null,
					scheduled: "2026-11-02",
					due: "2026-11-05 10:00",
					done: null,
					cancelled: null,
					remind: null,
				},
				rule,
				"2026-11-10",
			);
			assert.equal(nextDates.due, "2026-11-13 14:25");
			assert.equal(nextDates.start, "2026-11-09 14:25");
			assert.equal(nextDates.scheduled, "2026-11-10");

			const registry = new StatusRegistry();
			const lines = [
				"- [ ] Water plants [due:: 2026-11-10] [recurrence:: every day] [id:: wp]",
				"    - [ ] Kitchen",
			];
			const tree = buildTaskTree(lines, registry);
			const root = tree.byLine.get(0);
			const occ = buildRecurringTaskOccurrence({
				lines,
				recurringNode: root,
				terminatedTask: { ...root.task.data, status: "DONE", dates: { ...root.task.data.dates, done: "2026-11-10" } },
				indentConfig: { useTab: false, tabSize: 4 },
				registry,
				settings: SETTINGS,
				unsupportedWarning: "unsupported",
			});
			assert.ok(occ);
			assert.equal(occ.skippedBecauseExisting, false);
			assert.deepEqual(occ.nextLines, [
				"- [ ] Water plants [due:: 2026-11-11] [recurrence:: every day]",
				"    - [ ] Kitchen",
			]);
		} finally {
			setTodayOverride(null);
			if (prevTime === undefined) delete process.env.TASKLITE_NOW_TIME;
			else process.env.TASKLITE_NOW_TIME = prevTime;
		}
	});
});
