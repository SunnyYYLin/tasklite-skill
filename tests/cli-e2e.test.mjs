import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");

const tempDirs = [];

async function makeTempVault({ appJson = { useTab: false, tabSize: 4 }, pluginSettings = null } = {}) {
	const dir = await mkdtemp(path.join(os.tmpdir(), "tasklite-skill-e2e-"));
	tempDirs.push(dir);
	await mkdir(path.join(dir, ".obsidian", "plugins", "taskslite"), { recursive: true });
	await writeFile(path.join(dir, ".obsidian", "app.json"), JSON.stringify(appJson, null, 2), "utf8");
	if (pluginSettings) {
		await writeFile(
			path.join(dir, ".obsidian", "plugins", "taskslite", "data.json"),
			JSON.stringify(pluginSettings, null, 2),
			"utf8",
		);
	}
	return dir;
}

async function runScript(scriptName, args = [], options = {}) {
	const scriptPath = path.join(SCRIPTS_DIR, scriptName);
	try {
		const res = await execFileAsync(process.execPath, [scriptPath, ...args], {
			cwd: options.cwd ?? SCRIPTS_DIR,
			env: {
				...process.env,
				TASKLITE_TODAY: "2026-11-10",
				TASKLITE_NOW_TIME: "09:30",
				...(options.env ?? {}),
			},
		});
		return { code: 0, stdout: res.stdout, stderr: res.stderr };
	} catch (err) {
		return {
			code: typeof err.code === "number" ? err.code : 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		await rm(dir, { recursive: true, force: true });
	}
});

describe("CLI scripts end-to-end", () => {
	test("list.mjs and create.mjs respect Obsidian config, auto-detection, exclusions, emoji mode, and ID collision", async () => {
		const vault = await makeTempVault({
			appJson: { useTab: false, tabSize: 2 },
			pluginSettings: {
				defaultAssignee: "Sunny",
				assignees: ["Mary", "Alice"],
				preferredTaskFormat: "emoji",
			},
		});

		await mkdir(path.join(vault, "Projects"), { recursive: true });
		await mkdir(path.join(vault, ".agents", "skills", "tasklite"), { recursive: true });
		await writeFile(
			path.join(vault, "Projects", "Active.md"),
			"- [ ] Kickoff 🆔 k 👤 Bob\n- [ ] Hidden `.obsidian` and `.agents`\n",
			"utf8",
		);
		await writeFile(
			path.join(vault, ".obsidian", "Internal.md"),
			"- [ ] Obsidian internal task\n",
			"utf8",
		);
		await writeFile(
			path.join(vault, ".agents", "skills", "tasklite", "IgnoreMe.md"),
			"- [ ] Dot-dir skill task\n",
			"utf8",
		);
		await writeFile(
			path.join(vault, "Ignored.md"),
			"---\ntasks: ignore\n---\n- [ ] Ignored by frontmatter\n",
			"utf8",
		);

		// Auto-detect vault from nested subdirectory without --vault + ensure excluded files are skipped
		const listRes = await runScript("list.mjs", ["--json"], {
			cwd: path.join(vault, "Projects"),
		});
		assert.equal(listRes.code, 0, listRes.stderr);
		const listData = JSON.parse(listRes.stdout);
		assert.equal(path.resolve(listData.vault), path.resolve(vault));
		assert.equal(listData.total, 2);
		assert.ok(listData.tasks.every((t) => t.path === "Projects/Active.md"));

		// create --auto-id avoids collision with existing "k" ID and formats in emoji mode
		const createdEmoji = await runScript("create.mjs", [
			"--vault", vault,
			"--path", "Projects/Active.md",
			"--desc", "Kick",
			"--auto-id",
			"--assignee", "Sunny",
			"--json",
		]);
		assert.equal(createdEmoji.code, 0, createdEmoji.stderr);
		const createdJson = JSON.parse(createdEmoji.stdout).created;
		assert.match(createdJson.id, /^k-[a-z0-9]{4}$/);
		assert.match(createdJson.line, new RegExp(`🆔 ${createdJson.id}`));
		assert.match(createdJson.line, /👤 Sunny/);
	});

	test("create.mjs and list.mjs handle root tasks, subtasks, frontmatter tasks, DQL, sorting, and --id lookup", async () => {
		const vault = await makeTempVault({
			appJson: { useTab: false, tabSize: 4 },
			pluginSettings: { preferredTaskFormat: "dataview" },
		});

		// Create root task with shorthand dates, time-only due derived from start, auto-id, tag, assignee
		const createRoot = await runScript("create.mjs", [
			"--vault", vault,
			"--path", "Work/Sprint.md",
			"--desc", "写周报",
			"--priority", "high",
			"--start", "tomorrow",
			"--due", "18:30",
			"--assignee", "Sunny",
			"--assignee", "Mary",
			"--location", "Office",
			"--tag", "work",
			"--auto-id",
			"--json",
		]);
		assert.equal(createRoot.code, 0, createRoot.stderr);
		const rootCreated = JSON.parse(createRoot.stdout).created;
		assert.equal(rootCreated.path, "Work/Sprint.md");
		assert.equal(rootCreated.lineNumber, 0);
		assert.equal(rootCreated.id, "xzb");
		assert.match(rootCreated.line, /\[start:: 2026-11-11\]/);
		assert.match(rootCreated.line, /\[due:: 2026-11-11 18:30\]/);
		assert.match(rootCreated.line, /\[assignee:: Sunny & Mary\]/);
		assert.match(rootCreated.line, /#work/);

		// Create subtask via --parent-id (inherits Work/Sprint.md automatically)
		const createChild = await runScript("create.mjs", [
			"--vault", vault,
			"--parent-id", "xzb",
			"--desc", "Collect metrics",
			"--id", "collect-metrics",
			"--json",
		]);
		assert.equal(createChild.code, 0, createChild.stderr);
		const childCreated = JSON.parse(createChild.stdout).created;
		assert.equal(childCreated.path, "Work/Sprint.md");
		assert.equal(childCreated.lineNumber, 1);
		assert.equal(childCreated.parentLine, 0);
		assert.ok(childCreated.line.startsWith("    - [ ] "));

		// Create file-level frontmatter task in a note that already has custom frontmatter
		await writeFile(
			path.join(vault, "Work", "Epic.md"),
			"---\nowner: TeamA\n---\nProject body text.\n",
			"utf8",
		);
		const createFm = await runScript("create.mjs", [
			"--vault", vault,
			"--path", "Work/Epic.md",
			"--file-task",
			"--desc", "Ship v2 Epic",
			"--due", "in 3 days",
			"--id", "ship-epic",
			"--assignee", "Sunny & Alice",
			"--json",
		]);
		assert.equal(createFm.code, 0, createFm.stderr);
		const epicRaw = await readFile(path.join(vault, "Work", "Epic.md"), "utf8");
		assert.match(epicRaw, /owner: TeamA/);
		assert.match(epicRaw, /task: true/);
		assert.match(epicRaw, /due: 2026-11-13/);
		assert.match(epicRaw, /Project body text\./);

		// list.mjs filters: --id, --root-only, --frontmatter-only, DQL, --sort, --limit
		const byId = JSON.parse((await runScript("list.mjs", ["--vault", vault, "--id", "collect-metrics", "--json"])).stdout);
		assert.equal(byId.total, 1);
		assert.equal(byId.tasks[0].parentLine, 0);

		const rootOnly = JSON.parse((await runScript("list.mjs", ["--vault", vault, "--root-only", "--json"])).stdout);
		assert.equal(rootOnly.total, 2);

		const fmOnly = JSON.parse((await runScript("list.mjs", ["--vault", vault, "--frontmatter-only", "--json"])).stdout);
		assert.equal(fmOnly.total, 1);
		assert.equal(fmOnly.tasks[0].task.id, "ship-epic");

		const dqlLimited = JSON.parse(
			(await runScript("list.mjs", ["--vault", vault, "--query", 'person = "Sunny"', "--sort", "due", "--limit", "1", "--json"])).stdout,
		);
		assert.equal(dqlLimited.total, 2);
		assert.equal(dqlLimited.count, 1);
		assert.equal(dqlLimited.tasks[0].task.id, "xzb");
	});

	test("status.mjs handles dependencies, cross-file unblocking, cascade, frontmatter sync, recurrence, onCompletion delete, and CRLF+BOM", async () => {
		const vault = await makeTempVault({
			appJson: { useTab: false, tabSize: 4 },
			pluginSettings: {
				setDoneDate: true,
				setCancelledDate: true,
				copySubtasksOnRecurrence: true,
				preferredTaskFormat: "dataview",
			},
		});

		// Note A uses CRLF + UTF-8 BOM to test encoding preservation
		const fileAContent = [
			"\uFEFF---",
			"task: true",
			"description: Release Checklist",
			"status: \" \"",
			"---",
			"- [ ] Write release notes [id:: rel-notes]",
			"- [ ] Daily backup [due:: 2026-11-10] [recurrence:: every day] [id:: backup]",
			"    - [x] Verify disk [done:: 2026-11-09] [id:: disk-ok]",
			"- [ ] Ephemeral ping [onCompletion:: delete] [id:: temp-ping]",
		].join("\r\n") + "\r\n";
		await writeFile(path.join(vault, "A.md"), fileAContent, "utf8");

		// Note B has task blocked by rel-notes and another blocker
		await writeFile(
			path.join(vault, "B.md"),
			"- [ ] Deploy release [dependsOn:: rel-notes, other-step] [id:: deploy]\n",
			"utf8",
		);

		// Completing blocked task without --force fails
		const blockedRes = await runScript("status.mjs", ["--vault", vault, "--id", "deploy", "--done", "--json"]);
		assert.notEqual(blockedRes.code, 0);
		assert.match(blockedRes.stderr, /blocked by unfinished dependencies/i);

		// Completing rel-notes removes it from B.md dependsOn while keeping other-step
		const doneRel = await runScript("status.mjs", ["--vault", vault, "--id", "rel-notes", "--done", "--json"]);
		assert.equal(doneRel.code, 0, doneRel.stderr);
		const doneRelJson = JSON.parse(doneRel.stdout).result;
		assert.equal(doneRelJson.unblocked.length, 1);
		assert.equal(doneRelJson.unblocked[0].path, "B.md");
		assert.deepEqual(doneRelJson.unblocked[0].removedDependencies, ["rel-notes"]);
		assert.equal(doneRelJson.unblocked[0].dependsOn, "other-step");

		// list.mjs --id finds DONE tasks cleanly too
		const lookupDone = JSON.parse((await runScript("list.mjs", ["--vault", vault, "--id", "rel-notes", "--json"])).stdout);
		assert.equal(lookupDone.total, 1);
		assert.equal(lookupDone.tasks[0].task.status, "DONE");

		const bAfter = await readFile(path.join(vault, "B.md"), "utf8");
		assert.match(bAfter, /\[dependsOn:: other-step\]/);

		// Verify BOM and CRLF preserved in A.md
		const aAfter1 = await readFile(path.join(vault, "A.md"), "utf8");
		assert.ok(aAfter1.startsWith("\uFEFF"), "Expected UTF-8 BOM to be preserved");
		assert.ok(aAfter1.includes("\r\n"), "Expected CRLF line endings to be preserved");

		// Complete recurring task backup -> inserts next occurrence at 2026-11-11 with reset subtask
		const recurRes = await runScript("status.mjs", ["--vault", vault, "--id", "backup", "--done", "--json"]);
		assert.equal(recurRes.code, 0, recurRes.stderr);
		const recurJson = JSON.parse(recurRes.stdout).result;
		assert.deepEqual(recurJson.recurrenceCreated, [
			"- [ ] Daily backup [due:: 2026-11-11] [recurrence:: every day]",
			"    - [ ] Verify disk",
		]);

		// Complete temp-ping -> deleted due to onCompletion: delete
		const onDelRes = await runScript("status.mjs", ["--vault", vault, "--id", "temp-ping", "--done", "--json"]);
		assert.equal(onDelRes.code, 0, onDelRes.stderr);
		assert.equal(JSON.parse(onDelRes.stdout).result.deletedOnCompletion, true);
		const aAfterDelete = await readFile(path.join(vault, "A.md"), "utf8");
		assert.doesNotMatch(aAfterDelete, /Ephemeral ping/);

		// Frontmatter parent sync + toggle reopen in C.md
		await writeFile(
			path.join(vault, "C.md"),
			[
				"---",
				"task: true",
				"description: Parent Note",
				"status: \" \"",
				"---",
				"- [x] Child 1 [done:: 2026-11-09]",
				"- [ ] Child 2 [id:: c2]",
			].join("\n"),
			"utf8",
		);
		const finishC2 = await runScript("status.mjs", ["--vault", vault, "--id", "c2", "--done", "--json"]);
		assert.equal(finishC2.code, 0, finishC2.stderr);
		let cText = await readFile(path.join(vault, "C.md"), "utf8");
		assert.match(cText, /status: x/);
		assert.match(cText, /done: 2026-11-10/);

		// Reopening Child 2 with --toggle reopens frontmatter Parent Note as well
		const reopenC2 = await runScript("status.mjs", ["--vault", vault, "--id", "c2", "--toggle", "--json"]);
		assert.equal(reopenC2.code, 0, reopenC2.stderr);
		cText = await readFile(path.join(vault, "C.md"), "utf8");
		assert.match(cText, /status: " "/);
		assert.doesNotMatch(cText, /^done:/m);
	});

	test("delete.mjs supports --dry-run, subtree deletion, frontmatter cleanup, and path traversal guard", async () => {
		const vault = await makeTempVault();
		await writeFile(
			path.join(vault, "Del.md"),
			[
				"---",
				"task: true",
				"description: File Task",
				"keepKey: hello",
				"---",
				"- [ ] Parent to delete [id:: pdel]",
				"    - [ ] Child 1",
				"    - plain note under parent",
				"- [ ] Survivor task [id:: keep-me]",
			].join("\n"),
			"utf8",
		);

		// Dry-run does not modify file
		const dryRes = await runScript("delete.mjs", ["--vault", vault, "--id", "pdel", "--dry-run", "--json"]);
		assert.equal(dryRes.code, 0, dryRes.stderr);
		const dryJson = JSON.parse(dryRes.stdout).deleted;
		assert.equal(dryJson.dryRun, true);
		assert.deepEqual(dryJson.deletedLineNumbers, [5, 6, 7]);
		assert.match(await readFile(path.join(vault, "Del.md"), "utf8"), /Parent to delete/);

		// Real delete removes parent + child + nested plain note, keeps Survivor task
		const realRes = await runScript("delete.mjs", ["--vault", vault, "--id", "pdel", "--json"]);
		assert.equal(realRes.code, 0, realRes.stderr);
		const afterLineDel = await readFile(path.join(vault, "Del.md"), "utf8");
		assert.doesNotMatch(afterLineDel, /Parent to delete/);
		assert.doesNotMatch(afterLineDel, /Child 1/);
		assert.doesNotMatch(afterLineDel, /plain note under parent/);
		assert.match(afterLineDel, /Survivor task/);

		// Delete frontmatter task (--line -1) removes task: true while keeping keepKey & body
		const fmDelRes = await runScript("delete.mjs", [
			"--vault", vault,
			"--path", "Del.md",
			"--line", "-1",
			"--json",
		]);
		assert.equal(fmDelRes.code, 0, fmDelRes.stderr);
		const afterFmDel = await readFile(path.join(vault, "Del.md"), "utf8");
		assert.doesNotMatch(afterFmDel, /^task:/m);
		assert.match(afterFmDel, /keepKey: hello/);
		assert.match(afterFmDel, /Survivor task/);

		// Reject path traversal
		const travRes = await runScript("create.mjs", [
			"--vault", vault,
			"--path", "../escape.md",
			"--desc", "Should fail",
			"--json",
		]);
		assert.notEqual(travRes.code, 0);
		assert.match(travRes.stderr, /traversal/i);
	});
});
