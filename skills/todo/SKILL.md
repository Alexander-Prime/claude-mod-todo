---
name: todo
description: "Manage the session's todo list. /todo prints it, /todo <desc> adds an item, /todo done <desc|index> completes one, /todo next starts the next open item, /todo clear deletes the list, /todo init configures the progress display."
arguments: "[done <desc|index> | next | clear | init | <desc>]"
allowed-tools: Edit(~/.claude/todos/**)
---

# Session todo list

The session's todo file path is given by the `<session-todo-file>` line injected into context
on every user prompt. Always use that exact path; never guess or search for it. The file is a
markdown checklist: one `- [ ]` (open) or `- [x]` (done) line per item.

Interpret the arguments:

- **Empty**: print the current list verbatim. If the file is missing or has no items, say the
  list is empty.
- **`clear`**: delete the file. Confirm the list is cleared.
- **`done <desc or index>`**: find the open item it refers to — an integer is a 1-based
  position in the list; text matches loosely by meaning (e.g. `done refactoring` completes
  `- [ ] Refactor parser`). Flip that line's `- [ ]` to `- [x]` with Edit. If nothing matches
  or several items match equally well, ask instead of guessing.
- **`next`**: wrap up the current task and start the next one:
  1. Confirm nothing is left hanging from the task in progress: verification actually ran,
     and the working copy holds no changes the user isn't already aware of. Leftover
     changes are fine when they're expected (e.g. the user handles version control
     themselves) — when it's unclear whether they are, ask.
  2. If the work just finished corresponds to an open item, mark it `- [x]`.
  3. Take the first open item and compare what it asks for against the current state of
     the project — read the relevant code before assuming the task is still needed or
     still shaped the way the item describes.
  4. If the item's scope or approach is ambiguous, clarify with the AskUserQuestion tool
     before writing anything.
  5. Begin the work.
- **`init`**: configure the user's statusline to render todo progress. Follow the
  "Statusline setup" section below.
- **Anything else**: treat the whole argument string as one new item and append
  `- [ ] <text>` to the file, creating the file (and its directory) if needed.

After any mutation, print the resulting list.

Between invocations, maintain the list yourself as you work, editing the file directly: add
items when taking on new multi-step work, and keep item text accurate as scope changes.

Mark an item `- [x]` only when the user asks for it, or when moving on to a new item with
nothing outstanding on the current one. Having finished the work is not itself a reason —
report what's done and leave the item open.

## Statusline setup

1. Read `~/.claude/settings.json`. If it already contains a `statusLine` entry that is not
   this plugin's, show it to the user and ask before replacing it.
2. Set `statusLine` to:

   ```json
   {
     "type": "command",
     "command": "exec \"$(ls -t ~/.claude/plugins/cache/*/todo-statusline/*/scripts/statusline.sh 2>/dev/null | head -1)\""
   }
   ```

   The glob re-resolves on every render, so the entry survives plugin updates (the current
   version's script is always the newest match). Before writing, confirm the glob matches
   this skill's own base directory — for a non-marketplace install such as `--plugin-dir`,
   the cache path won't exist; point the command at `<base directory>/../../scripts/statusline.sh`
   resolved to an absolute path instead, and tell the user the entry is pinned to that
   location.
