import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	StatusRegistry,
	normalizeLineIndentation,
	parseLineWithStatus,
	parseTaskLine,
	serializeTaskLine,
} from "../scripts/lib/format.mjs";
import { buildTaskTree, getSubtreeLineRange, getTaskParentLine, taskDepth } from "../scripts/lib/tree.mjs";

describe("format parsing & serialization", () => {
	test("parses emoji task fields, dates with time, tags, location, assignee, and block link", () => {
		const task = parseTaskLine(
			"- [ ] Deploy API #ops ⏫ 🛫 2026-11-01 ⏰ 2026-11-10 18:30 📅 2026-11-01 19:00 🔁 every week 👤 Alice & Bob 📍 Lab ^blk1",
			"TODO",
		);
		assert.ok(task);
		assert.equal(task.data.description, "Deploy API #ops");
		assert.equal(task.data.priority, "high");
		assert.equal(task.data.dates.start, "2026-11-01");
		assert.equal(task.data.dates.remind, "2026-11-10 18:30");
		assert.equal(task.data.dates.due, "2026-11-01 19:00");
		assert.equal(task.data.recurrence, "every week");
		assert.deepEqual(task.data.assignee, ["Alice", "Bob"]);
		assert.equal(task.data.location, "Lab");
		assert.equal(task.data.blockLink, "^blk1");
		assert.deepEqual(task.data.tags, ["#ops"]);

		const timed = parseTaskLine(
			"- [ ] Windowed deploy [start:: 2026-11-01] [due:: 19:00]",
			"TODO",
		);
		assert.ok(timed);
		assert.equal(timed.data.dates.start, "2026-11-01");
		assert.equal(timed.data.dates.due, "2026-11-01 19:00");
	});

	test("roundtrips dataview and emoji formats cleanly", () => {
		const registry = new StatusRegistry();
		const src = "- [/] Review PR [priority:: medium] [scheduled:: 2026-11-10 09:30] [id:: rpr] [assignee:: Sunny & Mary] [location:: Home]";
		const parsed = parseLineWithStatus(src, registry);
		assert.ok(parsed);
		assert.equal(parsed.data.status, "IN_PROGRESS");

		const dvLine = serializeTaskLine(parsed, "    ", registry, "dataview");
		assert.equal(
			dvLine,
			"    - [/] Review PR [priority:: medium] [scheduled:: 2026-11-10 09:30] [id:: rpr] [assignee:: Sunny & Mary] [location:: Home]",
		);

		const emojiLine = serializeTaskLine(parsed, "\t", registry, "emoji");
		assert.equal(
			emojiLine,
			"\t- [/] Review PR 🔼 ⏳ 2026-11-10 09:30 🆔 rpr 👤 Sunny & Mary 📍 Home",
		);
		const reparsed = parseLineWithStatus(emojiLine, registry);
		assert.equal(reparsed.data.priority, "medium");
		assert.equal(reparsed.data.id, "rpr");
		assert.deepEqual(reparsed.data.assignee, ["Sunny", "Mary"]);
		assert.equal(reparsed.data.location, "Home");
	});

	test("preserves -[] non-task marker inside description and skips empty brackets", () => {
		assert.equal(parseTaskLine("- [] invalid", "TODO"), null);
		const task = parseTaskLine("- [ ] check -[] literal ✅ 2026-11-10", "TODO");
		assert.ok(task);
		assert.equal(task.data.description, "check -[] literal");
		assert.equal(task.data.dates.done, "2026-11-10");
	});

	test("normalizes indentation with tabs, spaces, and blockquotes", () => {
		assert.equal(normalizeLineIndentation("    - [ ] task", true, 4), "\t- [ ] task");
		assert.equal(normalizeLineIndentation("\t- [ ] task", false, 4), "    - [ ] task");
		assert.equal(normalizeLineIndentation(">     - [ ] task", true, 4), "> \t- [ ] task");
		assert.equal(normalizeLineIndentation("> \t- [ ] task", false, 4), ">     - [ ] task");
	});
});

describe("tree inference offline edge cases", () => {
	test("skips YAML frontmatter lists and fenced code blocks while keeping 0-based line indices", () => {
		const registry = new StatusRegistry();
		const lines = [
			"---",
			"task: true",
			"assignee:",
			"  - Sunny",
			"---",
			"```markdown",
			"- [ ] code sample should be ignored",
			"```",
			"- [ ] Real root task",
			"    - [ ] Child task",
			"- plain item",
			"    - [ ] Nested under plain item",
		];

		const tree = buildTaskTree(lines, registry);
		const taskNodes = tree.nodes.filter((n) => n.task);
		assert.deepEqual(
			taskNodes.map((n) => n.lineNumber),
			[8, 9, 11],
		);

		const root = tree.byLine.get(8);
		const child = tree.byLine.get(9);
		const underPlain = tree.byLine.get(11);

		assert.equal(getTaskParentLine(root), null);
		assert.equal(getTaskParentLine(child), 8);
		assert.equal(taskDepth(child), 1);
		assert.deepEqual(getSubtreeLineRange(root), { from: 8, to: 9 });
		assert.equal(getTaskParentLine(underPlain), null);
	});
});
