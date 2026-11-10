# tasklite-skill

Zero-dependency, offline-first Node.js / Bun CLI scripts and Agent Skill for [Obsidian TaskLite](https://github.com/SunnyYYLin/obsidian-tasklite) vaults.

Works directly against Markdown notes and YAML frontmatter on disk without requiring Obsidian to be running.

## Install

Using [`skills`](https://www.npmjs.com/package/skills) inside your Obsidian vault:

```bash
npx skills add SunnyYYLin/tasklite-skill --agent antigravity --yes
```

## Requirements

- **Node.js** `>= 20` or **Bun** `>= 1.0`
- Zero external npm dependencies

## Scripts

Run any script with `node` or `bun`, passing `--help` for complete options and `--json` for machine-readable output:

| Script | Description |
| --- | --- |
| `scripts/list.mjs` | Query and filter tasks with TaskLite DQL, path filters, and sorting |
| `scripts/get.mjs` | Inspect a task (`--id` or `--path --line`) with ancestors, children, and blockers |
| `scripts/create.mjs` | Create root tasks, nested subtasks, or `task: true` frontmatter tasks |
| `scripts/edit.mjs` | Atomically update or clear metadata and date fields |
| `scripts/status.mjs` | Change task status with cascade, parent propagation, recurrence, and auto-unblock |
| `scripts/delete.mjs` | Delete a task subtree (or remove `task` frontmatter property for line `-1`) |
| `scripts/meta.mjs` | List vault assignees, generate semantic IDs (`gen-id`), or inspect vault config (`info`) |

## Vault & Compatibility

- **Vault discovery**: `--vault <dir>`, `$TASKLITE_VAULT`, or nearest ancestor directory containing `.obsidian`.
- **Vault settings**: Reads `.obsidian/app.json` (`useTab`, `tabSize`) and `.obsidian/plugins/taskslite/data.json` (`preferredTaskFormat`, `setDoneDate`, `setCancelledDate`, `copySubtasksOnRecurrence`, `toggleBehavior`, `assignees`, `defaultAssignee`).
- **Task formats**: Parses both Dataview inline fields (`[due:: 2026-11-10]`) and Emoji fields (`📅 2026-11-10`), plus file-level frontmatter tasks (`task: true`, line `-1`).
- **Line numbering**: Uses 0-based line numbers for body tasks (`-1` for frontmatter tasks) and preserves CRLF/LF line endings.

## Testing

```bash
node --test tests/*.test.mjs
# or
bun test
```
