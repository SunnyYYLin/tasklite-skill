---
name: tasklite
description: Manage Obsidian TaskLite tasks offline via zero-dependency Markdown and frontmatter scripts. Use when listing, querying (DQL), creating, updating task status (including recurring/blocked/frontmatter tasks), or deleting tasks in an Obsidian vault.
---

# TaskLite Offline CLI

Run with `node` or `bun`. Vault path resolves from `--vault <dir>`, `$TASKLITE_VAULT`, or nearest `.obsidian` ancestor. Pass `--json` for structured output and `--help` for full flags.

| Script | Purpose | Key Flags |
| --- | --- | --- |
| `scripts/list.mjs` | List / filter tasks (DQL or ID) | `--query "<DQL>" --id <id> --all --completed --cancelled --root-only --frontmatter-only --path --sort --limit` |
| `scripts/create.mjs` | Create root, subtask, or file task | `--desc <text> [--path <file>] [--parent-line <n> \| --parent-id <id> \| --file-task] [--auto-id]` |
| `scripts/status.mjs` | Update status (cascade, recurrence, unblock) | `--id \| (--path --line)` `--to <done\|todo\|in-progress\|cancelled\|toggle>` `[--force]` |
| `scripts/delete.mjs` | Delete task subtree or frontmatter `task` | `--id \| (--path --line)` `[--dry-run]` |

## Rules

- Always use `list.mjs` / `create.mjs` / `status.mjs` instead of guessing DQL, status side effects, or TaskLite syntax.
- Line numbers are `0`-based (`-1` targets file-level `task: true` frontmatter).
- Confirm with the user before running `delete.mjs` without `--dry-run`.
