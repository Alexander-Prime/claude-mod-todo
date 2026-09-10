# claude-todo-statusline

A Claude Code plugin that restores a user-facing todo list on models where the built-in
todo tools are disabled. A `/todo` skill manages a session-scoped markdown checklist, a
UserPromptSubmit hook keeps the model maintaining it (debounced by the list file's mtime),
and a statusline script renders progress as a bar plus the first three open items:

```
☑ 1/5 ▰▱▱▱▱ ↗
❯ Audit shipping option fallbacks for EU destinations
∘ Deduplicate gallery image resize logic
∘ Add index on orders.fulfilled_at
```

After the bar, a link icon is an OSC 8 hyperlink to the list file (clickable in terminals
that support it, such as iTerm2, Kitty, and WezTerm). The icon is the Nerd Font Material
Design link glyph (U+F0337); without a Nerd-patched terminal font it renders as a missing
glyph — swap it for `↗` in `scripts/statusline.sh` if so.

Lists live in `~/.claude/todos/<session_id>.md`, keyed by session and stable across
`--resume`. A SessionStart hook prunes files untouched for 30 days.

## Install

Add this repository as a marketplace and install the plugin from it:

```
/plugin marketplace add Alexander-Prime/claude-todo-statusline
/plugin install todo-statusline@claude-todo-statusline
```

Then run `/todo init` to point your `statusLine` setting at the bundled script.

The statusline entry uses a newest-wins glob over the plugin cache, so plugin updates
don't break it. Scripts depend only on `bash` and coreutils.

## Commands

- `/todo` — print the session's list
- `/todo <description>` — add an item
- `/todo done <description or index>` — complete an item (matched by meaning, not exact text)
- `/todo next` — wrap up the current task and start the next open item
- `/todo clear` — delete the session's list
- `/todo init` — configure the statusline display

## Layout

- `skills/todo/SKILL.md` — the `/todo` skill; grants `Edit(~/.claude/todos/**)` during skill turns
- `hooks/hooks.json` — hook registration
- `scripts/todo-hook.sh` — UserPromptSubmit context injection and SessionStart pruning
- `scripts/allow-todo-edits.sh` — PreToolUse hook allowing todo-file edits outside skill turns
- `scripts/statusline.sh` — the statusline renderer

If you previously configured these hooks or the statusline script directly in
`~/.claude/settings.json`, remove that configuration when enabling the plugin, or the
hooks fire twice.
