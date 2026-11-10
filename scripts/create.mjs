import { parseAssigneeFlagValues, runCli } from "./lib/cli.mjs";
import { createTask } from "./lib/mutations.mjs";
import { loadVaultContext } from "./lib/store.mjs";
import { resolveVaultRoot } from "./lib/vault.mjs";

const HELP = `Usage: create.mjs --desc <text> [options]

Create a new line task, subtask, or frontmatter file-level task.

Options:
  --vault <dir>             Obsidian vault root (auto-detected if omitted)
  --desc <text>             Task description (or pass as positional argument)
  --path <file>             Target Markdown file (default: Tasks/New_Tasks.md)
  --parent-line <n>         Nest as subtask under parent 0-based line number
  --parent-id <id>          Nest as subtask under parent task ID
  --file-task               Create/convert file-level frontmatter task (task: true)
  --status <sym|kw>         todo (" "), done ("x"), in-progress ("/"), cancelled ("-")
  --priority <lvl|emoji>    highest|high|medium|low|lowest or 🔺⏫🔼🔽⏬
  --start <date>            Start date (YYYY-MM-DD or shorthand like today/tomorrow)
  --scheduled <date>        Scheduled date (supports YYYY-MM-DD HH:mm)
  --due <date>              Due date (supports time-only HH:mm if --start is set)
  --remind <date>           Remind date/time
  --created <date>          Created date
  --recurrence <rule>       Recurrence rule (e.g. "every day when done")
  --on-completion <act>     delete | keep
  --id <taskId>             Explicit task ID
  --auto-id                 Generate semantic ID automatically
  --depends-on <ids>        Comma-separated blocker IDs
  --assignee <name>         Repeatable or '&'-separated assignee names
  --location <text>         Task location (📍 / [location:: ...])
  --tag <tag>               Repeatable tag (e.g. work or #work)
  --today <YYYY-MM-DD>      Override current local date
  --json                    Output JSON
  -h, --help                Show help`;

runCli(
	HELP,
	{
		booleans: ["file-task", "auto-id"],
		repeatables: ["assignee", "tag"],
	},
	async ({ flags, positionals }) => {
		const vaultRoot = resolveVaultRoot(flags.vault);
		const ctx = await loadVaultContext(vaultRoot);
		const description = flags.desc ?? (positionals.length > 0 ? positionals.join(" ") : "");

		const parentLineNumber = flags["parent-line"] !== undefined ? Number(flags["parent-line"]) : undefined;
		if (parentLineNumber !== undefined && (!Number.isInteger(parentLineNumber) || parentLineNumber < 0)) {
			throw new RangeError(`Invalid --parent-line "${flags["parent-line"]}". Expected integer >= 0.`);
		}

		const result = await createTask(ctx, {
			description,
			path: flags.path,
			parentLineNumber,
			parentId: flags["parent-id"],
			isFileTask: Boolean(flags["file-task"]),
			status: flags.status,
			priority: flags.priority,
			dates: {
				start: flags.start,
				scheduled: flags.scheduled,
				due: flags.due,
				remind: flags.remind,
				created: flags.created,
			},
			recurrence: flags.recurrence,
			onCompletion: flags["on-completion"],
			id: flags.id,
			autoId: Boolean(flags["auto-id"]),
			dependsOn: flags["depends-on"],
			assignee: parseAssigneeFlagValues(flags.assignee),
			location: flags.location,
			tags: flags.tag,
		});

		if (flags.json) {
			console.log(JSON.stringify({ ok: true, vault: vaultRoot, created: result }, null, 2));
			return;
		}
		if (result.isFileTask) {
			console.log(`Created frontmatter task in ${result.path} (${result.description})`);
		} else {
			console.log(`Created task at ${result.path}:${result.lineNumber}: ${result.line}`);
		}
	},
);
