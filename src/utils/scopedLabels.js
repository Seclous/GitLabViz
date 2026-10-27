// A "scoped label" follows the GitLab convention "Prefix::Value" or "Prefix:Value"
// (e.g. Priority::High, Type:Bug). Plain labels like "Bug" or "Frontend" are not scoped.
export function isScopedLabel (l) {
  if (typeof l !== 'string') return false
  const i = l.indexOf(':')
  return i > 0 && i < l.length - 1
}

export function getScopedLabelValues (labels, prefix) {
  if (!Array.isArray(labels)) return []
  const p = String(prefix || '').trim().toLowerCase()
  if (!p) return []

  const out = []
  const seen = new Set()
  for (const l of labels) {
    if (typeof l !== 'string') continue
    let v = null
    const lower = l.toLowerCase()
    if (lower.startsWith(p + '::')) v = l.substring(p.length + 2).trim()
    else if (lower.startsWith(p + ':')) v = l.substring(p.length + 1).trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

export function getScopedLabelValue (labels, prefix) {
  const matches = getScopedLabelValues(labels, prefix)
  return matches.length ? matches[matches.length - 1] : null
}
