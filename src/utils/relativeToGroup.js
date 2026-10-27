// Display-only formatting. Canonical paths and references remain unchanged.
export function relativeToGroup(value, root) {
  const path = String(value || ''), prefix = String(root || '').replace(/\/+$/, '')
  return prefix && path.startsWith(prefix + '/') ? path.slice(prefix.length + 1) : path
}
