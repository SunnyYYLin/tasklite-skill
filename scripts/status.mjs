import { runCli } from "./lib/cli.mjs";
import { updateTaskStatus } from "./lib/mutations.mjs";
import { loadVaultContext } from "./lib/store.mjs";
import { resolveVaultRoot } from "./lib/vault.mjs";

const HELP = `Usage: status.mjs (--id <taskId> | --path <file> --line <n>) --to <status> [options]

Update task status with full TaskLite cascade, parent/frontmatter propagation,
done/cancelled date stamping, recurrence occurrence creation, and dependency unblocking.

Target Status (--to or shortcut flag or positional):
  todo | " " | open       Set to TODO
  done | x | complete     Set to DONE (blocked if unfinished dependsOn unless --force)
  in-progress | / | doing Set to IN_PROGRESS
  cancelled | - | cancel  Set to CANCELLED
  toggle                  Toggle TODO/IN_PROGRESS -> DONE, DONE/CANCELLED -> TODO

Options:
  --vault <dir>         Obsidian vault root (auto-detected if omitted)
  --id <taskId>         Task ID
  --path <file>         Vault-relative or inside-vault path
  --line <n>            0-based line number (-1 for file-level frontmatter task)
  --to <status>         Target status name or symbol
  --done / --todo / --doing / --cancel / --toggle   Shortcut target flags
  --force               Allow completing even if dependsOn blockers are unfinished
  --today <YYYY-MM-DD>  Override current local date
  --json                Output JSON
  -h, --help            Show help`;

runCli(
	HELP,
	{
		booleans: ["done", "todo", "doing", "in-progress", "cancel", "cancelled", "toggle", "force"],
	},
	async ({ flags, positionals }) => {
		const vaultRoot = resolveVaultRoot(flags.vault);
		const ctx = await loadVaultContext(vaultRoot);

		let targetStatus = flags.to ?? positionals[0];
		if (!targetStatus) {
			if (flags.done) targetStatus = "done";
			else if (flags.todo) targetStatus = "todo";
			else if (flags.doing || flags["in-progress"]) targetStatus = "in-progress";
			else if (flags.cancel || flags.cancelled) targetStatus = "cancelled";
			else if (flags.toggle) targetStatus = "toggle";
		}
		if (!targetStatus) {
			throw new Error("Specify target status with --to <done|todo|in-progress|cancelled|toggle> or --done/--todo/--doing/--cancel/--toggle.");
		}

		const result = await updateTaskStatus(
			ctx,
			{
				id: flags.id,
				path: flags.path,
				line: flags.line !== undefined ? Number(flags.line) : undefined,
			},
			targetStatus,
			{ force: Boolean(flags.force) },
		);

		if (flags.json) {
			console.log(JSON.stringify({ ok: true, vault: vaultRoot, result }, null, 2));
			return;
		}

		console.log(`Updated ${result.path}:${result.lineNumber}: ${result.previousStatus} -> ${result.status} ([${result.statusSymbol}])`);
		if (result.recurrenceCreated?.length) {
			console.log(`Created next recurring occurrence:\n${result.recurrenceCreated.join("\n")}`);
		}
		if (result.unblocked?.length) {
			console.log(`Unblocked ${result.unblocked.length} dependent task(s):`);
			for (const u of result.unblocked) {
				console.log(`  - ${u.path}:${u.lineNumber} ${u.description} (cleared: ${u.removedDependencies.join(", ")})`);
			}
		}
		if (result.warning) {
			console.warn(`Warning: ${result.warning}`);
		}
	},
);
