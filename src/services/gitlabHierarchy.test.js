import { describe, it, expect, vi } from 'vitest'
import { createHierarchyAdapter } from './gitlabHierarchy'

const source = { kind: 'group', idOrPath: 'a/core', includeSubgroups: true }
const connection = (nodes, endCursor = null) => ({ nodes, pageInfo: { hasNextPage: !!endCursor, endCursor } })
const item = (id, type = 'Epic', path = 'a/core', iid = 1) => ({ id: `gid://gitlab/WorkItem/${id}`, iid, title: `${type} ${id}`, workItemType: { name: type }, namespace: { fullPath: path }, ...(type !== 'Epic' ? { project: { fullPath: path } } : {}) })
const schema = () => ({ root: { queryType: { fields: [{ name: 'workItem' }] } },
  group: { fields: [{ name: 'workItems', args: ['types', 'first', 'after', 'includeDescendantGroups'].map(name => ({ name })) }] },
  item: { fields: ['id', 'iid', 'title', 'workItemType', 'widgets', 'project', 'namespace', 'state', 'webUrl'].map(name => ({ name })) },
  hierarchy: { fields: [{ name: 'children', args: ['first', 'after'].map(name => ({ name })) }] } })
function setup({ index = [item(1)], children = {}, capability = schema(), maxItems, restGet } = {}) {
  const rest = { get: vi.fn(async (url, config) => {
    if (restGet) { const result = await restGet(url, config); if (result) return result }
    if (url === '/groups/a%2Fcore') return { data: { id: 20, full_path: 'a/core' } }
    throw { response: { status: 403 } }
  }) }
  const graphql = { post: vi.fn(async (_, { query, variables }) => ({ data: { data:
    query.includes('HierarchyCapabilities') ? capability : query.includes('EpicIndex')
      ? { group: { workItems: typeof index === 'function' ? index(variables.after) : connection(index) } }
      : { workItem: { widgets: [{ __typename: 'WorkItemWidgetHierarchy', children: children[`${variables.id}:${variables.after}`] || children[variables.id] || connection([]) }] } }
  } })) }
  return { rest, graphql, adapter: createHierarchyAdapter('https://gitlab.test/api/v4', 'test', { rest, graphql, maxItems }) }
}
describe('epic hierarchy adapter', () => {
  it('recurses across projects, subgroups and external groups without importing sibling epics', async () => {
    const root = item(1), sub = item(2, 'Epic', 'a/core/sub'), sibling = item(9)
    const issues = [item(11, 'Issue', 'a/core/p1'), item(12, 'Issue', 'a/core/sub/p2'), item(13, 'Issue', 'other/p3')]
    const task = item(14, 'Task', 'a/core/p1', 2)
    const ctx = setup({ index: after => after ? connection([sibling]) : connection([root, sub], 'next'), children: {
      [root.id + ':null']: connection([sub, issues[0]], 'page2'), [root.id + ':page2']: connection([issues[2]]),
      [sub.id]: connection([issues[1]]), [issues[0].id]: connection([task])
    } })
    const listed = await ctx.adapter.listEpics(source)
    expect(listed.mode).toBe('workItems'); expect(listed.epics).toHaveLength(3)
    const base = { 'issue:900': { id: 'issue:900', projectPath: 'a/core/p1', iid: 1, type: 'gitlab_issue' } }
    const result = await ctx.adapter.loadEpic(root, source, base)
    expect(Object.keys(result.nodes)).toHaveLength(5)
    expect(result.nodes['issue:900']).toBe(base['issue:900'])
    expect(result.nodes[issues[2].id]).toMatchObject({ externalToGroup: true, hierarchyReadOnly: true })
    expect(result.nodes[sub.id]).toMatchObject({ namespacePath: 'a/core/sub', workItemGid: sub.id })
    expect(result.nodes[sibling.id]).toBeUndefined()
    expect(Object.values(result.edges).map(e => [e.source, e.target])).toEqual(expect.arrayContaining([[root.id, sub.id], [sub.id, issues[1].id], [root.id, 'issue:900'], [root.id, issues[2].id]]))
    expect(Object.values(result.edges).every(e => e.kind === 'contains')).toBe(true)
    const expanded = await ctx.adapter.loadEpic(root, source, base, { includeTasks: true })
    expect(expanded.nodes[task.id].kind).toBe('task')
    expect(expanded.edges[`contains:issue:900:${task.id}`]).toBeTruthy()
    expect(Object.keys(base)).toEqual(['issue:900'])
  })
  it('uses actual REST issue IDs for enrichment, never the WorkItem numeric ID', async () => {
    const root = item(1), issue = item(999, 'Issue', 'a/core/p', 7)
    const ctx = setup({ children: { [root.id]: connection([issue]) }, restGet: async url => url.includes('/projects/') ? { data: { id: 456, iid: 7, project_id: 12, title: 'Issue', references: { full: 'a/core/p#7' } } } : null })
    await ctx.adapter.listEpics(source)
    const result = await ctx.adapter.loadEpic(root, source, {})
    expect(result.nodes['issue:456']).toMatchObject({ gitlabId: 456, workItemGid: issue.id, projectPath: 'a/core/p' })
    expect(result.nodes['issue:999']).toBeUndefined()
    expect(ctx.rest.get.mock.calls.some(([url]) => url === '/projects/a%2Fcore%2Fp/issues/7')).toBe(true)
  })
  it('omits cycles and reports unavailable children and repeated cursors', async () => {
    const root = item(1), child = item(2)
    const ctx = setup({ children: { [root.id]: connection([child, null], 'same'), [child.id]: connection([root]) } })
    await ctx.adapter.listEpics(source)
    const result = await ctx.adapter.loadEpic(root, source, {})
    expect(Object.keys(result.edges)).toHaveLength(1)
    expect(result.warnings.join(' ')).toMatch(/cycle/)
    expect(result.warnings.join(' ')).toMatch(/unavailable child/)
    expect(result.warnings.join(' ')).toMatch(/pagination did not advance/)
  })
  it('bounds expansion and reports incomplete results', async () => {
    const root = item(1)
    const ctx = setup({ maxItems: 2, children: { [root.id]: connection([item(2), item(3)]) } })
    await ctx.adapter.listEpics(source)
    const result = await ctx.adapter.loadEpic(root, source, {})
    expect(Object.keys(result.nodes)).toHaveLength(2)
    expect(result.warnings.join(' ')).toMatch(/limit reached/)
  })
  it('supports sparse schemas by omitting unsupported optional fields', async () => {
    const cap = schema(); cap.item.fields = cap.item.fields.filter(f => !['state', 'webUrl', 'project'].includes(f.name))
    const ctx = setup({ capability: cap }); await ctx.adapter.listEpics(source)
    const query = ctx.graphql.post.mock.calls.find(([, body]) => body.query.includes('EpicIndex'))[1].query
    expect(query).not.toMatch(/\bstate\b|webUrl|project \{/)
  })
  it('falls back explicitly to legacy epics and preserves legacy identity and parentage', async () => {
    const epics = [{ id: 42, iid: 1, group_id: 20, title: 'Parent' }, { id: 43, iid: 1, group_id: 21, title: 'Child', parent_id: 42, references: { full: 'a/core/sub&1' } }]
    const ctx = setup({ capability: {}, restGet: async url => {
      if (url === '/groups/20/epics') return { data: epics }
      if (url === '/groups/20/epics/1/issues') return { data: [] }
      if (url === '/groups/21/epics/1/issues') return { data: [{ id: 800, iid: 1, project_id: 10, title: 'External', references: { full: 'other/p#1' } }] }
    } })
    const listed = await ctx.adapter.listEpics(source)
    expect(listed.mode).toBe('legacy'); expect(listed.warnings.join(' ')).toMatch(/Compatibility mode/)
    const result = await ctx.adapter.loadEpic(listed.epics[0], source, {}, { includeTasks: true })
    expect(result.nodes['legacy-epic:20:42'].workItemGid).toBeNull()
    expect(result.nodes['legacy-epic:21:43'].namespacePath).toBe('a/core/sub')
    expect(result.nodes['issue:800'].externalToGroup).toBe(true)
    expect(result.edges['contains:legacy-epic:20:42:legacy-epic:21:43']).toBeTruthy()
    expect(result.warnings.join(' ')).toMatch(/Task expansion requires/)
  })
  it('propagates cancellation without falling back to REST', async () => {
    const ctx = setup(); const controller = new AbortController(); controller.abort()
    await expect(ctx.adapter.listEpics(source, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.rest.get).not.toHaveBeenCalled()
  })
  it('accepts GitLab cached complete introspection schemas', async () => {
    const aliases = schema()
    const capability = { __schema: { queryType: { name: 'Query' }, types: [
      { name: 'Query', ...aliases.root.queryType }, { name: 'Group', ...aliases.group },
      { name: 'WorkItem', ...aliases.item }, { name: 'WorkItemWidgetHierarchy', ...aliases.hierarchy }
    ] } }
    const ctx = setup({ capability })
    const listed = await ctx.adapter.listEpics(source)
    expect(listed.mode).toBe('workItems')
    expect(listed.epics).toHaveLength(1)
  })
  it('bounds an oversized final index page and reports incomplete results', async () => {
    const ctx = setup({ maxItems: 2, index: [item(1), item(2), item(3)] })
    const listed = await ctx.adapter.listEpics(source)
    expect(listed.epics).toHaveLength(2)
    expect(listed.warnings.join(' ')).toMatch(/limit.*incomplete/)
  })
  it('rejects unexpected GraphQL responses without exposing their bodies', async () => {
    const ctx = setup({ restGet: async url => url === '/groups/20/epics' ? { data: [] } : null })
    ctx.graphql.post.mockResolvedValue({ data: '<html>private proxy response</html>' })
    const listed = await ctx.adapter.listEpics(source)
    expect(listed.mode).toBe('legacy')
    expect(listed.warnings.join(' ')).toMatch(/unexpected response/)
    expect(listed.warnings.join(' ')).not.toMatch(/private proxy/)
  })

})
