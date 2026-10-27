import { dependencySummary } from './issueRelationships'

export function scopeValues(nodes) {
  return [...new Set(Object.values(nodes).flatMap(n => (n._raw?.labels || []).flatMap(label => {
    const match = /^scope::(.+)$/i.exec(label)
    return match ? [match[1]] : []
  })))].sort((a, b) => a.localeCompare(b))
}

export function dependencyClosure(seedIds, nodes, edges, { hops = 1, direction = 'upstream' } = {}) {
  const ids = new Set(seedIds.filter(id => nodes[id]))
  let frontier = new Set(ids)
  for (let hop = 0; hop < Math.min(2, Math.max(0, Number(hops))); hop++) {
    const next = new Set()
    for (const edge of Object.values(edges)) {
      if (edge.label !== 'blocks') continue
      if (direction !== 'downstream' && frontier.has(edge.target) && nodes[edge.source] && !ids.has(edge.source)) next.add(edge.source)
      if (direction !== 'upstream' && frontier.has(edge.source) && nodes[edge.target] && !ids.has(edge.target)) next.add(edge.target)
    }
    next.forEach(id => ids.add(id)); frontier = next
  }
  return ids
}

export function selectSlice({ mode, value, nodes, edges, hierarchyNodes = {}, hierarchyEdges = {}, hops = 1, direction = 'upstream' }) {
  const allNodes = { ...nodes, ...hierarchyNodes }, allEdges = { ...edges, ...hierarchyEdges }
  const blocked = dependencySummary(allNodes, allEdges).blocked
  let seeds = []
  if (mode === 'epic' && value) seeds = Object.keys(hierarchyNodes)
  if (mode === 'scope' && value) seeds = Object.values(nodes).filter(n => (n._raw?.labels || []).some(l => l.toLowerCase() === ('scope::' + value).toLowerCase())).map(n => n.id)
  if (mode === 'issue' && nodes[value]) seeds = [value]
  if (mode === 'blocked') seeds = [...blocked].filter(id => !nodes[id]?.externalContext)
  const ids = dependencyClosure(seeds, allNodes, allEdges, { hops, direction })
  return { nodes: Object.fromEntries([...ids].map(id => [id, allNodes[id]])), edges: Object.fromEntries(Object.entries(allEdges).filter(([, e]) => ids.has(e.source) && ids.has(e.target))), seeds, blocked }
}

export function presentSlice(slice, filteredNodes, { strict = false, hops = 1, direction = 'upstream', collapsed = [], layer = 'both', nodeLimit = 200, edgeLimit = 400 } = {}) {
  const seedSet = new Set(slice.seeds)
  const visibleSeeds = slice.seeds.filter(id => filteredNodes[id] && !slice.nodes[id]?.externalContext)
  const ids = strict ? new Set(Object.keys(filteredNodes).filter(id => slice.nodes[id])) : dependencyClosure(visibleSeeds, slice.nodes, slice.edges, { hops, direction })
  // Structural epic cards remain available to explain the selected hierarchy.
  for (const n of Object.values(slice.nodes)) if (n.type === 'gitlab_epic') ids.add(n.id)
  const children = new Map()
  for (const e of Object.values(slice.edges)) if (e.kind === 'contains') children.set(e.source, [...(children.get(e.source) || []), e.target])
  const owner = new Map(), summaries = {}
  for (const id of collapsed) {
    if (!ids.has(id)) continue
    const descendants = new Set(), queue = [...(children.get(id) || [])]
    while (queue.length) { const child = queue.shift(); if (child === id || descendants.has(child)) continue; descendants.add(child); queue.push(...(children.get(child) || [])) }
    const issues = [...descendants].map(key => slice.nodes[key]).filter(n => n?.type === 'gitlab_issue')
    summaries[id] = { total: issues.length, open: issues.filter(n => (n.state || n._raw?.state) === 'opened').length, closed: issues.filter(n => (n.state || n._raw?.state) === 'closed').length, projects: new Set(issues.map(n => n.projectId || n.projectPath)).size, blocked: issues.filter(n => slice.blocked.has(n.id)).length }
    descendants.forEach(child => { if (!owner.has(child)) owner.set(child, id) })
  }
  const surviving = [...ids].filter(id => !owner.has(id)).sort((a,b) => Number(!seedSet.has(a)) - Number(!seedSet.has(b)))
  const shown = new Set(surviving.slice(0, nodeLimit)), nodes = {}, edges = {}
  for (const id of shown) {
    const n = slice.nodes[id]; if (!n) continue
    const dimmed = !filteredNodes[id] && n.type !== 'gitlab_epic'
    const summary = summaries[id]
    nodes[id] = { ...n, sliceContext: dimmed || !seedSet.has(id), hierarchyReadOnly: n.hierarchyReadOnly || dimmed, collapsedSummary: summary,
      ...(summary ? { _raw: { ...n._raw, title: n._raw.title + ' · ' + summary.total + ' issues (' + summary.open + ' open, ' + summary.closed + ' closed), ' + summary.projects + ' projects, ' + summary.blocked + ' blocked' } } : {}) }
  }
  const representative = id => { const seen = new Set(); while (owner.has(id) && !seen.has(id)) { seen.add(id); id = owner.get(id) }; return id }
  let eligibleEdges = 0
  const dedup = new Set()
  for (const edge of Object.values(slice.edges)) {
    const contains = edge.kind === 'contains'
    if (contains ? layer === 'dependencies' : (layer === 'hierarchy' || edge.label !== 'blocks')) continue
    const source = representative(edge.source), target = representative(edge.target)
    if (source === target || !shown.has(source) || !shown.has(target)) continue
    const key = [edge.label, source, target].join('|'); if (dedup.has(key)) continue; dedup.add(key); eligibleEdges++
    if (Object.keys(edges).length < edgeLimit) edges[key] = { ...edge, id: key, source, target }
  }
  return { nodes, edges, omittedNodes: Math.max(0, surviving.length - shown.size), omittedEdges: Math.max(0, eligibleEdges - Object.keys(edges).length), summaries }
}
