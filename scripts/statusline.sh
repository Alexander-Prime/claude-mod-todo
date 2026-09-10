#!/usr/bin/env bash
# Renders session todo progress in the statusline, e.g.: ☑ 6/9 ▰▰▰▰▰▰▱▱▱

MAX_GLYPHS=20
TODO_DIR="$HOME/.claude/todos"

session_id="$CLAUDE_CODE_SESSION_ID"
[ -z "$session_id" ] && exit 0

todo_file="$TODO_DIR/$session_id.md"

done_count=0
open_count=0
if [ -s "$todo_file" ]; then
  done_count=$(grep -c '^- \[x\]' "$todo_file")
  open_count=$(grep -c '^- \[ \]' "$todo_file")
fi
total=$((done_count + open_count))

# Empty output leaves the reserved statusline row blank; a bare cursor-up
# escape removes the row. Undocumented behavior — if it breaks, print a
# placeholder here instead.
if [ "$total" -eq 0 ]; then
  printf '\033[1A'
  exit 0
fi

if [ "$total" -le "$MAX_GLYPHS" ]; then
  width=$total
  filled=$done_count
else
  width=$MAX_GLYPHS
  filled=$((done_count * MAX_GLYPHS / total))
fi

bar=""
i=0
while [ "$i" -lt "$width" ]; do
  if [ "$i" -lt "$filled" ]; then
    bar+="▰"
  else
    bar+="▱"
  fi
  i=$((i + 1))
done

BRIGHT=$'\033[97m'
DIM=$'\033[2m'
RESET=$'\033[0m'

# The whole summary line is one OSC 8 hyperlink to the full list.
OSC8=$'\033]8;;'
ST=$'\033\\'
link_open="${OSC8}file://${todo_file}${ST}"
link_close="${OSC8}${ST}"

# The summary is bright while work remains and dim once everything is done.
if [ "$open_count" -gt 0 ]; then
  echo "${link_open}${BRIGHT}☑ $done_count/$total $bar${RESET} ${DIM}󰌷${RESET}${link_close}"
else
  echo "${link_open}${DIM}☑ $done_count/$total $bar 󰌷${RESET}${link_close}"
fi

# Up to three open items below the bar, fading: bright, normal, dim.
open_items=$(grep '^- \[ \]' "$todo_file" | head -3 | sed 's/^- \[ \] //')
[ -n "$open_items" ] || exit 0

i=0
while IFS= read -r item; do
  i=$((i + 1))
  case "$i" in
    1) printf '%s\n' "${BRIGHT}❯ ${item}${RESET}" ;;
    2) printf '%s\n' "∘ ${item}" ;;
    3) printf '%s\n' "${DIM}∘ ${item}${RESET}" ;;
  esac
done <<< "$open_items"
