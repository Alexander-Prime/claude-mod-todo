#!/usr/bin/env bash
# PreToolUse hook: allow Edit/Write to the session todo files without prompting,
# so mid-task list maintenance doesn't route through the permission classifier.

file_path=$(grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)

# Normalize the path so sensitive files can't be targeted with `..` or symlinks
case "$file_path" in /*) ;; *) exit 0 ;; esac
[ -L "$file_path" ] && exit 0

real_dir=$(cd -- "${file_path%/*}" 2>/dev/null && pwd -P) || exit 0
todo_dir=$(cd -- "$HOME/.claude/todos" 2>/dev/null && pwd -P) || exit 0

if [ "$real_dir" = "$todo_dir" ]; then
  case "${file_path##*/}" in
    *.md)
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"session todo list maintenance"}}\n'
      ;;
  esac
fi

exit 0
