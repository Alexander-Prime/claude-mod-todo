# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# claude-todo-statusline

A Claude Code plugin: session-scoped todo list (`/todo` skill), hooks that keep the model
maintaining it, and a statusline renderer. README.md covers layout and usage; this file
records constraints that aren't visible in the code.

## Contracts shared across files

There is no build step and no library code; the pieces only agree by convention, so a change
to any of these has to land in every file listed.

- **List file format.** One item per line, `- [ ]` open or `- [x]` done, anchored at column 0.
  `scripts/statusline.sh` counts and lists items with those exact grep patterns,
  `scripts/todo-hook.sh` tells the model to write them in its injected instruction, and
  `skills/todo/SKILL.md` describes them to the skill. Anything else in the file is ignored by
  the renderer.
- **List file location.** `~/.claude/todos/<session_id>.md`. Hardcoded in all three scripts
  (`TODO_DIR` in two, the `case` pattern in `allow-todo-edits.sh`) and in the skill's
  `allowed-tools` glob in `SKILL.md`.
- **The `<session-todo-file>` tag.** `todo-hook.sh` prints it on every UserPromptSubmit; the
  skill is told to use that exact path and never search for it. Renaming the tag breaks the
  skill.
- **Plugin name in the statusline glob.** The `statusLine` command the skill writes globs
  `~/.claude/plugins/cache/*/todo-statusline/*/scripts/statusline.sh`. The middle segment is
  the plugin `name` from `.claude-plugin/plugin.json`; renaming the plugin or moving the
  script breaks every user's already-written setting.
- **Two permission layers, both needed.** The skill's `allowed-tools: Edit(~/.claude/todos/**)`
  only covers turns where `/todo` was invoked. The PreToolUse hook (`allow-todo-edits.sh`)
  covers the mid-task edits the UserPromptSubmit reminder asks for, which happen outside any
  skill turn.

## Why the design is shaped this way

- Plugins cannot ship a `statusLine` setting (a plugin `settings.json` honors only `agent`
  and `subagentStatusLine`). That's why `/todo init` exists: it writes the user's own
  settings. The entry it writes globs the plugin cache
  (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`) newest-first, because
  version directories change on every plugin update and the command string re-executes on
  every render, so the glob re-resolves while a hardcoded path would rot.
- The list-injection debounce keys off the todo file's own mtime: real edits and reminder
  injections (which `touch` the file) both mean "the model has this list in recent context",
  so neither is followed by a redundant re-injection. The 30-day prune keys off the same
  mtime.

## Statusline renderer facts (established by experiment, not documented)

- The statusline row is reserved once configured; empty output or a failing script renders
  a blank row, not no row. A bare cursor-up escape (`ESC[1A`, no newline) removes the row
  entirely. If a Claude Code update breaks this, fall back to printing a placeholder.
- Rows are post-processed: leading whitespace is stripped. To indent a row, start it with
  an ANSI escape sequence instead of spaces.
- The command's environment includes `CLAUDE_CODE_SESSION_ID` (matches stdin JSON
  `session_id`), `CLAUDE_PROJECT_DIR`, and `CLAUDE_EFFORT`, but nothing locating any
  plugin, and plugin `bin/` directories are not on its `PATH` — `bin/` reaches only the
  Bash tool.

## Development

- The dev shell (`.envrc` → `.nix/flake.nix`, via direnv or `nix develop ./.nix`) provides
  only `claude-code`; the scripts themselves need nothing beyond bash and coreutils.
- The auto-mode permission classifier blocks writing hook registrations, hook scripts, and
  permission-decision scripts, even in this repo. Switch to manual mode before editing
  `hooks/` or `scripts/allow-todo-edits.sh`.
- There is no test suite. The scripts read only `$HOME`, `$CLAUDE_CODE_SESSION_ID`, their
  first argument, and stdin, so they can be exercised directly against a scratch home:

  ```sh
  export HOME=/tmp/scratch-home CLAUDE_CODE_SESSION_ID=test
  mkdir -p "$HOME/.claude/todos"
  printf -- '- [x] one\n- [ ] two\n' > "$HOME/.claude/todos/test.md"
  touch -d '20 minutes ago' "$HOME/.claude/todos/test.md"   # older than REMIND_INTERVAL_MINUTES
  echo '{}' | scripts/todo-hook.sh UserPromptSubmit         # injects the list and touches the file
  scripts/statusline.sh | cat -v                            # show escapes; expect bar + open items
  echo "{\"tool_input\":{\"file_path\":\"$HOME/.claude/todos/test.md\"}}" | scripts/allow-todo-edits.sh
  ```

  `bash -n scripts/*.sh` catches syntax errors; shellcheck is not in the dev shell.
- Test a working copy end to end with `claude --plugin-dir <repo>`. If the same hooks are also
  configured in `~/.claude/settings.json`, they fire twice. Under `--plugin-dir` the plugin is
  not in the cache, so the glob in the user's `statusLine` setting will not pick up the working
  copy's renderer; `SKILL.md` handles this by pinning an absolute path, or run the script
  directly as above.
- Scripts depend only on `bash` and coreutils; keep it that way, since they run on
  whatever machine installs the plugin. `session_id` comes from the `CLAUDE_CODE_SESSION_ID`
  environment variable (present in both statusline and hook processes; verified, not
  documented), and the event name is passed to the hook as its first argument by the
  registration in `hooks/hooks.json` — neither is parsed from stdin. The allow hook parses
  `file_path` from stdin with grep.
- Bump `version` in `.claude-plugin/plugin.json` on release; the marketplace entry in
  `.claude-plugin/marketplace.json` points at `./` and carries no version of its own.
