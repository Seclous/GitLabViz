import { describe, expect, it, vi } from 'vitest'
import { probeGitLabCapabilities } from './gitlabCapabilities'

function client() {
  return {
    defaults: { baseURL: 'https://example.test/api/v4' },
    get: vi.fn(async path => ({ data: path === '/version' ? { version: '18.0' }
      : path.endsWith('/projects') || path.endsWith('/issues') ? [] : { id: 1 } })),
    post: vi.fn(async () => ({ data: { data: {
      groupType: { fields: [{ name: 'workItems' }] },
      hierarchyType: { fields: [{ name: 'children' }] }
    } } }))
  }
}

describe('read-only GitLab capability diagnostics', () => {
  it('encodes group paths and checks REST access and hierarchy separately', async () => {
    const api = client()
    expect((await probeGitLabCapabilities(api, 'parent/subgroup')).map(check => check.status))
      .toEqual(Array(5).fill('available'))
    expect(api.get).toHaveBeenCalledWith('/groups/parent%2Fsubgroup')
    expect(api.post.mock.calls[0][0]).toBe('https://example.test/api/graphql')
    expect(api.post.mock.calls[0][1].query).toContain('groupType: __type(name: "Group")')
    expect(api.get.mock.calls[3][1].params).toEqual({ scope: 'all', state: 'all', per_page: 1 })
  })
  it('leaves missing hierarchy fields unconfirmed', async () => {
    const api = client()
    api.post.mockResolvedValue({ data: { data: {
      groupType: { fields: [{ name: 'workItems' }] },
      hierarchyType: { fields: [] }
    } } })
    expect((await probeGitLabCapabilities(api, 'g')).at(-1).status).toBe('unknown')
  })
  it('does not confuse permissions, missing routes, transport errors or schema errors', async () => {
    const api = client()
    api.get.mockRejectedValueOnce({ response: { status: 403, data: 'secret' } })
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce(new Error('secret'))
      .mockRejectedValueOnce({ response: { status: 429 } })
    api.post.mockResolvedValue({ data: { errors: [{ message: 'secret' }] } })
    const report = await probeGitLabCapabilities(api, 'g')
    expect(report.map(check => check.status)).toEqual(['denied', 'unavailable', 'failed', 'rate limited', 'unknown'])
    expect(JSON.stringify(report)).not.toContain('secret')
  })
  it('requires a group before making requests', async () => {
    const api = client()
    await expect(probeGitLabCapabilities(api, ' ')).rejects.toThrow('group')
    expect(api.get).not.toHaveBeenCalled()
  })
})
