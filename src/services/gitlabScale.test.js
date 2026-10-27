import { it, expect, vi } from 'vitest'
import { fetchGroupProjects, fetchGroupIssuesRest } from './gitlab'
import { selectSlice, presentSlice } from '../utils/groupSlices'
it('indexes 10,000 issues across 200 projects and caps the rendered graph', async () => {
  const source = { kind: 'group', idOrPath: 'team/core', includeSubgroups: true }
  const projects = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, open_issues_count: 50, path_with_namespace: 'team/p' + (i + 1) }))
  const issues = Array.from({ length: 10000 }, (_, i) => ({ id: i + 1, project_id: Math.floor(i / 50) + 1, iid: i % 50 + 1, state: 'opened', title: 'Issue ' + i, labels: ['Scope::Scale'] }))
  const client = { get: vi.fn(async (url, { params }) => {
    const all = url.endsWith('/projects') ? projects : issues
    const start = (params.page - 1) * 100
    return { data: all.slice(start, start + 100), headers: { 'x-next-page': start + 100 < all.length ? String(params.page + 1) : '' } }
  }) }
  const directory = await fetchGroupProjects(client, source)
  const indexed = await fetchGroupIssuesRest(client, source, directory)
  expect(Object.keys(directory)).toHaveLength(200); expect(indexed).toHaveLength(10000)
  expect(indexed.__glvPartial).toBe(false); expect(client.get).toHaveBeenCalledTimes(102)
  const nodes = Object.fromEntries(indexed.map(n => ['issue:' + n.id, { id: 'issue:' + n.id, type: 'gitlab_issue', projectId: n.project_id, state: n.state, _raw: n }]))
  const edges = Object.fromEntries(indexed.slice(1).map((n, i) => ['edge:' + i, { source: 'issue:' + (i % 200 + 1), target: 'issue:' + (Math.floor(i / 200) + 1), kind: 'issue_link', label: 'blocks' }]))
  const slice = selectSlice({ mode: 'scope', value: 'Scale', nodes, edges, hops: 0 })
  const shown = presentSlice(slice, slice.nodes, { nodeLimit: 200, edgeLimit: 400 })
  expect(slice.seeds).toHaveLength(10000)
  expect(Object.keys(shown.nodes)).toHaveLength(200)
  expect(Object.keys(shown.edges).length).toBeLessThanOrEqual(400)
  expect(shown.omittedNodes).toBe(9800)
  expect(shown.omittedEdges).toBeGreaterThan(0)
}, 10000)
