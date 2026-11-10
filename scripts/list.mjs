import { formatRecordLine, runCli } from "./lib/cli.mjs";
import { parseCanonicalDateTime } from "./lib/dates.mjs";
import { detectQueryStatusHints } from "./lib/query.mjs";
import { listVaultTasks, loadVaultContext } from "./lib/store.mjs";
import { resolveVaultRoot } from "./lib/vault.mjs";

const HELP = `Usage: list.mjs [options]

List and filter TaskLite tasks in an Obsidian vault.

Options:
  --vault <dir>         Obsidian vault root (auto-detected if omitted)
  --query <dql>         TaskLite DQL query (e.g. 'is(open) AND due <= date(today)')
  --id <taskId>         Filter by exact task ID (includes completed/cancelled unless --open-only)
  --path <prefix>       Limit to files matching vault-relative path prefix
  --completed           Include DONE tasks
  --cancelled           Include CANCELLED tasks
  --all                 Include DONE and CANCELLED tasks
  --open-only           Exclude DONE and CANCELLED even if --query or --id is set
  --root-only           Exclude subtasks (default includes subtasks)
  --frontmatter-only    Only list file-level (task: true) tasks
  --sort <field>        Sort by: due | scheduled | priority | path (default: vault order)
  --limit <n>           Limit number of returned tasks
  --today <YYYY-MM-DD>  Override current local date for DQL date evaluation
  --json                Output JSON
  -h, --help            Show help`;

const PRIORITY_SCORE = { highest: 5, high: 4, medium: 3, low: 2, lowest: 1 };

function sortRecords(records, sortKey) {
	const copy = [...records];
	if (!sortKey) return copy;
	const key = String(sortKey).toLowerCase().trim();
	const dateCmp = (a, b) => {
		if (!a && !b) return 0;
		if (!a) return 1;
		if (!b) return -1;
		const aFull = parseCanonicalDateTime(a)?.full ?? a;
		const bFull = parseCanonicalDateTime(b)?.full ?? b;
		return aFull.localeCompare(bFull);
	};
	copy.sort((a, b) => {
		if (key === "due") return dateCmp(a.task.dates.due, b.task.dates.due);
		if (key === "scheduled") return dateCmp(a.task.dates.scheduled, b.task.dates.scheduled);
		if (key === "priority") {
			return (PRIORITY_SCORE[b.task.priority] ?? 0) - (PRIORITY_SCORE[a.task.priority] ?? 0);
		}
		if (key === "path") {
			return a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber;
		}
		throw new Error(`Unsupported --sort "${sortKey}". Use: due, scheduled, priority, path.`);
	});
	return copy;
}

runCli(
	HELP,
	{
		booleans: ["completed", "cancelled", "all", "open-only", "root-only", "frontmatter-only"],
	},
	async ({ flags }) => {
		const vaultRoot = resolveVaultRoot(flags.vault);
		const ctx = await loadVaultContext(vaultRoot);
		const targetId = flags.id !== undefined ? String(flags.id).trim() : null;
		const query = flags.query;
		const hints = flags["open-only"] ? { mentionsDone: false, mentionsCancelled: false } : detectQueryStatusHints(query);

		const includeCompleted = Boolean(!flags["open-only"] && (flags.all || flags.completed || targetId || hints.mentionsDone));
		const includeCancelled = Boolean(!flags["open-only"] && (flags.all || flags.cancelled || targetId || hints.mentionsCancelled));
		const includeChildren = !flags["root-only"];

		let records = await listVaultTasks(ctx, {
			includeCompleted,
			includeCancelled,
			includeChildren,
			frontmatterOnly: Boolean(flags["frontmatter-only"]),
			pathPrefix: flags.path,
			query,
		});

		if (targetId) {
			records = records.filter((r) => r.task.id === targetId);
		}

		if (flags.sort) {
			records = sortRecords(records, flags.sort);
		}
		const total = records.length;
		if (flags.limit !== undefined) {
			const limit = Number.parseInt(flags.limit, 10);
			if (!Number.isInteger(limit) || limit < 0) {
				throw new Error(`Invalid --limit "${flags.limit}".`);
			}
			records = records.slice(0, limit);
		}

		if (flags.json) {
			console.log(JSON.stringify({ ok: true, vault: vaultRoot, count: records.length, total, tasks: records }, null, 2));
			return;
		}

		if (records.length === 0) {
			console.log("No matching tasks found.");
			return;
		}
		for (const rec of records) {
			console.log(formatRecordLine(rec));
		}
		if (total > records.length) {
			console.log(`... (${records.length} of ${total} shown)`);
		}
	},
);
