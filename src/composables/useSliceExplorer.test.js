import { describe, it, expect, vi } from 'vitest'
import { reactive, ref, effectScope, nextTick } from 'vue'
import { useSliceExplorer } from './useSliceExplorer'

const issue = id => ({ id, iid: id, type: 'gitlab_issue', projectId: 1, projectPath: 'group/project', state: 'opened', _raw: { title: id } })
function setup(settings = reactive({ uiState: { ui: {}, view: {} } })) {
  const nodes = reactive({ a: issue('a'), b: issue('b'), c: issue('c') }), edges = reactive({})
  const hierarchy = reactive({ enabled: true, selectedId: '', epics: [], hierarchyNodes: {}, hierarchyEdges: {} })
  const relationships = reactive({ running: false, observations: {}, errors: {}, diagnostics: {}, scan: vi.fn(), cancel: vi.fn() })
  const config = reactive({ enableGitLab: true, gitlabSourceKind: 'group', groupId: 'group', gitlabApiBaseUrl: 'https://gitlab.test' })
  const scope = effectScope()
  const cacheMeta = ref({ projects: { 1: { id: 1, path_with_namespace: 'group/project' }, 2: { id: 2, path_with_namespace: 'group/sub/api' } } })
  const api = scope.run(() => useSliceExplorer({ config, settings, cacheMeta, nodes, edges, hierarchy, relationships, matchesFilters: () => true }))
  return { api, scope, nodes, edges, hierarchy, relationships, settings, config }
}

describe('slice explorer state', () => {
  it('defaults to all primary issues, bounds large graphs and leaves lists complete', () => {
    const { api, scope, nodes, settings } = setup()
    for (let i = 0; i < 300; i++) nodes['n' + i] = issue('n' + i)
    nodes.external = { ...issue('external'), externalContext: true }
    expect(api.mode.value).toBe('all')
    expect(api.slice.value.seeds).toHaveLength(303)
    expect(Object.keys(api.presentation.value.nodes)).toHaveLength(200)
    api.nodeLimit.value += 100
    expect(Object.keys(api.presentation.value.nodes)).toHaveLength(300)
    api.renderAll.value = true
    expect(Object.keys(api.presentation.value.nodes)).toHaveLength(303)
    api.renderAll.value = false; settings.uiState.view.layout = 'list'
    expect(Object.keys(api.presentation.value.nodes)).toHaveLength(303)
    scope.stop()
  })
  it('browses the cached directory instantly and persists collapse and selection', async () => {
    const { api, scope, nodes, settings, relationships } = setup()
    nodes.d = { ...issue('d'), projectId: 2, projectPath: 'group/sub/api' }
    api.browse.value = 'group/sub'; api.mode.value = 'issue'; api.value.value = 'd'
    api.expanded.value = false; await nextTick()
    expect(api.slice.value.seeds).toEqual(['d'])
    expect(relationships.scan).not.toHaveBeenCalled()
    scope.stop()
    const restored = setup(settings)
    expect(restored.api.expanded.value).toBe(false)
    expect(restored.api.browse.value).toBe('group/sub')
    expect(restored.api.mode.value).toBe('issue')
    expect(restored.api.value.value).toBe('d')
    restored.api.browse.value = ''
    expect(restored.api.mode.value).toBe('all')
    expect(restored.api.slice.value.seeds).toHaveLength(3)
    restored.scope.stop()
  })
  it('keeps an empty blocked lens explicitly partial when only two issues are fresh', () => {
    const { api, scope, nodes, relationships } = setup()
    for (let i = 3; i < 100; i++) nodes['n' + i] = issue('n' + i)
    relationships.observations = { a: { at: Date.now(), links: [] }, b: { at: Date.now(), links: [] } }
    api.mode.value = 'blocked'
    expect(api.counts.value).toMatchObject({ indexed: 100, fresh: 2, required: 100, unscanned: 98, blocked: 0, complete: false })
    scope.stop()
  })
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
    api.mode.value = 'epic'
    expect(api.breadcrumbs.value.map(n => n.id)).toEqual(['e1', 'e2'])
    scope.stop()
  })
})
