#!/usr/bin/env bash
# Session todo list: injects context on UserPromptSubmit, prunes stale files on SessionStart.

REMIND_INTERVAL_MINUTES=10
TODO_DIR="$HOME/.claude/todos"

cat > /dev/null
event="$1"
session_id="$CLAUDE_CODE_SESSION_ID"

[ -z "$session_id" ] && exit 0

case "$event" in
  SessionStart)
    mkdir -p "$TODO_DIR"
    find "$TODO_DIR" -type f -mtime +30 -delete
    ;;
  UserPromptSubmit)
    todo_file="$TODO_DIR/$session_id.md"
    echo "<session-todo-file>$todo_file</session-todo-file>"
    # The list is re-injected only when its mtime is stale: both real edits and
    # injections (via the touch below) reset the clock, so a list the model has
    # recently seen or changed is never repeated.
    if [ -s "$todo_file" ]; then
      if [ -z "$(find "$todo_file" -mmin "-$REMIND_INTERVAL_MINUTES" 2>/dev/null)" ]; then
        echo "<session-todo-list>"
        cat "$todo_file"
        echo "</session-todo-list>"
        echo "Maintain this list as you work, editing the file directly: add items when taking on new multi-step work. Mark an item done (- [x]) only when the user asks, or when moving on to a new item with nothing outstanding on the current one — finishing the work is not itself a reason."
        touch "$todo_file"
      fi
    fi
    ;;
esac

exit 0
