import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { setTodayOverride } from "../scripts/lib/dates.mjs";
import { TaskQueryError, detectQueryStatusHints, filterTaskRecordsByQuery } from "../scripts/lib/query.mjs";

function rec(input) {
	return {
		path: input.path ?? "Work/tasks.md",
		basename: (input.path ?? "Work/tasks.md").split("/").pop().replace(/\.md$/u, ""),
		lineNumber: input.lineNumber ?? 0,
		parentLine: input.parentLine ?? null,
		depth: input.depth ?? 0,
		hasChildren: input.hasChildren ?? false,
		task: {
			status: input.status ?? "TODO",
			description: input.description,
			priority: input.priority ?? null,
			dates: {
				start: input.start ?? null,
				created: null,
				scheduled: input.scheduled ?? null,
				due: input.due ?? null,
				done: input.done ?? null,
				cancelled: null,
				remind: null,
			},
			recurrence: null,
			onCompletion: null,
			dependsOn: input.dependsOn ?? null,
			id: input.id ?? null,
			assignee: input.assignee ?? [],
			location: input.location ?? null,
			blockLink: null,
			tags: input.tags ?? [],
			unmatched: null,
		},
	};
}

describe("TaskLite DQL query engine", () => {
	afterEach(() => {
		setTodayOverride(null);
	});

	test("supports fields, priority comparison, array assignees, relative dates, and macros", () => {
		setTodayOverride("2026-05-16");
		const records = [
			rec({
				lineNumber: 0,
				hasChildren: true,
				description: "Ship dashboard",
				status: "TODO",
				priority: "highest",
				due: "2026-05-16",
				scheduled: "2026-05-15",
				tags: ["#work"],
				assignee: ["Alice", "Bob"],
				location: "Beijing",
			}),
			rec({
				lineNumber: 1,
				parentLine: 0,
				depth: 1,
				description: "Backlog item",
				status: "TODO",
				due: "2026-05-20",
				scheduled: "2026-05-20",
				tags: ["#later"],
				dependsOn: "ship",
			}),
			rec({
				path: "Work/done.md",
				description: "Done report",
				status: "DONE",
				priority: "medium",
				due: "2026-05-20",
				assignee: ["Bob"],
			}),
			rec({
				path: "Work/span.md",
				description: "Spanning project",
				status: "TODO",
				start: "2026-05-10",
				due: "2026-05-20",
			}),
		];

		assert.deepEqual(
			filterTaskRecordsByQuery(records, 'priority > "medium"').map((r) => r.task.description),
			["Ship dashboard"],
		);
		assert.deepEqual(
			filterTaskRecordsByQuery(records, 'person = "Alice" AND loc = "Beijing"').map((r) => r.task.description),
			["Ship dashboard"],
		);
		assert.deepEqual(
			filterTaskRecordsByQuery(records, "due = date(today, +4d)").map((r) => r.task.description),
			["Backlog item", "Done report", "Spanning project"],
		);
		assert.deepEqual(
			filterTaskRecordsByQuery(records, "is(open) AND (happens(today) OR covers(today) OR is(overdate))").map((r) => r.task.description),
			["Ship dashboard", "Spanning project"],
		);
		assert.deepEqual(
			filterTaskRecordsByQuery(records, "is(blocked)").map((r) => r.task.description),
			["Backlog item"],
		);
		assert.deepEqual(
			filterTaskRecordsByQuery(records, "is(subtask)").map((r) => r.task.description),
			["Backlog item"],
		);
	});

	test("detects status hints and rejects invalid query fields/macros", () => {
		assert.deepEqual(detectQueryStatusHints('is(done) OR status = "CANCELLED"'), {
			mentionsDone: true,
			mentionsCancelled: true,
		});
		assert.throws(() => filterTaskRecordsByQuery([], 'bogus = "x"'), TaskQueryError);
		assert.throws(() => filterTaskRecordsByQuery([], "is(unknown_state)"), TaskQueryError);
	});
});
