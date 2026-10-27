import { issueKey, normalizeIssueIdentity } from './issueIdentity'

export const RELATIONSHIP_TTL_MS = 15 * 60 * 1000
export function canonicalRelationship(source, target, link) {
  const type = String(link.link_type || 'relates_to').toLowerCase()
  let a = source, b = target, label
  if (type === 'blocks') label = 'blocks'
  else if (type === 'is_blocked_by' || type === 'blocked_by') { label = 'blocks'; a = target; b = source }
  else if (['relates_to', 'related', 'relates'].includes(type)) { label = 'relates'; if (a > b) [a, b] = [b, a] }
  else return null
  return { id: link.issue_link_id != null ? 'issue-link:' + link.issue_link_id : 'issue-link:' + label + ':' + a + ':' + b,
    source: a, target: b, label, kind: 'issue_link', issueLinkId: link.issue_link_id ?? null }
}

// Only actual endpoint data returned by GitLab can create external context.
export function assembleRelationships(nodes, observations, { maxExternal = 100, maxEdges = 10000, maxHops = 1, projectDirectory = {} } = {}) {
  const result = {}, external = {}, canonical = new Set()
  const diagnostics = { missing: 0, unsupported: 0, externalOmitted: 0, edgesOmitted: 0 }
  let frontier = new Set(Object.keys(nodes))
  for (let hop = 0; hop < maxHops; hop++) {
  const next = new Set()
  for (const [source, observation] of Object.entries(observations)) {
    if (!frontier.has(source)) continue
    for (const link of observation.links || []) {
      let target
      try { target = issueKey(link) } catch { diagnostics.missing++; continue }
      const edge = canonicalRelationship(source, target, link)
      if (!edge) { diagnostics.unsupported++; continue }
      const key = [edge.label, edge.source, edge.target].join('|')
      if (canonical.has(key)) continue
      if (canonical.size >= maxEdges) { diagnostics.edgesOmitted++; continue }
      if (!nodes[target] && !external[target]) {
        if (!link.title || !link.project_id || link.iid == null) { diagnostics.missing++; continue }
        if (Object.keys(external).length >= maxExternal) { diagnostics.externalOmitted++; continue }
        const identity = normalizeIssueIdentity(link, { kind: 'project', idOrPath: link.project_id })
        const inGroup = Boolean(projectDirectory[String(link.project_id)])
        external[target] = { ...identity, inSelectedGroup: inGroup, outsideSelectedGroup: !inGroup, notInIndex: true, readOnly: true, externalContext: true,
          type: 'gitlab_issue', name: 'External context · ' + identity.fullReference + ' ' + link.title,
          color: '#8a8a8a', webUrl: link.web_url, _raw: { ...link, labels: link.labels || [], assignees: link.assignees || [] } }
      }
      if (!nodes[target]) next.add(target)
      canonical.add(key); result[edge.id] = edge
    }
  }
  frontier = next
  }
  return { edges: result, external, diagnostics }
}

export function dependencySummary(nodes, edges) {
  const blocked = new Set(), unknown = new Set()
  let inactive = 0
  for (const edge of Object.values(edges)) {
    if (edge.kind !== 'issue_link' || edge.label !== 'blocks') continue
    const source = nodes[edge.source], target = nodes[edge.target]
    const a = source?.state ?? source?._raw?.state, b = target?.state ?? target?._raw?.state
    if (a === 'closed' || b === 'closed') { inactive++; continue }
    if (a === 'opened' && b === 'opened') blocked.add(edge.target)
    else unknown.add(edge.target)
  }
  for (const id of blocked) unknown.delete(id)
  return { blocked, unknown, inactive }
}
