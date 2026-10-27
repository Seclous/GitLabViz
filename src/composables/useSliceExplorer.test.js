import { describe, it, expect, vi } from 'vitest'
import { reactive, effectScope, nextTick } from 'vue'
import { useSliceExplorer } from './useSliceExplorer'

const issue = id => ({ id, iid: id, type: 'gitlab_issue', projectId: 1, projectPath: 'group/project', state: 'opened', _raw: { title: id } })
function setup() {
  const nodes = reactive({ a: issue('a'), b: issue('b'), c: issue('c') }), edges = reactive({})
  const hierarchy = reactive({ enabled: true, selectedId: '', epics: [], hierarchyNodes: {}, hierarchyEdges: {} })
  const relationships = reactive({ running: false, observations: {}, errors: {}, diagnostics: {}, scan: vi.fn(), cancel: vi.fn() })
  const config = reactive({ enableGitLab: true, gitlabSourceKind: 'group', groupId: 'group', gitlabApiBaseUrl: 'https://gitlab.test' })
  const scope = effectScope()
  const api = scope.run(() => useSliceExplorer({ config, nodes, edges, hierarchy, relationships, matchesFilters: () => true }))
  return { api, scope, nodes, edges, hierarchy, relationships }
}

describe('slice explorer state', () => {
  it('clears a selection when changing slice modes', () => {
    const { api, scope } = setup()
    api.mode.value = 'issue'; api.value.value = 'a'
    api.mode.value = 'scope'
    expect(api.value.value).toBe('')
    api.value.value = 'Design'
    api.mode.value = 'issue'
    expect(api.value.value).toBe('')
    scope.stop()
  })

  it('discovers the second frontier after the first dependency scan', async () => {
    const { api, scope, edges, relationships } = setup()
    api.mode.value = 'issue'; api.value.value = 'a'; api.hops.value = 2; await nextTick()
    relationships.scan.mockImplementation(async ({ seedNodes }) => {
      if (seedNodes.some(n => n.id === 'b')) edges.cb = { source: 'c', target: 'b', kind: 'issue_link', label: 'blocks' }
      else edges.ba = { source: 'b', target: 'a', kind: 'issue_link', label: 'blocks' }
    })
    await api.enrich()
    expect(relationships.scan.mock.calls.map(([arg]) => arg.seedNodes.map(n => n.id).sort())).toEqual([['a'], ['a', 'b']])
    expect(Object.keys(api.slice.value.nodes).sort()).toEqual(['a', 'b', 'c'])
    expect(api.enriching.value).toBe(false); scope.stop()
  })

  it('does not start a second scan after the selected slice changes', async () => {
    const { api, scope, relationships } = setup()
    api.mode.value = 'issue'; api.value.value = 'a'; api.hops.value = 2; await nextTick()
    let finish
    relationships.scan.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = api.enrich()
    api.value.value = 'c'; await nextTick(); finish(); await pending
    expect(relationships.scan).toHaveBeenCalledTimes(1)
    expect(api.enriching.value).toBe(false); scope.stop()
  })

  it('searches the full index and terminates cyclic parent breadcrumbs', async () => {
    const { api, scope, nodes, hierarchy } = setup()
    hierarchy.epics = [{ id: 'e1', iid: 1, title: 'Parent', parentId: 'e2' }, { id: 'e2', iid: 2, title: 'Child', parentId: 'e1' }]
    hierarchy.selectedId = 'e2'; hierarchy.hierarchyNodes = { a: nodes.a }
    nodes.c._raw.title = 'Outside active epic'; api.query.value = 'Outside active'; await nextTick()
    expect(api.searchResults.value.map(n => n.id)).toEqual(['c'])
    expect(api.breadcrumbs.value.map(n => n.id)).toEqual(['e1', 'e2'])
    scope.stop()
  })
})
