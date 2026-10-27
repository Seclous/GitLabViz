import { createGitLabClient, createGitLabGraphqlClient, gitlabRequest } from './gitlab'
import { createRequestBudget, nextRestPage } from './gitlabPagination'
import { normalizeIssueIdentity } from '../utils/issueIdentity'

const LEGACY_WARNING = 'Compatibility mode: using the legacy Epic REST API. Work Item tasks and inaccessible or cross-group child epics may be missing.'
const fields = type => new Map((type?.fields || []).map(field => [field.name, field]))
const aborted = signal => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError') }
const isAbort = error => error?.name === 'AbortError' || error?.code === 'ERR_CANCELED'
const warningFor = error => {
  const status = error?.response?.status
  if (status === 401 || status === 403) return 'Access denied; check token permissions and the GitLab tier.'
  if (status === 429) return 'GitLab rate limit reached. Retry later.'
  return error?.code === 'GLV_REQUEST_BUDGET' ? error.message : error?.capabilityReason || 'Unavailable on this GitLab version, tier, or with the current permissions.'
}

// No legacy Epic ID is ever converted to a WorkItem ID.
export function createHierarchyAdapter(apiBaseUrl, token, options = {}) {
  const rest = options.rest || createGitLabClient(apiBaseUrl, token)
  const graphql = options.graphql || createGitLabGraphqlClient(apiBaseUrl, token)
  const maxItems = options.maxItems || 2000
  let schema, group, mode, index = []
  const warnings = new Set()
  const budgets = new WeakMap()
  let defaultBudget
  const startBudget = signal => { const budget = createRequestBudget(options.maxRequests || 300); if (signal) budgets.set(signal, budget); else defaultBudget = budget }
  const claim = signal => (signal ? budgets.get(signal) : defaultBudget).claim(signal)
  const post = async (query, variables, signal) => {
    aborted(signal)
    claim(signal)
    const response = await gitlabRequest(graphql, 'post', '', { data: { query, variables }, signal })
    if (!response.data || typeof response.data !== 'object' || !('data' in response.data) && !('errors' in response.data)) {
      const error = new Error('Invalid GraphQL response')
      error.capabilityReason = 'The GraphQL endpoint returned an unexpected response. Check the API URL or proxy configuration.'
      throw error
    }
    if (response.data.errors?.length) {
      const error = new Error('GraphQL request failed')
      const details = response.data.errors.map(e => {
        const ext = e.extensions || {}
        return [ext.code, ext.typeName, ext.fieldName, ext.argumentName].filter(v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v)).join(' / ')
      }).filter(Boolean)
      error.capabilityReason = details.length ? 'GraphQL capability unavailable: ' + [...new Set(details)].join('; ') + '.' : 'GitLab rejected the Work Item query; check permissions, tier, and version.'
      throw error
    }
    return response.data.data
  }
  const get = async (url, params, signal) => {
    aborted(signal)
    claim(signal)
    return gitlabRequest(rest, 'get', url, { params, signal })
  }
  const restPages = async (url, params, signal, resultWarnings = warnings) => {
    const result = []
    let page = 1
    while (page) {
      const response = await get(url, { ...params, per_page: 100, page }, signal)
      if (!Array.isArray(response.data)) throw new Error('Unexpected hierarchy response')
      const batch = response.data
      const remaining = maxItems - result.length
      result.push(...batch.slice(0, remaining))
      const next = response.headers?.['x-next-page'] ?? response.headers?.['X-Next-Page']
      if (batch.length > remaining || result.length >= maxItems && (next || next == null && batch.length === 100)) { resultWarnings.add('Hierarchy item limit reached; results are incomplete.'); break }
      try { page = nextRestPage(response, page) }
      catch (error) { resultWarnings.add(error.message); break }
    }
    return result
  }
  const probe = async signal => {
    const data = await post(`query HierarchyCapabilities {
      root: __schema { queryType { fields { name } } }
      group: __type(name: "Group") { fields { name args { name } } }
      item: __type(name: "WorkItem") { fields { name } }
      hierarchy: __type(name: "WorkItemWidgetHierarchy") { fields { name args { name } } }
    }`, {}, signal)
    // Some GitLab versions return their cached, complete introspection schema instead of aliases.
    const types = new Map((data.__schema?.types || []).map(type => [type.name, type]))
    schema = { root: fields(data.root?.queryType || types.get(data.__schema?.queryType?.name)), group: fields(data.group || types.get('Group')), item: fields(data.item || types.get('WorkItem')), hierarchy: fields(data.hierarchy || types.get('WorkItemWidgetHierarchy')) }
    const missing = [!schema.root.has('workItem') && 'Query.workItem', !schema.group.has('workItems') && 'Group.workItems', ...['id', 'iid', 'title', 'widgets', 'workItemType'].filter(f => !schema.item.has(f)).map(f => 'WorkItem.' + f), !schema.hierarchy.has('children') && 'WorkItemWidgetHierarchy.children'].filter(Boolean)
    if (missing.length) {
      const error = new Error('Unsupported Work Item hierarchy schema')
      error.capabilityReason = 'Required Work Item schema fields are unavailable: ' + missing.join(', ') + '.'
      throw error
    }
    const childArgs = schema.hierarchy.get('children').args || []
    if (!['first', 'after'].every(name => childArgs.some(a => a.name === name))) throw new Error('Hierarchy pagination unavailable')
  }
  const itemFields = () => [
    'id iid title workItemType { name }',
    schema.item.has('state') && 'state',
    schema.item.has('webUrl') && 'webUrl',
    schema.item.has('project') && 'project { fullPath }',
    schema.item.has('namespace') && 'namespace { fullPath }'
  ].filter(Boolean).join(' ')
  const epicRecord = item => {
    const parent = item.widgets?.find(w => w.__typename === 'WorkItemWidgetHierarchy')?.parent
    return { ...item, id: item.id, namespacePath: item.namespace?.fullPath || group.full_path,
      parentId: parent?.id, parent: parent ? { ...parent, namespacePath: parent.namespace?.fullPath || group.full_path } : null }
  }
  const legacyRecord = item => ({ ...item, id: `legacy-epic:${item.group_id ?? group.id}:${item.id}`,
    legacyId: item.id, parentId: item.parent_id == null ? null : `legacy-epic:${item.group_id ?? group.id}:${item.parent_id}`, namespacePath: item.group?.full_path || item.references?.full?.split('&')[0] || group.full_path,
    workItemType: { name: 'Epic' }, webUrl: item.web_url })

  async function listEpics(source, signal) {
    warnings.clear()
    startBudget(signal)
    group = (await get('/groups/' + encodeURIComponent(source.idOrPath), {}, signal)).data
    try {
      await probe(signal)
      mode = 'workItems'
      const args = schema.group.get('workItems').args || []
      if (!['types', 'first', 'after'].every(name => args.some(a => a.name === name))) throw new Error('Epic listing unsupported')
      const descendants = args.some(a => a.name === 'includeDescendantGroups')
      index = []
      const scopes = [{ id: group.id, full_path: group.full_path }]
      if (!descendants && source.includeSubgroups) {
        try { scopes.push(...await restPages('/groups/' + encodeURIComponent(group.id) + '/descendant_groups', { all_available: true }, signal)) }
        catch (error) {
          if (isAbort(error)) throw error
          if ([404, 405].includes(error?.response?.status)) {
            const queue = [group.id], seen = new Set(queue)
            while (queue.length) {
              const id = queue.shift()
              try {
                for (const child of await restPages('/groups/' + encodeURIComponent(id) + '/subgroups', { all_available: true }, signal)) {
                  if (seen.has(child.id)) continue
                  seen.add(child.id); scopes.push(child); queue.push(child.id)
                }
              } catch (nestedError) {
                if (isAbort(nestedError)) throw nestedError
                warnings.add('Subgroup directory incomplete: ' + warningFor(nestedError))
                if (nestedError.code === 'GLV_REQUEST_BUDGET') break
              }
            }
          } else warnings.add('Subgroup directory incomplete: ' + warningFor(error))
        }
      }
      let loadedGroups = 0
      for (const scope of scopes) {
        if (!scope.full_path) { warnings.add('A subgroup has no canonical path; epic coverage is partial.'); continue }
        let after = null
        const cursors = new Set()
        try {
          do {
            const data = await post(`query EpicIndex($path: ID!, $after: String) {
              group(fullPath: $path) { workItems(types: [EPIC], first: 100, after: $after${descendants ? ', includeDescendantGroups: ' + !!source.includeSubgroups : ''}) {
                nodes { ${itemFields()} ${schema.hierarchy.has('parent') ? 'widgets { __typename ... on WorkItemWidgetHierarchy { parent { ' + itemFields() + ' } } }' : ''} } pageInfo { hasNextPage endCursor }
              } }
            }`, { path: scope.full_path, after }, signal)
            const connection = data?.group?.workItems
            if (!connection) throw new Error('Epic listing unavailable')
            for (const item of connection.nodes || []) {
              if (!item) continue
              const actualPath = item.namespace?.fullPath
              if (!descendants && !actualPath) { warnings.add('Epic namespace unavailable; subgroup boundary coverage is partial.'); continue }
              if (!descendants && actualPath !== scope.full_path) continue
              index.push({ ...epicRecord(item), namespacePath: actualPath || scope.full_path })
            }
            index = [...new Map(index.map(epic => [epic.id, epic])).values()]
            if (index.length >= maxItems) { index = index.slice(0, maxItems); warnings.add('Epic index limit reached; results are incomplete.'); break }
            if (!connection.pageInfo?.hasNextPage) break
            after = connection.pageInfo.endCursor
            if (!after || cursors.has(after)) throw new Error('Epic pagination did not advance')
            cursors.add(after)
          } while (true)
          loadedGroups++
        } catch (error) {
          if (isAbort(error)) throw error
          if (descendants || scopes.length === 1 && source.includeSubgroups) throw error
          warnings.add('Epic coverage incomplete for ' + scope.full_path + ': ' + warningFor(error))
        }
        if (index.length >= maxItems) break
      }
      return { epics: index, mode, warnings: [...warnings], fullPath: group.full_path, status: !descendants ? 'Epics loaded from ' + loadedGroups + ' accessible groups' : '' }

    } catch (error) {
      if (isAbort(error)) throw error
      if (error.code === 'GLV_REQUEST_BUDGET') { warnings.add(error.message); return { epics: index, mode, warnings: [...warnings] } }
      mode = 'legacy'
      warnings.add('Work Item hierarchy: ' + warningFor(error))
      warnings.add(LEGACY_WARNING)
      index = (await restPages('/groups/' + encodeURIComponent(group.id) + '/epics', {
        include_descendant_groups: !!source.includeSubgroups
      }, signal)).map(legacyRecord)
    }
    index = [...new Map(index.map(epic => [epic.id, epic])).values()]
    return { epics: index, mode, warnings: [...warnings] }
  }

  async function loadEpic(epic, source, baseNodes, { signal, includeTasks = false } = {}) {
    startBudget(signal)
    const nodes = {}, edges = {}, gidToKey = new Map(), visited = new Set()
    const loadWarnings = new Set(warnings)
    const baseByReference = new Map(Object.values(baseNodes).filter(n => !n.externalContext).map(n => [
      `${n.projectPath || n._raw?.references?.full?.split('#')[0]}#${n.iid ?? n._raw?.iid}`, n
    ]))
    const contains = (parent, child) => {
      if (parent === child) { loadWarnings.add('A hierarchy cycle was omitted.'); return }
      const id = `contains:${parent}:${child}`
      edges[id] = { id, source: parent, target: child, label: 'contains', kind: 'contains' }
    }
    async function addItem(item, forceEpic = false) {
      if (gidToKey.has(item.id)) return gidToKey.get(item.id)
      const kind = forceEpic ? 'epic' : String(item.workItemType?.name || '').toLowerCase()
      const path = item.project?.fullPath || item.namespace?.fullPath || item.namespacePath || group.full_path
      if (kind === 'task' && !includeTasks) return null
      const inGroup = path === group.full_path || path.startsWith(group.full_path + '/')
      if (kind === 'epic') {
        nodes[item.id] = { id: item.id, kind, type: 'gitlab_epic', workItemGid: mode === 'workItems' ? item.id : null,
          namespacePath: path, iid: item.iid, name: item.title, fullReference: `${path}&${item.iid}`,
          externalToGroup: !inGroup, inSelectedGroup: inGroup, hierarchyReadOnly: true,
          _raw: { title: item.title, state: String(item.state || 'opened').toLowerCase(), web_url: item.webUrl, labels: [] } }
        gidToKey.set(item.id, item.id)
        return item.id
      }
      const existing = baseByReference.get(`${path}#${item.iid}`)
      if (existing) {
        nodes[existing.id] = existing
        gidToKey.set(item.id, existing.id)
        return existing.id
      }
      let raw
      try {
        raw = (await get(`/projects/${encodeURIComponent(path)}/issues/${encodeURIComponent(item.iid)}`, {}, signal)).data
      } catch (error) {
        if (isAbort(error)) throw error
        loadWarnings.add('Some Work Items could not be enriched through the Issue API; their available hierarchy details are shown read-only.')
      }
      const identity = raw ? normalizeIssueIdentity(raw, source, { [raw.project_id]: { path_with_namespace: path } }) : {
        id: item.id, workItemGid: item.id, projectPath: path, iid: item.iid, fullReference: `${path}#${item.iid}`
      }
      const node = { ...identity, id: identity.id, kind: kind || 'issue', type: 'gitlab_issue', name: item.title,
        projectPath: path, fullReference: `${path}#${item.iid}`, workItemGid: mode === 'workItems' ? item.id : null,
        externalToGroup: !inGroup, inSelectedGroup: inGroup, hierarchyReadOnly: true,
        _raw: raw || { title: item.title, iid: item.iid, state: String(item.state || 'opened').toLowerCase(), labels: [], web_url: item.webUrl } }
      nodes[node.id] = node
      gidToKey.set(item.id, node.id)
      return node.id
    }
    async function visit(item, ancestors = new Set()) {
      aborted(signal)
      const key = await addItem(item)
      if (!key || visited.has(item.id)) return key
      if (ancestors.has(item.id)) { loadWarnings.add('A hierarchy cycle was omitted.'); return key }
      if (visited.size >= maxItems) { loadWarnings.add('Hierarchy item limit reached; results are incomplete.'); return key }
      visited.add(item.id)
      const kind = String(item.workItemType?.name || '').toLowerCase()
      if (kind !== 'epic' && !includeTasks) return key
      const nextAncestors = new Set([...ancestors, item.id])
      let after = null
      const cursors = new Set()
      do {
        let connection
        try {
          const data = await post(`query EpicChildren($id: WorkItemID!, $after: String) {
            workItem(id: $id) { widgets { __typename ... on WorkItemWidgetHierarchy {
              children(first: 100, after: $after) { nodes { ${itemFields()} } pageInfo { hasNextPage endCursor } }
            } } }
          }`, { id: item.id, after }, signal)
          const widget = data?.workItem?.widgets?.find(w => w.__typename === 'WorkItemWidgetHierarchy')
          connection = widget?.children
          if (!connection) { if (kind === 'epic') loadWarnings.add('An epic hierarchy is unavailable; permissions, tier, or version may limit its children.'); break }
        } catch (error) {
          if (isAbort(error)) throw error
          loadWarnings.add('Some descendants could not be loaded. ' + warningFor(error))
          break
        }
        for (const child of connection.nodes || []) {
          if (!child) { loadWarnings.add('GitLab returned an unavailable child.'); continue }
          if (nextAncestors.has(child.id)) { loadWarnings.add('A hierarchy cycle was omitted.'); continue }
          if (visited.size >= maxItems) { loadWarnings.add('Hierarchy item limit reached; results are incomplete.'); break }
          const childKey = await visit(child, nextAncestors)
          if (childKey) contains(key, childKey)
        }
        if (!connection.pageInfo?.hasNextPage) break
        after = connection.pageInfo.endCursor
        if (!after || cursors.has(after)) { loadWarnings.add('Hierarchy pagination did not advance; results are incomplete.'); break }
        cursors.add(after)
        if (visited.size >= maxItems) break
      } while (true)
      return key
    }
    async function visitLegacy(item, ancestors = new Set()) {
      aborted(signal)
      const key = await addItem(item, true)
      if (visited.has(item.id)) return key
      visited.add(item.id)
      const lineage = new Set([...ancestors, item.id])
      const id = item.group_id || group.id
      try {
        const issues = await restPages(`/groups/${encodeURIComponent(id)}/epics/${item.iid}/issues`, {}, signal, loadWarnings)
        for (const issue of issues) {
          if (Object.keys(nodes).length >= maxItems) { loadWarnings.add('Hierarchy item limit reached; results are incomplete.'); break }
          const identity = normalizeIssueIdentity(issue, source)
          const path = issue.references?.full?.split('#')[0] || identity.projectPath
          const existing = baseNodes[identity.id]
          const inGroup = path === group.full_path || path?.startsWith(group.full_path + '/')
          nodes[identity.id] = existing || { ...identity, type: 'gitlab_issue', name: issue.title, projectPath: path,
            fullReference: issue.references?.full || `${path}#${issue.iid}`, inSelectedGroup: !!inGroup,
            externalToGroup: !inGroup, hierarchyReadOnly: true, _raw: issue }
          contains(key, identity.id)
        }
      } catch (error) {
        if (isAbort(error)) throw error
        loadWarnings.add('Some legacy epic issues could not be loaded. ' + warningFor(error))
      }
      // REST parent_id is a legacy Epic database ID, scoped with its group.
      for (const child of index.filter(e => e.parent_id != null && String(e.parent_id) === String(item.legacyId))) {
        if (lineage.has(child.id)) { loadWarnings.add('A hierarchy cycle was omitted.'); continue }
        if (visited.size >= maxItems) { loadWarnings.add('Hierarchy item limit reached; results are incomplete.'); break }
        contains(key, await visitLegacy(child, lineage))
      }
      return key
    }
    if (mode === 'workItems') await visit(epic)
    else { if (includeTasks) loadWarnings.add('Task expansion requires the Work Item API.'); await visitLegacy(epic) }
    aborted(signal)
    return { nodes, edges, warnings: [...loadWarnings], mode }
  }
  return { listEpics, loadEpic }
}
