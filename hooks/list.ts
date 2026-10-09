// The list file format: one item per line, `- [ ]` open or `- [x]` done,
// anchored at column 0. Every other line is kept as written and ignored.

export type TodoItem = { line: number; text: string; isDone: boolean }

const ITEM = /^- \[( |x)\] (.*)$/

export const parse = (text: string): TodoItem[] =>
  text.split('\n').flatMap((raw, line) => {
    const match = ITEM.exec(raw)

    return match ? [{ line, text: match[2] ?? '', isDone: match[1] === 'x' }] : []
  })

// The current item is the first open one.
export const current = (items: readonly TodoItem[]): TodoItem | undefined =>
  items.find(item => !item.isDone)

// An item's text is one line, its runs of whitespace folded to single spaces.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

export const addItem = (text: string, item: string): string => {
  const separator = text === '' || text.endsWith('\n') ? '' : '\n'

  return `${text}${separator}- [ ] ${oneLine(item)}\n`
}

// Edits address an item by its line, but only while that line still holds the
// item as it was parsed: the file may have changed since, and then the edit is
// dropped rather than landing on whatever moved into that line.
const editItem = (
  text: string,
  item: TodoItem,
  edit: (lines: string[]) => void,
): string => {
  const lines = text.split('\n')
  const found = parse(lines[item.line] ?? '')[0]

  if (found === undefined || found.text !== item.text || found.isDone !== item.isDone) {
    return text
  }
  edit(lines)

  return lines.join('\n')
}

export const setDone = (text: string, item: TodoItem, isDone: boolean): string =>
  editItem(text, item, lines => {
    lines[item.line] = `- [${isDone ? 'x' : ' '}] ${item.text}`
  })

export const setText = (text: string, item: TodoItem, itemText: string): string =>
  editItem(text, item, lines => {
    lines[item.line] = `- [${item.isDone ? 'x' : ' '}] ${oneLine(itemText)}`
  })

export const removeItem = (text: string, item: TodoItem): string =>
  editItem(text, item, lines => {
    lines.splice(item.line, 1)
  })

// One glyph per item up to `max`, scaled past it.
export const bar = (done: number, total: number, max: number): string => {
  const width = Math.min(total, max)
  const filled = total <= max ? done : Math.floor((done * max) / total)

  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}
