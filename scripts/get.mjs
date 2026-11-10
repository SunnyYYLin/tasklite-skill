import { formatRecordLine, runCli } from "./lib/cli.mjs";
import { inspectTaskDetails, loadVaultContext } from "./lib/store.mjs";
import { resolveVaultRoot } from "./lib/vault.mjs";

const HELP = `Usage: get.mjs (--id <taskId> | --path <file> --line <n>) [options]

Inspect one task along with its ancestor chain, child subtree, and dependency blockers.

Options:
  --vault <dir>    Obsidian vault root (auto-detected if omitted)
  --id <taskId>    Task ID (🆔 / [id:: ...])
  --path <file>    Vault-relative or inside-vault path
  --line <n>       0-based line number (-1 for file-level frontmatter task)
  --json           Output JSON
  -h, --help       Show help`;

runCli(HELP, {}, async ({ flags }) => {
	const vaultRoot = resolveVaultRoot(flags.vault);
	const ctx = await loadVaultContext(vaultRoot);
	const line = flags.line !== undefined ? Number(flags.line) : undefined;
	const details = await inspectTaskDetails(ctx, {
		id: flags.id,
		path: flags.path,
		line,
	});

	if (flags.json) {
		console.log(JSON.stringify({ ok: true, vault: vaultRoot, ...details }, null, 2));
		return;
	}

	console.log(`Task: ${formatRecordLine(details.task)}`);
	if (details.ancestors.length > 0) {
		console.log("Ancestors:");
		for (const anc of details.ancestors) {
			console.log(`  ^ ${formatRecordLine(anc)}`);
		}
	}
	if (details.children.length > 0) {
		console.log(`Children (${details.children.length}):`);
		for (const child of details.children) {
			console.log(`  ${formatRecordLine(child)}`);
		}
	}
	if (details.dependencies.length > 0) {
		console.log("Dependencies:");
		for (const dep of details.dependencies) {
			const state = dep.found ? `${dep.status}${dep.satisfied ? " (satisfied)" : " (BLOCKING)"}` : "missing (treated satisfied)";
			console.log(`  - ${dep.id}: ${state}${dep.description ? ` — ${dep.description}` : ""}`);
		}
	}
});
