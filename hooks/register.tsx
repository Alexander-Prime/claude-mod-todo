import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { addItem, bar, current, parse, removeItem, setDone, setText } from './list'
import type { TodoItem } from './list'

const PANE = 'todo'
const POLL_MS = 1000
const PRUNE_DAYS = 30
const BAND_GLYPHS = 20
const BAND_ITEMS = 3

const list = atom({ plugin: 'todo-statusline', key: 'list' } as const, '')
const seen = atom({ plugin: 'todo-statusline', key: 'seen' } as const, null)
const draft = atom({ plugin: 'todo-statusline', key: 'draft' } as const, '')
const cursor = atom({ plugin: 'todo-statusline', key: 'cursor' } as const, null)
const editing = atom({ plugin: 'todo-statusline', key: 'editing' } as const, null)

const USAGE = 'Usage: /todo [add <text> | done | next]'

const todoDir = async ($: EngineInterface) => `${await $.env.get('HOME')}/.claude/todos`

// Keyed by the session id, which stays the same across --resume.
const todoPath = async ($: EngineInterface) => `${await todoDir($)}/${await $.session.id()}.md`

const readList = async ($: EngineInterface) => $.fs.read(await todoPath($)).catch(() => '')

// The watcher: the file is the source of truth, whoever writes it (the model's
// tools, these commands, the overlay, another program), and every change
// reaches the UI through here. There is no file-watch API, so it polls the
// file's mtime and size; writes made here call it at once instead of waiting.
let stamp: string | undefined

const refresh = async ($: EngineInterface) => {
  const path = await todoPath($)
  const stat = await $.fs.stat(path).catch(() => undefined)
  const next = stat === undefined ? 'missing' : `${stat.mtimeMs}:${stat.size}`

  if (next === stamp) {
    return
  }
  stamp = next
  const text = stat === undefined ? '' : await $.fs.read(path).catch(() => '')
  await update($, list, () => text)
}

const mutate = async ($: EngineInterface, edit: (text: string) => string) => {
  const before = await readList($)
  const after = edit(before)

  if (after !== before) {
    await $.fs.write(await todoPath($), after)
  }
  stamp = undefined
  await refresh($)
}

const completeCurrent = async ($: EngineInterface): Promise<TodoItem | undefined> => {
  const item = current(parse(await readList($)))

  if (item !== undefined) {
    await mutate($, text => setDone(text, item, true))
  }

  return item
}

const prune = async ($: EngineInterface) => {
  const dir = await todoDir($)
  const cutoff = (await $.clock.now()) - PRUNE_DAYS * 24 * 60 * 60 * 1000
  const stale = (await $.fs.list(dir).catch(() => []))
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md') && entry.mtimeMs < cutoff)
    .map(entry => `${dir}/${entry.name}`)

  if (stale.length > 0) {
    await $.process.run(['rm', '-f', '--', ...stale])
  }
}

// Whether a file tool's path lands on a session todo file, resolved the way
// the tool will open it, so `..` and links can't reach anything else.
const isTodoFile = async ($: EngineInterface, path: unknown) => {
  if (typeof path !== 'string' || !path.startsWith('/') || !path.endsWith('.md')) {
    return false
  }
  const cut = path.lastIndexOf('/')
  const dir = await $.fs.stat(path.slice(0, cut) || '/', { resolve: true }).catch(() => undefined)
  const root = await $.fs.stat(await todoDir($), { resolve: true }).catch(() => undefined)
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)

  return (
    root?.realPath !== undefined &&
    dir?.realPath === root.realPath &&
    (own === undefined || (!own.isLink && own.kind === 'file'))
  )
}

// The model's own reads and edits of the file are changes it already knows.
const observe = async <R,>($: EngineInterface, path: string, run: () => Promise<R>) => {
  const ran = await run()

  if (path === (await todoPath($))) {
    const text = await readList($)
    await update($, seen, () => text)
    await refresh($)
  }

  return ran
}

// An overlay row's text cut to `width`, and the padding that fills the rest so
// the focus highlight spans the whole row; apart, so a strikethrough on the
// text stops where the text does.
const fitRow = (text: string, width: number): [string, string] =>
  text.length > width
    ? [`${text.slice(0, Math.max(0, width - 1))}…`, '']
    : [text, ' '.repeat(width - text.length)]

// Overlay keys carry the item count. The focus ring keeps its position across
// a redraw, not its element, so after an add or delete the overlay refocuses
// explicitly; a key only the next drawing has makes `$.ui.focus` wait for it.
const rowKey = (count: number, line: number) => `row:${count}:${line}`
const addKey = (count: number) => `add:${count}`
const editKey = (count: number, line: number) => `edit:${count}:${line}`
const ROW_KEY = /^row:\d+:(\d+)$/

// The overlay's checkbox-column markers: Nerd Font Material Design icons,
// one-cell monochrome glyphs with no emoji forms, each followed by a space.
// CHECKED also heads the progress summaries.
const CHECKED = '\u{F0135} ' // md-checkbox_marked_outline
const UNCHECKED = '\u{F0131} ' // md-checkbox_blank_outline
const ADD = '\u{F0415} ' // md-plus

const instructions = (path: string) => `# Session todo list

This session's todo list is the markdown file ${path}. The user sees its progress in a bar below the prompt and manages it with /todo. Edit the file directly with Read, Edit and Write: one item per line, \`- [ ] text\` for an open item and \`- [x] text\` for a done one, each at the start of the line. The first open item is the current one.

Maintain the list as you work: add items when taking on new multi-step work, and keep item text accurate as scope changes. Mark an item done only when the user asks, or when moving on to a new item with nothing outstanding on the current one; finishing the work is not itself a reason. Leave items open silently: don't mention that you're leaving one unchecked, or otherwise report on the list's state, since the user already sees it. When the list changes outside your own edits, its current content arrives with the next prompt in a <session-todo-list> block. The user, /todo commands and other tools change the list between turns as a matter of course, so the most recent version you have seen is authoritative: don't treat differences from earlier command output or conversation history as a problem.`

const reminder = (path: string, text: string, why: 'changed' | 'compacted') => {
  const block = `<session-todo-list path="${path}">\n${text === '' ? '' : `${text.trimEnd()}\n`}</session-todo-list>`

  if (why === 'compacted') {
    return `${block}\nThe conversation was just compacted; this is the session todo list's current content.`
  }

  return text === ''
    ? `${block}\nThe session todo list was cleared since you last saw it.`
    : `${block}\nThe session todo list changed since you last saw it; this is its current content.`
}

// `/todo next` starts its turn with a short prompt, which the transcript shows,
// after appending its instructions as a row only the model reads. (A plugin's
// own prompt.submit hooks don't see the prompts it submits, so they can't be
// attached there as context.)
const NEXT_PROMPT = 'Continue with the next todo item.'

const nextInstructions = (item: string) =>
  `Proceed with the next item on the todo list: "${item}". Before writing anything, compare what it asks for against the current state of the project, reading the relevant code rather than assuming the task is still needed or shaped as described. If its scope or approach is ambiguous, clarify with the AskUserQuestion tool first.`

// The hidden row also carries the list when it changed since the model saw it
// (it just did, when the current item was checked off), since the dirty check
// at prompt.submit doesn't see this prompt either.
const startNext = async ($: EngineInterface, item: string) => {
  const text = await readList($)
  const isChanged = text !== ((await read($, seen)) ?? '')
  const notes = [
    ...(isChanged ? [reminder(await todoPath($), text, 'changed')] : []),
    nextInstructions(item),
  ]

  if (isChanged) {
    await update($, seen, () => text)
  }
  await $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: notes.join('\n\n') }] },
  })
  await $.prompt.submit({ text: NEXT_PROMPT, asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: "Manage the session's todo list: bare opens it, add <text>, done, next",
      argumentHint: '[add <text> | done | next]',
    })
    await prune($)
    stamp = undefined
    await refresh($)
    $.clock.every(POLL_MS, () => void refresh($))

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const section = {
      id: 'todo-statusline:instructions',
      text: instructions(await todoPath($)),
      scope: 'session',
    } as const

    return { sections: [...composed.sections, section] }
  })

  // The dirty check: the list as the model last saw it against the file now.
  // A difference means something other than the model changed it, so the
  // current list rides along with the prompt, unseen by the user.
  on('prompt.submit', async ($, e, next) => {
    const text = await readList($)
    const known = (await read($, seen)) ?? ''

    if (text === known) {
      return next(e)
    }
    await update($, seen, () => text)

    return next({
      ...e,
      context: [...(e.context ?? []), reminder(await todoPath($), text, 'changed')],
    })
  })

  // Compaction summarizes the list away, possibly in the middle of a turn, so
  // a non-empty list goes straight back in as a hidden note the model reads
  // from its next request on. Only the main conversation's compactions count,
  // and a precompute installs nothing.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)

    if (compacted.skip !== undefined || e.agentId !== undefined || e.trigger === 'precompute') {
      return compacted
    }
    const text = await readList($)
    await update($, seen, () => text)

    if (text !== '') {
      await $.session.append({
        message: {
          type: 'user',
          content: [{ type: 'text', text: reminder(await todoPath($), text, 'compacted') }],
        },
      })
    }

    return compacted
  })

  // Observers only: if one fails, the call goes on (or keeps what it settled to).
  on('tool.call', { tool: 'Read' }, ($, e, next) => observe($, e.file_path, () => next(e)))
    .catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, ($, e, next) => observe($, e.file_path, () => next(e)))
    .catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, ($, e, next) => observe($, e.file_path, () => next(e)))
    .catch(($, e, next) => next(e))

  // Reads and edits of the session todo files are allowed without asking, so
  // mid-task list maintenance doesn't stop for a permission prompt.
  on('tool.check', { tool: /^(Read|Edit|Write)$/ }, async ($, e, next) => {
    const path = (e.input as { file_path?: unknown } | null)?.file_path

    return (await isTodoFile($, path))
      ? { decision: 'allow', reason: 'session todo list maintenance' }
      : next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const [, verb = '', rest = ''] = /^(\S*)\s*([\s\S]*)$/.exec(e.args.trim()) ?? []

    switch (verb) {
      case '': {
        await $.ui.open({ id: PANE, title: 'Todo', focus: true, closeOnEscape: true })

        return {}
      }
      case 'add': {
        if (rest.trim() === '') {
          return { text: USAGE }
        }
        await mutate($, text => addItem(text, rest))

        return { text: `Added: ${rest.trim()}` }
      }
      case 'done': {
        const item = await completeCurrent($)

        return { text: item === undefined ? 'No open item.' : `Done: ${item.text}` }
      }
      case 'next': {
        const item = await completeCurrent($)
        const upcoming = current(parse(await readList($)))
        const doneLine = item === undefined ? '' : `Done: ${item.text}\n`

        if (upcoming === undefined) {
          return { text: `${doneLine}Nothing left on the list.` }
        }
        // Submitted once this command has returned: from inside its hook the
        // prompt would wait on the turn the command itself holds.
        $.clock.after(0, () => void startNext($, upcoming.text))

        return { text: `${doneLine}Next: ${upcoming.text}` }
      }
      default:
        return { text: USAGE }
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, cursor, () => null)
    await update($, editing, () => null)

    return next(e)
  })

  // Which row the hotkeys act on: the last one the focus landed on. The text
  // fields clear it, so the buttons act on nothing from there; the footer
  // buttons leave it, so Tab can reach them without losing the row.
  // Focus leaving an open edit field cancels the edit.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)

    if (moved.deny !== undefined) {
      return moved
    }
    const row = ROW_KEY.exec(e.element ?? '')
    const isEditField = e.element?.startsWith('edit:') === true

    if (row !== null) {
      await update($, cursor, () => Number(row[1]))
    } else if (e.element?.startsWith('add:') === true || isEditField) {
      await update($, cursor, () => null)
    }
    if (!isEditField) {
      await update($, editing, () => null)
    }

    return moved
  })

  // The bar below the prompt: progress and the next few open items, in the
  // mode-label slot at the right of the footer (under any labels the engine
  // shows there).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const items = parse(await read($, list))

    if (items.length === 0) {
      return next(e)
    }
    const modes = e.props.modes.length > 0 ? await next(e) : undefined
    const { Box, Text } = $.ui.resolve(e)
    const done = items.filter(item => item.isDone).length
    const open = items.filter(item => !item.isDone).slice(0, BAND_ITEMS)

    return (
      <Box flexDirection="column">
        {modes}
        <Text dimColor={open.length === 0}>
          {CHECKED}
          {done}/{items.length} {bar(done, items.length, BAND_GLYPHS)}
        </Text>
        {open.map((item, i) => (
          <Text bold={i === 0} dimColor={i === BAND_ITEMS - 1} wrap="truncate-end">
            {i === 0 ? '❯' : '∘'} {item.text}
          </Text>
        ))}
      </Box>
    )
  })

  // The overlay: the full list to check off, delete from and add to.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Link, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const items = parse(await read($, list))
    const done = items.filter(item => item.isDone).length
    const active = current(items)
    const path = await todoPath($)
    const value = await read($, draft)
    const line = await read($, cursor)
    const selected = items.find(item => item.line === line)
    const editLine = await read($, editing)
    // The text's room: less the two-column indent, the checkbox (one cell) and
    // the space after it.
    const rowWidth = Math.max(1, e.props.bodyColumns - 4)
    const percent = items.length === 0 ? 0 : Math.round((done * 100) / items.length)

    const add = async (entry: string) => {
      if (entry.trim() === '') {
        return
      }
      await mutate($, text => addItem(text, entry))
      await update($, draft, () => '')
      // The new row is drawn where the field was; keep the focus on the field.
      await $.ui.focus({ requestId: PANE, key: addKey(parse(await readList($)).length) })
    }

    // Saves an edit (an empty one cancels it) and puts the focus back on the row.
    const save = async (item: TodoItem, entry: string) => {
      if (entry.trim() !== '') {
        await mutate($, text => setText(text, item, entry))
      }
      await update($, editing, () => null)
      await update($, cursor, () => item.line)
      await $.ui.focus({ requestId: PANE, key: rowKey(items.length, item.line) })
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" paddingLeft={2}>
          <Text bold={done < items.length} dimColor={done === items.length}>
            {CHECKED}
            {done}/{items.length} {bar(done, items.length, Math.max(1, e.props.bodyColumns - 20))}{' '}
            {percent}%
          </Text>
          <Link href={`file://${path}`}>
            <Text dimColor>{path}</Text>
          </Link>
        </Box>
        <Text> </Text>
        {items.length === 0 && <Text dimColor>No items yet.</Text>}
        {items.map(item =>
          Input !== undefined && item.line === editLine ? (
            // The row being edited: a field holding its text, in the text's place.
            <Box flexDirection="row">
              {item === active ? <Text bold>❯ </Text> : <Text>  </Text>}
              <Text>{item.isDone ? CHECKED : UNCHECKED}</Text>
              <Input
                key={editKey(items.length, item.line)}
                value={item.text}
                submitLabel="save"
                onSubmit={entry => void save(item, entry)}
              />
            </Box>
          ) : (
            // One Button per row: the arrows walk rows, the focus inverts the
            // whole row, and pressing it toggles the check.
            <Button
              key={rowKey(items.length, item.line)}
              plain
              onPress={() => mutate($, text => setDone(text, item, !item.isDone))}
            >
              {item === active ? <Text bold>❯ </Text> : '  '}
              {item.isDone ? CHECKED : UNCHECKED}
              <Text bold={item === active} dimColor={item.isDone} strikethrough={item.isDone}>
                {fitRow(item.text, rowWidth)[0]}
              </Text>
              {fitRow(item.text, rowWidth)[1]}
            </Button>
          ),
        )}
        {Input !== undefined && (
          // The add field sits as the checklist's last row, indented like an
          // item, with a plus in the checkbox's four cells.
          <Box flexDirection="row">
            <Text>  </Text>
            <Text dimColor bold>
              {ADD}
            </Text>
            <Input
              key={addKey(items.length)}
              placeholder="Add an item"
              submitLabel="add"
              value={value}
              autoFocus
              onInput={entry => void update($, draft, () => entry)}
              onSubmit={entry => void add(entry)}
            />
          </Box>
        )}
        {items.length > 0 && <Text> </Text>}
        {items.length > 0 && (
          // Always drawn, so the focus ring has the same stops whatever is
          // highlighted; a focused text field takes the keys before the
          // hotkeys, and with no row highlighted a press does nothing.
          <Box flexDirection="row">
            <Button
              key="edit"
              plain
              hotkey="e"
              label="edit"
              onPress={async () => {
                if (selected === undefined) {
                  return
                }
                await update($, editing, () => selected.line)
                await update($, cursor, () => null)
                await $.ui.focus({ requestId: PANE, key: editKey(items.length, selected.line) })
              }}
            />
            <Text>  </Text>
            <Button
              key="delete"
              plain
              hotkey="d"
              label="delete"
              onPress={async () => {
                if (selected === undefined) {
                  return
                }
                const index = items.indexOf(selected)
                await mutate($, text => removeItem(text, selected))
                // Highlight the row that took its place, or the one before it
                // when the last went, so `d` stays armed; an empty list hands
                // the focus to the add field.
                const remaining = parse(await readList($))
                const next = remaining[index] ?? remaining[index - 1]
                await update($, cursor, () => next?.line ?? null)
                await $.ui.focus({
                  requestId: PANE,
                  key: next === undefined ? addKey(0) : rowKey(remaining.length, next.line),
                })
              }}
            />
          </Box>
        )}
      </Box>
    )
  })
}
