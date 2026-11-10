import { runCli } from "./lib/cli.mjs";
import { todayString } from "./lib/dates.mjs";
import { generateSemanticId } from "./lib/semantic-id.mjs";
import { findAllExistingIds, listVaultTasks, loadVaultContext } from "./lib/store.mjs";
import { resolveVaultRoot } from "./lib/vault.mjs";

const HELP = `Usage: meta.mjs <subcommand> [options]

TaskLite vault metadata, semantic ID generator, and configuration inspection.

Subcommands:
  assignees          List unique assignees (default + vault tasks) and defaultAssignee
  gen-id             Generate a semantic task ID from --desc
  info               Show resolved vault root, indent config, and TaskLite settings

Options:
  --vault <dir>      Obsidian vault root (auto-detected if omitted)
  --desc <text>      (gen-id) Description text to derive ID from
  --recurring        (gen-id) Append date suffix for recurring tasks
  --due <YYYY-MM-DD> (gen-id) Explicit due date suffix when --recurring is set
  --check-vault      (gen-id) Check existing vault IDs to avoid collisions (default: true when vault detected)
  --no-check-vault   (gen-id) Generate ID offline without reading a vault
  --today <YYYY-MM-DD> Override current local date
  --json             Output JSON
  -h, --help         Show help`;

runCli(
	HELP,
	{ booleans: ["recurring", "check-vault", "no-check-vault"] },
	async ({ flags, positionals }) => {
		const sub = (positionals[0] || "info").toLowerCase();

		if (sub === "info") {
			const vaultRoot = resolveVaultRoot(flags.vault);
			const ctx = await loadVaultContext(vaultRoot);
			const payload = {
				vault: vaultRoot,
				today: todayString(),
				indentConfig: ctx.indentConfig,
				settings: ctx.settings,
			};
			if (flags.json) {
				console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
				return;
			}
			console.log(`Vault: ${vaultRoot}`);
			console.log(`Today: ${payload.today}`);
			console.log(`Indent: ${ctx.indentConfig.useTab ? "tab" : `${ctx.indentConfig.tabSize} spaces`}`);
			console.log(`Preferred format: ${ctx.settings.preferredTaskFormat}`);
			console.log(`Default assignee: ${ctx.settings.defaultAssignee || "(none)"}`);
			return;
		}

		if (sub === "assignees") {
			const vaultRoot = resolveVaultRoot(flags.vault);
			const ctx = await loadVaultContext(vaultRoot);
			const records = await listVaultTasks(ctx, {
				includeCompleted: true,
				includeCancelled: true,
				includeChildren: true,
			});
			const defaultIdentity = ctx.settings.defaultAssignee?.trim() || "";
			const set = new Set(ctx.settings.assignees || []);
			if (defaultIdentity) set.add(defaultIdentity);
			for (const r of records) {
				for (const a of r.task.assignee || []) {
					if (a.trim()) set.add(a.trim());
				}
			}
			const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
			const assignees = defaultIdentity && sorted.includes(defaultIdentity)
				? [defaultIdentity, ...sorted.filter((x) => x !== defaultIdentity)]
				: sorted;

			if (flags.json) {
				console.log(JSON.stringify({ ok: true, vault: vaultRoot, defaultAssignee: defaultIdentity, assignees }, null, 2));
				return;
			}
			console.log(`Default assignee: ${defaultIdentity || "(none)"}`);
			console.log(`Assignees (${assignees.length}): ${assignees.join(", ") || "(none)"}`);
			return;
		}

		if (sub === "gen-id") {
			const desc = flags.desc ?? positionals.slice(1).join(" ");
			let existingIds;
			if (!flags["no-check-vault"]) {
				try {
					const vaultRoot = resolveVaultRoot(flags.vault);
					const ctx = await loadVaultContext(vaultRoot);
					existingIds = await findAllExistingIds(ctx);
				} catch (err) {
					if (flags.vault || flags["check-vault"]) throw err;
				}
			}
			const id = generateSemanticId(desc, {
				isRecurring: Boolean(flags.recurring),
				dueDate: flags.due ?? null,
				existingIds,
			});
			if (flags.json) {
				console.log(JSON.stringify({ ok: true, id }, null, 2));
				return;
			}
			console.log(id);
			return;
		}

		throw new Error(`Unknown subcommand "${sub}". Expected: info | assignees | gen-id.`);
	},
);
