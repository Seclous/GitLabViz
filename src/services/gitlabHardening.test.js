import { describe, it, expect, vi, afterEach } from 'vitest'
import { gitlabRequest, fetchGroupProjects, fetchGroupIssuesRest } from './gitlab'
import { nextRestPage } from './gitlabPagination'
const source = { kind: 'group', idOrPath: 'team/core', includeSubgroups: true }
const denied = status => Object.assign(new Error('HTTP ' + status), { response: { status, headers: {} } })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('GitLab hardening', () => {
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
    const projects = Object.fromEntries(Array.from({ length: 200 }, (_, id) => [id, { id }]))
    const issues = await fetchGroupIssuesRest(client, source, projects, null, { maxRequests: 3 })
    expect(client.get).toHaveBeenCalledTimes(3); expect(issues.__glvPartial).toBe(true)
  })
})
