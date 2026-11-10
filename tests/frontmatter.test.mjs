import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { StatusRegistry } from "../scripts/lib/format.mjs";
import {
	applyFrontmatterPatchToContent,
	buildFrontmatterPatch,
	parseFrontmatter,
	parseFrontmatterTask,
} from "../scripts/lib/frontmatter.mjs";

describe("frontmatter YAML parsing and patching", () => {
	test("parses frontmatter task with block-list assignee, status keyword, and unrelated properties", () => {
		const content = [
			"---",
			"task: true",
			"description: 转移NAS到ZGCA",
			"status: in-progress",
			"priority: medium",
			"assignee:",
			"  - Mary",
			"  - Sunny",
			"tags:",
			"  - infra",
			"  - nas",
			"customProp: keep-me",
			"due: 2026-10-31",
			"---",
			"- [ ] Subtask line",
		].join("\n");

		const lines = content.split("\n");
		const { frontmatter } = parseFrontmatter(lines);
		const registry = new StatusRegistry();
		const record = parseFrontmatterTask(
			{ path: "Life/转移NAS到ZGCA.md", basename: "转移NAS到ZGCA" },
			frontmatter,
			registry,
			true,
		);

		assert.ok(record);
		assert.equal(record.lineNumber, -1);
		assert.equal(record.task.status, "IN_PROGRESS");
		assert.equal(record.task.description, "转移NAS到ZGCA");
		assert.deepEqual(record.task.assignee, ["Mary", "Sunny"]);
		assert.deepEqual(record.task.tags, ["#infra", "#nas"]);
		assert.equal(record.task.dates.due, "2026-10-31");

		const patch = buildFrontmatterPatch(
			record.task,
			{ status: "DONE", assignee: ["Sunny"], dates: { due: null, done: "2026-11-10" } },
			registry,
			record.rawStatus,
		);
		const next = applyFrontmatterPatchToContent(content, patch);

		assert.match(next, /customProp: keep-me/u);
		assert.match(next, /status: done/u);
		assert.match(next, /done: 2026-11-10/u);
		assert.doesNotMatch(next, /^due:/mu);
		assert.doesNotMatch(next, /- Mary/u);
		assert.match(next, /assignee:\n  - Sunny/u);
		assert.match(next, /\n- \[ \] Subtask line$/u);
	});

	test("creates frontmatter header when file has none and quotes whitespace status", () => {
		const updated = applyFrontmatterPatchToContent("Body paragraph\n", {
			task: true,
			status: " ",
			description: "Note: Task",
		});
		assert.match(updated, /^---\ntask: true\nstatus: " "\ndescription: "Note: Task"\n---\nBody paragraph\n$/u);
	});
});
