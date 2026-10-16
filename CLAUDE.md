# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# claude-mod-todo

A Claude Code mod (a plugin of function hooks): a session-scoped todo list file, a bar below
the prompt showing its progress, a `/todo` command and overlay to manage it, and context that
keeps the model maintaining it. README.md covers layout and usage; this file records
constraints that aren't visible in the code.

## Contracts

- **List file format.** One item per line, `- [ ]` open or `- [x]` done, anchored at column 0;
  other lines are kept and ignored. `hooks/list.ts` parses and edits it, and the system prompt
  section in `hooks/register.tsx` describes it to the model. The format is shared with other
  tools, so don't extend it.
- **List file location.** `~/.claude/todos/<session_id>.md`, built by `todoDir`/`todoPath` in
  `register.tsx`. The session id comes from `$.session.id()`.
- **State keys** live under the plugin name `mod-todo` and are declared in
  `types/index.d.ts`; `claude plugin validate` holds the module's keys to that contract.
  Renaming the plugin means renaming every key.

## Why the design is shaped this way

- The file is the single source of truth and the UI is purely reactive: every writer (the
  model's tools, commands, overlay buttons, other programs) writes the file, and only the
  watcher reads it into the `list` state that the bar and overlay draw from. The mod API has
  no file watcher, so it polls mtime and size every second; the mod's own writes trigger an
  immediate read.
- The dirty check compares the file against `seen`, the text the model last saw: its own
  Read/Edit/Write of the file (observed at `tool.call`) or an injected reminder. On a mismatch
  at `prompt.submit` the list rides along as hidden context.
- Edits from the overlay address an item by line but only apply while that line still holds
  the item as parsed, so a stale click can't land on whatever moved into its place.
- `/todo next` submits its prompt from a zero-delay timer: `$.prompt.submit` called inside a
  `command.run` hook is refused, since it would wait on the turn the command holds. The
  visible prompt is one short line; the instructions (and the list, if changed) go in first
  as a hidden `$.session.append` row, because a plugin's own `prompt.submit` hooks don't see
  the prompts it submits and so can't attach context to them.

## Development

- The dev shell (`.envrc` → `.nix/flake.nix`, via direnv or `nix develop ./.nix`) provides
  only `claude-code`.
- Run `claude --plugin-dir .`; the session hot-reloads the module when a file changes. The
  working copy appears to shadow an enabled marketplace install of the same plugin (only one
  copy's hooks fire).
- `claude plugin validate .` reports what the module hooks and anything the engine would
  refuse. `claude plugin test .` runs `tests/*.test.ts`; the kit has no file system, so tests
  fake `fs`, `env` and `session.id` with hooks registered beneath the plugin.
- Type-check with `tsc -p .` (TypeScript isn't in the dev shell: `nix shell nixpkgs#typescript`).
  The root `tsconfig.json` extends the one the engine lays in `.claude-plugin/types/` whenever
  it loads the mod from this folder, so that directory exists only after a load.
- Neither `.claude-plugin/plugin.json` nor the marketplace entry carries a version, so
  installs update by commit. Don't add one.
