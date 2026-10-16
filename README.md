# claude-mod-todo

A Claude Code mod that restores a user-facing todo list on models where the built-in
todo tools are disabled. The list is a session-scoped markdown checklist that the model
maintains as it works. A bar below the prompt shows progress and the first three open
items:

```
󰄵 1/5 ▰▱▱▱▱
❯ Audit shipping option fallbacks for EU destinations
∘ Deduplicate gallery image resize logic
∘ Add index on orders.fulfilled_at
```

`/todo` opens an overlay with the whole list: the arrows move between items, Enter checks
or unchecks the highlighted one, `e` edits its text, `d` deletes it, and a field at the bottom
adds new ones.

Lists live in `~/.claude/todos/<session_id>.md`, keyed by session and stable across
`--resume`. The file is the source of truth: the model, the commands, the overlay and any
other program may write it, and the bar and overlay follow within a second. When the list
changes other than by the model's own edits, its current content goes to the model with
the next prompt. Files untouched for 30 days are pruned at session start.

The overlay's checkboxes and add marker are Nerd Font Material Design icons, so the
terminal font needs to be a Nerd Font.

## Install

```
/plugin install mod-todo --marketplace Alexander-Prime/claude-mod-todo
```

## Commands

- `/todo` — open the overlay to manage the list
- `/todo add <text>` — add an item
- `/todo done` — mark the current (first open) item done
- `/todo next` — mark the current item done and start a turn on the next one

## Layout

- `hooks/register.tsx` — the hooks module: watcher, commands, bar, overlay, model context
- `hooks/list.ts` — parsing and editing the list file format
- `types/index.d.ts` — the mod's session state contract
- `tests/` — `claude plugin test .`
