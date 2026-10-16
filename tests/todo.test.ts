import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'

import { addItem, bar, current, parse, removeItem, setDone, setText } from '../hooks/list'

const PATH = '/home/test/.claude/todos/session.md'

// What the engine stamps on a command run and a prompt typed at the composer.
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const TYPED = { origin: { kind: 'composer' }, wait: false } as const

// The kit has no file system: these hooks sit beneath the plugin and answer
// its `$.fs` calls from one in-memory file, and its session and env lookups.
const fakeHost = (on: On, file: { text: string | undefined }) => {
  on('env.get', () => ({ value: '/home/test' }))
  on('session.id', () => ({ value: 'session' }))
  on('fs.read', ($, e) => {
    if (e.path !== PATH || file.text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: file.text }
  })
  on('fs.write', ($, e) => {
    file.text = e.text

    return { value: undefined }
  })
  on('fs.stat', ($, e) => {
    if (e.path !== PATH || file.text === undefined) {
      throw new Error('ENOENT')
    }

    return {
      value: { kind: 'file' as const, size: file.text.length, mtimeMs: Math.random(), isLink: false },
    }
  })
}

test('parse reads items and keeps their lines', () => {
  const items = parse('# heading\n- [x] one\n- [ ] two\nnote\n- [ ] three\n')

  expect(items).toEqual([
    { line: 1, text: 'one', isDone: true },
    { line: 2, text: 'two', isDone: false },
    { line: 4, text: 'three', isDone: false },
  ])
  expect(current(items)?.text).toBe('two')
})

test('edits land only on the item as it was parsed', () => {
  const text = '- [ ] one\n- [ ] two\n'
  const [one, two] = parse(text)

  expect(setDone(text, two!, true)).toBe('- [ ] one\n- [x] two\n')
  expect(removeItem(text, one!)).toBe('- [ ] two\n')
  // The file moved on: line 0 no longer holds "two", so nothing changes.
  expect(setDone('- [ ] other\n', { ...two!, line: 0 }, true)).toBe('- [ ] other\n')
})

test('setText rewrites an item on one line, keeping its check', () => {
  const text = '- [x] one\n- [ ] two\n'
  const [one] = parse(text)

  expect(setText(text, one!, ' first\nitem ')).toBe('- [x] first item\n- [ ] two\n')
})

test('addItem appends one line, mending a missing final newline', () => {
  expect(addItem('', 'one')).toBe('- [ ] one\n')
  expect(addItem('- [ ] one', '  two\nlines ')).toBe('- [ ] one\n- [ ] two lines\n')
})

test('bar draws a glyph per item, scaled past the maximum', () => {
  expect(bar(2, 5, 20)).toBe('▰▰▱▱▱')
  expect(bar(20, 40, 10)).toBe('▰▰▰▰▰▱▱▱▱▱')
})

test('/todo add, done and next write the file', async ($, on) => {
  const file: { text: string | undefined } = { text: undefined }
  const submitted: { text: string; context: readonly string[] }[] = []
  const clock = mock.clock(on)
  const session = mock.session(on)
  fakeHost(on, file)
  on('prompt.submit', ($, e) => {
    submitted.push({ text: e.text, context: e.context ?? [] })

    return { text: e.text }
  })

  await $.command.run({ ...RUN, command: 'todo', args: 'add first' })
  await $.command.run({ ...RUN, command: 'todo', args: 'add second' })
  expect(file.text).toBe('- [ ] first\n- [ ] second\n')

  const done = await $.command.run({ ...RUN, command: 'todo', args: 'done' })
  expect(done.text).toBe('Done: first')
  expect(file.text).toBe('- [x] first\n- [ ] second\n')

  const last = await $.command.run({ ...RUN, command: 'todo', args: 'next' })
  expect(last.text).toBe('Done: second\nNothing left on the list.')
  expect(submitted).toEqual([])

  await $.command.run({ ...RUN, command: 'todo', args: 'add third' })
  await $.command.run({ ...RUN, command: 'todo', args: 'add fourth' })
  const advanced = await $.command.run({ ...RUN, command: 'todo', args: 'next' })
  expect(advanced.text).toBe('Done: third\nNext: fourth')
  // The prompt is submitted after the command returns.
  await clock.advance(0)
  expect(submitted.length).toBe(1)
  // The visible prompt is short; the instructions go in first as a hidden row.
  expect(submitted[0]?.text).toBe('Continue with the next todo item.')
  const rows = session.appended()
  expect(rows.length).toBe(1)
  expect(JSON.stringify(rows[0]?.message.content)).toContain('\\"fourth\\"')
})

test('each overlay row is one button that toggles its item', async ($, on) => {
  const file: { text: string | undefined } = { text: undefined }
  fakeHost(on, file)
  await $.command.run({ ...RUN, command: 'todo', args: 'add first' })
  await $.command.run({ ...RUN, command: 'todo', args: 'add second' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mod-todo',
      surface,
      component: 'Pane',
      requestId: 'todo',
      props: {
        title: 'Todo',
        isFocused: true,
        bodyColumns: 40,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })
    // Row keys are `row:<item count>:<line>`.
    expect(await ui.find({ key: 'row:2:0' })).toBeDefined()
    expect(await ui.find({ key: 'row:2:1' })).toBeDefined()

    await ui.press({ key: 'row:2:1' })
    expect(file.text).toBe('- [ ] first\n- [x] second\n')
    await ui.press({ key: 'row:2:1' })
    expect(file.text).toBe('- [ ] first\n- [ ] second\n')
    await ui.unmount()
  }
})

test('a compaction appends the list straight back', async ($, on) => {
  const file: { text: string | undefined } = { text: '- [ ] one\n' }
  const session = mock.session(on)
  fakeHost(on, file)
  const summary = (): SessionMessage[] => [{ role: 'user', text: 'summary', toolUses: [] }]
  on('session.compact', () => ({ messages: summary() }))

  await $.session.compact({ trigger: 'precompute', messages: summary() })
  expect(session.appended().length).toBe(0)

  await $.session.compact({ trigger: 'auto', messages: summary() })
  const rows = session.appended()
  expect(rows.length).toBe(1)
  expect(JSON.stringify(rows[0]?.message.content)).toContain('- [ ] one')
})

test('a prompt carries the list only after it changed outside the model', async ($, on) => {
  const file: { text: string | undefined } = { text: '- [ ] one\n' }
  const contexts: (readonly string[] | undefined)[] = []
  fakeHost(on, file)
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)

    return { text: e.text }
  })

  await $.prompt.submit({ ...TYPED, text: 'first' })
  await $.prompt.submit({ ...TYPED, text: 'second' })
  file.text = '- [x] one\n'
  await $.prompt.submit({ ...TYPED, text: 'third' })

  expect(contexts[0]?.[0]).toContain('- [ ] one')
  expect(contexts[1]).toBeUndefined()
  expect(contexts[2]?.[0]).toContain('- [x] one')
})
