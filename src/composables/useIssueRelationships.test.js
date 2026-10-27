import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref, computed, defineComponent } from 'vue'
import { useIssueRelationships } from './useIssueRelationships'
import { fetchIssueLinks } from '../services/gitlab'
import localforage from 'localforage'
vi.mock('../services/gitlab', () => ({ createGitLabClient: vi.fn(() => ({})), fetchIssueLinks: vi.fn() }))
vi.mock('localforage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) } }))
let wrapper
function setup(count = 2) {
  const config = reactive({ enableGitLab: true, gitlabSourceKind: 'group', groupId: 'a/b', gitlabApiBaseUrl: 'https://gitlab.test', token: 'test' })
  const nodes = reactive(Object.fromEntries(Array.from({ length: count }, (_, i) => ['issue:' + i, { id: 'issue:' + i, type: 'gitlab_issue', projectId: i + 10, iid: 7, state: 'opened' }])))
  const edges = reactive({})
  let api
  wrapper = mount(defineComponent({ setup() { api = useIssueRelationships({ config, nodes, edges, visibleNodes: computed(() => nodes), loading: ref(false), resolveBaseUrl: () => 'https://gitlab.test/api/v4' }); return () => null } }))
  return { get api() { return api }, config, nodes, edges }
}
beforeEach(() => { vi.clearAllMocks(); fetchIssueLinks.mockResolvedValue([]); localforage.getItem.mockResolvedValue(null) })
afterEach(() => wrapper?.unmount())
describe('bounded relationship indexing', () => {
  it('does not cancel a pending cache restore when no scan is running', async () => {
    let restore;
    localforage.getItem.mockImplementationOnce(() => new Promise(resolve => { restore = resolve }));
    const ctx = setup();
    ctx.api.cancel();
    restore({ observations: { 'issue:0': { at: Date.now(), links: [] } }, errors: {} });
    await flushPromises();
    expect(ctx.api.freshCount.value).toBe(1);
    await ctx.api.scan({ full: true });
    expect(fetchIssueLinks).toHaveBeenCalledTimes(1);
  });
  it('routes by each issue project and IID, caches fresh scans, and refresh removes deleted links', async () => {
    const ctx = setup(); await flushPromises()
    fetchIssueLinks.mockImplementation(async (_, pid) => pid === 10 ? [{ id: 1, project_id: 11, iid: 7, link_type: 'blocks' }] : [])
    await ctx.api.scan({ full: true })
    expect(fetchIssueLinks.mock.calls.map(c => c.slice(1, 3))).toEqual([[10, 7], [11, 7]])
    expect(ctx.api.summary.value.blocked.size).toBe(1)
    await ctx.api.scan({ full: true }); expect(fetchIssueLinks).toHaveBeenCalledTimes(2)
    fetchIssueLinks.mockResolvedValue([])
    await ctx.api.scan({ full: true, force: true }); expect(Object.keys(ctx.edges)).toHaveLength(0)
    expect(localforage.setItem).toHaveBeenCalled()
  })
  it('reports failed issues without marking them indexed and retries them', async () => {
    const ctx = setup(); await flushPromises()
    fetchIssueLinks.mockRejectedValueOnce({ response: { status: 403 } })
    await ctx.api.scan({ full: true })
    expect(ctx.api.errors.value['issue:0']).toBe('HTTP 403')
    expect(ctx.api.indexedCount.value).toBe(1)
    await ctx.api.scan({ full: true, retry: true })
    expect(Object.keys(ctx.api.errors.value)).toHaveLength(0)
    expect(ctx.api.indexedCount.value).toBe(2)
  })
  it('limits concurrency to four, and ignores cancelled or switched-source responses', async () => {
    const ctx = setup(12); await flushPromises()
    const pending = []; fetchIssueLinks.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const scan = ctx.api.scan({ full: true })
    expect(pending).toHaveLength(4)
    ctx.api.cancel()
    pending.forEach(resolve => resolve([{ id: 11, project_id: 21, iid: 7, link_type: 'blocks' }]))
    await scan; expect(ctx.api.indexedCount.value).toBe(0); expect(Object.keys(ctx.edges)).toHaveLength(0)
    const next = ctx.api.scan({ full: true }); ctx.config.groupId = 'other'; await flushPromises()
    pending.slice(4).forEach(resolve => resolve([])); await next
    expect(ctx.api.indexedCount.value).toBe(0)
  })
  it('caps visible scans at 100 requests and states that coverage is partial', async () => {
    const ctx = setup(110); await flushPromises(); await ctx.api.scan()
    expect(fetchIssueLinks).toHaveBeenCalledTimes(100)
    expect(ctx.api.indexedCount.value).toBe(100)
    expect(ctx.api.message.value).toContain('budget')
  })
  it('rejects malformed link responses and remains usable when cache storage fails', async () => {
    localforage.getItem.mockRejectedValueOnce(new Error('Storage unavailable'))
    const ctx = setup(); await flushPromises()
    expect(ctx.api.cacheWarning.value).toContain('unavailable')
    fetchIssueLinks.mockResolvedValueOnce({ error: 'Unexpected payload' })
    localforage.setItem.mockRejectedValueOnce(new Error('Storage full'))
    await ctx.api.scan({ full: true })
    expect(ctx.api.indexedCount.value).toBe(1)
    expect(ctx.api.errors.value['issue:0']).toBe('Request failed')
    expect(ctx.api.running.value).toBe(false)
    expect(ctx.api.cacheWarning.value).toContain('could not be saved')
    await ctx.api.scan({ full: true, retry: true })
    expect(ctx.api.indexedCount.value).toBe(2)
    expect(ctx.api.cacheWarning.value).toBe('')
  })
  it('restores stale observations while refreshing links independently', async () => {
    localforage.getItem.mockResolvedValueOnce({ observations: { 'issue:0': { at: 1, links: [] } } })
    const ctx = setup(); await flushPromises()
    expect(ctx.api.indexedCount.value).toBe(1)
    expect(ctx.api.freshCount.value).toBe(0)
    await ctx.api.scan({ full: true })
    expect(fetchIssueLinks).toHaveBeenCalledTimes(2)
    expect(ctx.api.freshCount.value).toBe(2)
  })

})

it('ignores an older cancelled scan after a new same-source scan completes', async () => {
  const ctx = setup(1); await flushPromises()
  let release
  fetchIssueLinks.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const oldScan = ctx.api.scan({ full: true, force: true })
  await flushPromises(); ctx.api.cancel()
  fetchIssueLinks.mockResolvedValue([])
  await ctx.api.scan({ full: true, force: true })
  const writes = localforage.setItem.mock.calls.length
  release([{ id: 999, project_id: 99, iid: 1, title: 'Old context', link_type: 'blocks' }])
  await oldScan
  expect(localforage.setItem).toHaveBeenCalledTimes(writes)
  expect(Object.values(ctx.nodes).some(n => n.externalContext)).toBe(false)
  expect(ctx.api.observations.value['issue:0'].links).toEqual([])
})
it('drops a cached successful observation when access is revoked', async () => {
  const ctx = setup(1); await flushPromises()
  await ctx.api.scan({ full: true })
  expect(ctx.api.freshCount.value).toBe(1)
  fetchIssueLinks.mockRejectedValueOnce({ response: { status: 403 } })
  await ctx.api.scan({ full: true, force: true })
  expect(ctx.api.observations.value['issue:0']).toBeUndefined()
  expect(ctx.api.freshCount.value).toBe(0)
  expect(ctx.api.errors.value['issue:0']).toBe('HTTP 403')
})
it('discards malformed cached relationship observations', async () => {
  localforage.getItem.mockResolvedValueOnce({ observations: { bad: { at: 1, links: {} }, good: { at: Date.now(), links: [] } } })
  const ctx = setup(1); await flushPromises()
  expect(Object.keys(ctx.api.observations.value)).toEqual(['good'])
})
