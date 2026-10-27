import { describe, it, expect, vi, afterEach } from 'vitest'
import { gitlabRequest, fetchGroupProjects, fetchGroupIssuesRest, fetchIssueLinks } from './gitlab'
import { nextRestPage } from './gitlabPagination'
const source = { kind: 'group', idOrPath: 'team/core', includeSubgroups: true }
const denied = status => Object.assign(new Error('HTTP ' + status), { response: { status, headers: {} } })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('GitLab hardening', () => {
  it('follows issue-link pagination and respects the shared request bound and cancellation', async () => {
    const controller = new AbortController()
    const client = { get: vi.fn(async (_, options) => ({ data: [{ id: options.params.page }], headers: { 'x-next-page': options.params.page === 1 ? '2' : '' } })) }
    expect(await fetchIssueLinks(client, 11, 42, { signal: controller.signal })).toEqual([{ id: 1 }, { id: 2 }])
    expect(client.get.mock.calls.map(call => call[1].params.page)).toEqual([1, 2])
    expect(client.get.mock.calls.every(call => call[1].signal === controller.signal)).toBe(true)
    await expect(fetchIssueLinks(client, 11, 42, { maxRequests: 1 })).rejects.toThrow()
    controller.abort(); client.get.mockClear()
    await expect(fetchIssueLinks(client, 11, 42, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.get).not.toHaveBeenCalled()
  })
  it('bounds rate-limit retries and observes Retry-After', async () => {
    vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = denied(429); error.response.headers['retry-after'] = '2'
    const client = { get: vi.fn().mockRejectedValue(error) }
    const result = gitlabRequest(client, 'get', '/issues').catch(e => e)
    await vi.advanceTimersByTimeAsync(1999); expect(client.get).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync(); expect(await result).toBe(error)
    expect(client.get).toHaveBeenCalledTimes(4)
  })
  it('cancels during rate-limit backoff immediately without another request', async () => {
    vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = denied(429); error.response.headers['retry-after'] = '60'
    const controller = new AbortController(), client = { get: vi.fn().mockRejectedValue(error) }
    const result = gitlabRequest(client, 'get', '/issues', { signal: controller.signal }).catch(e => e)
    await vi.advanceTimersByTimeAsync(0); controller.abort()
    expect((await result).name).toBe('AbortError'); expect(client.get).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not retry permissions failures or claim complete issue coverage', async () => {
    const client = { get: vi.fn().mockRejectedValue(denied(403)) }
    const result = await fetchGroupIssuesRest(client, source, { 1: { id: 1, open_issues_count: 0 } })
    expect(client.get).toHaveBeenCalledTimes(1)
    expect(result.__glvPartial).toBe(true); expect(result.__glvWarnings.join(' ')).toContain('403')
  })
  it('stops non-advancing pagination and malformed responses', async () => {
    const client = { get: vi.fn(async () => ({ data: [{ id: 1 }], headers: { 'X-Next-Page': '1' } })) }
    const result = await fetchGroupProjects(client, source)
    expect(client.get).toHaveBeenCalledTimes(1); expect(result.__glvPartial).toBe(true)
    expect(() => nextRestPage({ data: {} }, 1)).toThrow('Unexpected')
  })
  it('bounds an endless directory and shares the issue budget with fallbacks', async () => {
    const client = { get: vi.fn(async () => ({ data: Array.from({ length: 100 }, (_, id) => ({ id })), headers: {} })) }
    const directory = await fetchGroupProjects(client, source, { maxRequests: 3 })
    expect(directory.__glvPartial).toBe(true); expect(client.get).toHaveBeenCalledTimes(3)
    client.get.mockClear(); client.get.mockResolvedValue({ data: [], headers: {} })
    const projects = Object.fromEntries(Array.from({ length: 200 }, (_, id) => [id, { id, open_issues_count: 1 }]))
    const issues = await fetchGroupIssuesRest(client, source, projects, null, { maxRequests: 3 })
    expect(client.get).toHaveBeenCalledTimes(3); expect(issues.__glvPartial).toBe(true)
  })
  it('does not fan out across 200 ordinary projects for deltas or closed history', async () => {
    const client = { get: vi.fn(async () => ({ data: [], headers: {} })) }
    const projects = Object.fromEntries(Array.from({ length: 200 }, (_, id) => [id, { id, open_issues_count: 99 }]))
    for (const params of [{ state: 'opened', updated_after: '2026-10-01' }, { state: 'closed' }, { state: 'all' }]) {
      client.get.mockClear()
      const { state, ...query } = params
      const result = await fetchGroupIssuesRest(client, source, projects, null, { state, params: query })
      expect(client.get).toHaveBeenCalledTimes(1)
      expect(result.__glvPartial).toBe(false)
    }
  })
})
