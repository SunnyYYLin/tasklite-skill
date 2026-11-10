import { formatRecordLine, parseAssigneeFlagValues, runCli } from "./lib/cli.mjs";
import { editTask } from "./lib/mutations.mjs";
import { loadVaultContext } from "./lib/store.mjs";
import { resolveVaultRoot } from "./lib/vault.mjs";

const HELP = `Usage: edit.mjs (--id <taskId> | --path <file> --line <n>) [fields...]

Atomically patch metadata fields of an existing task (status changes use status.mjs).

Options:
  --vault <dir>             Obsidian vault root (auto-detected if omitted)
  --id <taskId>             Target task ID (Note: pass --new-id to change ID when targeting by --id)
  --path <file>             Target file path
  --line <n>                Target 0-based line number (-1 for frontmatter task)
  --desc <text>             Update description
  --priority <lvl|emoji>    Set priority (highest|high|medium|low|lowest|none)
  --start / --scheduled / --due / --remind / --created / --done / --cancelled <date>
  --recurrence <rule>       Set recurrence rule
  --on-completion <act>     delete | keep
  --new-id <id>             Set task ID (or --task-id <id>)
  --depends-on <ids>        Set dependsOn IDs
  --assignee <name>         Set assignees (repeatable or '&'-separated)
  --location <text>         Set location
  --clear-<field>           Clear field: priority, start, scheduled, due, remind, created,
                            done, cancelled, recurrence, on-completion, id, depends-on, assignee, location
  --today <YYYY-MM-DD>      Override current local date
  --json                    Output JSON
  -h, --help                Show help`;

const CLEARABLE_DATE_FIELDS = ["start", "scheduled", "due", "remind", "created", "done", "cancelled"];

runCli(
	HELP,
	{
		booleans: [
			"clear-priority",
			"clear-start",
			"clear-scheduled",
			"clear-due",
			"clear-remind",
			"clear-created",
			"clear-done",
			"clear-cancelled",
			"clear-recurrence",
			"clear-on-completion",
			"clear-id",
			"clear-depends-on",
			"clear-assignee",
			"clear-location",
		],
		repeatables: ["assignee"],
	},
	async ({ flags }) => {
		if (flags.status !== undefined) {
			throw new Error("edit.mjs cannot modify task status. Use scripts/status.mjs instead.");
		}

		const vaultRoot = resolveVaultRoot(flags.vault);
		const ctx = await loadVaultContext(vaultRoot);
		const selector = {
			id: flags.id,
			path: flags.path,
			line: flags.line !== undefined ? Number(flags.line) : undefined,
		};

		const patch = {};
		if (flags.desc !== undefined) patch.description = flags.desc;
		if (flags["clear-priority"]) patch.priority = null;
		else if (flags.priority !== undefined) patch.priority = flags.priority;

		if (flags["clear-recurrence"]) patch.recurrence = null;
		else if (flags.recurrence !== undefined) patch.recurrence = flags.recurrence || null;

		if (flags["clear-on-completion"]) patch.onCompletion = null;
		else if (flags["on-completion"] !== undefined) patch.onCompletion = flags["on-completion"] || null;

		if (flags["clear-id"]) patch.id = null;
		else if (flags["new-id"] !== undefined) patch.id = flags["new-id"] || null;
		else if (flags["task-id"] !== undefined) patch.id = flags["task-id"] || null;

		if (flags["clear-depends-on"]) patch.dependsOn = null;
		else if (flags["depends-on"] !== undefined) patch.dependsOn = flags["depends-on"] || null;

		if (flags["clear-assignee"]) patch.assignee = [];
		else if (flags.assignee !== undefined) patch.assignee = parseAssigneeFlagValues(flags.assignee) ?? [];

		if (flags["clear-location"]) patch.location = null;
		else if (flags.location !== undefined) patch.location = flags.location || null;

		const dates = {};
		let hasDateUpdates = false;
		for (const field of CLEARABLE_DATE_FIELDS) {
			if (flags[`clear-${field}`]) {
				dates[field] = null;
				hasDateUpdates = true;
			} else if (flags[field] !== undefined) {
				dates[field] = flags[field] === "" ? null : flags[field];
				hasDateUpdates = true;
			}
		}
		if (hasDateUpdates) patch.dates = dates;

		if (Object.keys(patch).length === 0) {
			throw new Error("No fields to update. Pass at least one field or --clear-* flag.");
		}

		const result = await editTask(ctx, selector, patch);
		if (flags.json) {
			console.log(JSON.stringify({ ok: true, vault: vaultRoot, updated: result }, null, 2));
			return;
		}
		console.log(`Updated ${formatRecordLine({ path: result.path, lineNumber: result.lineNumber, depth: 0, task: result.task })}`);
	},
);
