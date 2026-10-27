// GitLab IIDs are local to a project. Only REST IDs are globally unique.
export const issueKey = (issue, projectId = issue?.project_id) => {
  if (issue?.id != null) return 'issue:' + issue.id
  if (projectId != null && issue?.iid != null) return 'project:' + projectId + ':issue:' + issue.iid
  throw new Error('Issue identity requires a REST ID or project ID and IID')
}
export const issueReference = (node, qualified = false) => {
  const raw = node?._raw || node || {}
  return (qualified && (node?.fullReference || raw.references?.full)) || '#' + (raw.iid ?? node?.iid ?? node?.id ?? '')
}
export const normalizeIssueIdentity = (issue, source, projects = {}) => {
  const projectId = issue.project_id ?? (source.kind === 'project' ? source.idOrPath : null)
  const projectPath = projects[projectId]?.path_with_namespace || issue.references?.full?.split('#')[0] || (source.kind === 'project' ? source.idOrPath : '')
  return { id: issueKey(issue, projectId), kind: 'issue', gitlabId: issue.id ?? null,
    workItemGid: issue.work_item_gid || null, projectId, projectPath,
    groupPath: source.kind === 'group' ? source.idOrPath : null, iid: issue.iid,
    fullReference: issue.references?.full || projectPath + '#' + issue.iid,
    title: issue.title, state: issue.state, inSelectedGroup: source.kind === 'group' }
}
export const createIssueLookup = (nodes) => {
  const byRestId = new Map(), byProjectIid = new Map()
  for (const node of Object.values(nodes)) {
    const raw = node._raw || node
    const restId = node.gitlabId ?? raw.id
    const projectId = node.projectId ?? raw.project_id
    const iid = raw.iid ?? node.iid
    if (restId != null) byRestId.set(String(restId), node.id)
    if (projectId != null && iid != null) byProjectIid.set(projectId + ':' + iid, node.id)
  }
  return { byRestId, byProjectIid, resolve: (issue) =>
    (issue?.id != null && byRestId.get(String(issue.id))) ||
    (issue?.project_id != null && byProjectIid.get(issue.project_id + ':' + issue.iid)) || null }
}

// Legacy IID selections are safe to migrate only within one project.
export const migrateIssueSelection = (selection, nodes, sourceKind = 'project') => (selection || []).flatMap(value => {
  const key = String(value)
  if (nodes[key]) return [key]
  if (!/^\d+$/.test(key)) return [key]
  if (sourceKind === 'group') return []
  const matches = Object.values(nodes).filter(n => String(n._raw?.iid ?? n.iid) === key)
  return matches.length === 1 ? [matches[0].id] : [key]
})
