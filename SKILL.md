---
name: tasklite
description: Manage Obsidian TaskLite tasks offline via zero-dependency Markdown and frontmatter scripts. Use when listing, querying (DQL), inspecting, creating, editing, updating status, completing recurring/blocked tasks, deleting tasks, or generating semantic task IDs in an Obsidian vault.
---

# TaskLite Offline CLI

Run with `node` or `bun`. Vault path resolves from `--vault <dir>`, `$TASKLITE_VAULT`, or the nearest ancestor containing `.obsidian`. Pass `--json` for structured output and `--help` on any script for full options.

| Script | Purpose | Key Flags |
| --- | --- | --- |
| `scripts/list.mjs` | List / filter tasks | `--query "<DQL>" --all --completed --cancelled --root-only --frontmatter-only --path --sort --limit` |
| `scripts/get.mjs` | Inspect one task + subtree & blockers | `--id <id>` or `--path <file> --line <n>` (`-1` = frontmatter) |
| `scripts/create.mjs` | Create root, subtask, or file task | `--desc <text> [--path <file>] [--parent-line <n> \| --parent-id <id> \| --file-task] [--auto-id]` |
| `scripts/edit.mjs` | Patch task fields or clear fields | `--id \| (--path --line)` + field flags / `--clear-<field>` |
| `scripts/status.mjs` | Update status (cascade, recurrence, unblock) | `--id \| (--path --line)` `--to <done\|todo\|in-progress\|cancelled\|toggle>` `[--force]` |
| `scripts/delete.mjs` | Delete task subtree or frontmatter `task` | `--id \| (--path --line)` `[--dry-run]` |
| `scripts/meta.mjs` | Assignees, semantic IDs, vault config | `assignees` \| `gen-id --desc <text>` \| `info` |

## Rules

- Always use these scripts instead of manually editing TaskLite Markdown/frontmatter syntax.
- Line numbers are `0`-based from start of file (`-1` targets file-level `task: true` frontmatter).
- Confirm with the user before running `delete.mjs` without `--dry-run`.
