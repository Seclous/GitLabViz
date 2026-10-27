import { describe, it, expect, vi } from 'vitest'
import { reactive, effectScope, nextTick } from 'vue'
import { useEpicHierarchy } from './useEpicHierarchy'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const epic = { id: 'gid://gitlab/WorkItem/1', title: 'Epic' }
function setup() {
  const config = reactive({ enableGitLab: true, gitlabSourceKind: 'group', groupId: 'a/core', token: 'test', gitlabApiBaseUrl: 'https://gitlab.test' })
  const adapter = { listEpics: vi.fn(async () => ({ epics: [epic], mode: 'workItems', warnings: [] })), loadEpic: vi.fn(async () => ({ nodes: { a: { id: 'a' } }, edges: {}, warnings: [] })) }
  const scope = effectScope()
  const api = scope.run(() => useEpicHierarchy({ config, nodes: {}, resolveBaseUrl: () => 'https://gitlab.test/api/v4', createAdapter: () => adapter }))
  return { config, adapter, scope, api }
}
describe('epic hierarchy state', () => {
  it('refreshes the selected epic without losing selection', async () => {
    const { api, scope } = setup()
    await api.refresh(); api.selectedId.value = epic.id; await nextTick()
    await api.refresh()
    expect(api.indexReady.value).toBe(true)
    expect(api.selectedId.value).toBe(epic.id)
    expect(api.loading.value).toBe(false)
    expect(api.hierarchyNodes.value).toEqual({ a: { id: 'a' } }); scope.stop()
  })
  it('ignores late selection responses after cancellation', async () => {
    const { api, adapter, scope } = setup(); await api.refresh()
    const pending = deferred(); adapter.loadEpic.mockReturnValue(pending.promise)
    api.selectedId.value = epic.id
    const signal = adapter.loadEpic.mock.calls[0][3].signal
    api.cancel(); pending.resolve({ nodes: { stale: {} }, edges: {}, warnings: [] }); await nextTick()
    expect(signal.aborted).toBe(true)
    expect(api.hierarchyNodes.value).toEqual({}); expect(api.selectedId.value).toBeNull(); scope.stop()
  })
  it('invalidates the index and ignores discovery responses on source switches', async () => {
    const { api, adapter, config, scope } = setup(); const pending = deferred()
    adapter.listEpics.mockReturnValue(pending.promise)
    const run = api.refresh(); await nextTick()
    config.groupId = 'different/group'; await nextTick()
    pending.resolve({ epics: [epic], mode: 'workItems', warnings: [] }); await run
    expect(api.indexReady.value).toBe(false); expect(api.epics.value).toEqual([]); expect(api.loading.value).toBe(false); scope.stop()
  })
})
