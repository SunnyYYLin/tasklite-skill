import { runCli } from "./lib/cli.mjs";
import { deleteTask } from "./lib/mutations.mjs";
import { loadVaultContext } from "./lib/store.mjs";
import { resolveVaultRoot } from "./lib/vault.mjs";

const HELP = `Usage: delete.mjs (--id <taskId> | --path <file> --line <n>) [options]

Delete a task line and its entire subtree, or strip the 'task' key from a
file-level frontmatter task (--line -1).

Options:
  --vault <dir>    Obsidian vault root (auto-detected if omitted)
  --id <taskId>    Task ID
  --path <file>    Target file path
  --line <n>       0-based line number (-1 for file-level frontmatter task)
  --dry-run        Preview deletion without modifying files
  --json           Output JSON
  -h, --help       Show help`;

runCli(HELP, { booleans: ["dry-run"] }, async ({ flags }) => {
	const vaultRoot = resolveVaultRoot(flags.vault);
	const ctx = await loadVaultContext(vaultRoot);
	const result = await deleteTask(
		ctx,
		{
			id: flags.id,
			path: flags.path,
			line: flags.line !== undefined ? Number(flags.line) : undefined,
		},
		{ dryRun: Boolean(flags["dry-run"]) },
	);

	if (flags.json) {
		console.log(JSON.stringify({ ok: true, vault: vaultRoot, deleted: result }, null, 2));
		return;
	}

	const prefix = result.dryRun ? "[dry-run] Would delete" : "Deleted";
	if (result.action === "remove-frontmatter-task") {
		console.log(`${prefix} frontmatter 'task' flag from ${result.path}.`);
	} else {
		console.log(`${prefix} ${result.deletedLines.length} line(s) from ${result.path}:`);
		for (const ln of result.deletedLineNumbers) {
			const idx = result.deletedLineNumbers.indexOf(ln);
			console.log(`  ${ln}: ${result.deletedLines[idx]}`);
		}
	}
});
