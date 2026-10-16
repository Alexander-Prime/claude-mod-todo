declare module 'claude-code' {
  interface PluginState {
    'mod-todo': {
      // The list file's text as the watcher last read it; '' when missing.
      list: string
      // The list's text as the model last saw it (its own read or edit, or an
      // injected reminder); null before it has seen any.
      seen: string | null
      // The overlay's add-item field.
      draft: string
      // The line of the overlay row that last held the focus; null once the
      // add field takes it.
      cursor: number | null
      // The line of the overlay row open for editing; null when none is.
      editing: number | null
    }
  }
}
