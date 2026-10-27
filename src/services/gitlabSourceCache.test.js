import { describe, it, expect, vi } from 'vitest'
import localforage from 'localforage'
import { gitlabRequest, createGitLabClient } from './gitlab'
import { gitlabSourceCacheKey, writeGitLabSourceCache, readGitLabSourceCache, verifyGitLabAccess } from './gitlabSourceCache'
vi.mock('./gitlab', async importOriginal => ({ ...await importOriginal(), createGitLabClient: vi.fn(), gitlabRequest: vi.fn(async (_, method, path) => ({ data: path === '/user' ? { id: 1 } : { full_path: 'a', path_with_namespace: 'a/b' } })) }))
const config = { gitlabApiBaseUrl: 'https://gitlab.example/api/v4', token: 'secret-token', projectId: 'a/b', groupId: 'a', gitlabSourceKind: 'project' }
describe('source-scoped GitLab cache', () => {
  it('normalizes a configured GitLab host before verifying access', async () => {
    await verifyGitLabAccess({ ...config, gitlabApiBaseUrl: 'https://gitlab.example/' })
    expect(createGitLabClient).toHaveBeenLastCalledWith('https://gitlab.example/api/v4', config.token)
  })
  it('rejects token switches, changed identities, revoked access and stale permission validation', async () => {
    const record = { nodes: { 'issue:1': { id: 'issue:1' } }, edges: {}, meta: { userId: '1', fullValidatedAt: Date.now() } }
    await writeGitLabSourceCache(config, record)
    expect(await readGitLabSourceCache({ ...config, token: 'different-user-token' })).toBeNull()
    gitlabRequest.mockResolvedValueOnce({ data: { id: 2 } })
    expect(await readGitLabSourceCache(config)).toBeNull()
    gitlabRequest.mockRejectedValueOnce({ response: { status: 403 } })
    await expect(readGitLabSourceCache(config)).rejects.toBeTruthy()
    await writeGitLabSourceCache(config, { ...record, meta: { userId: '1', fullValidatedAt: Date.now() - 16 * 60000 } })
    expect(await readGitLabSourceCache(config)).toBeNull()
  })
  it('isolates host, source, subgroup, and shared-project settings', async () => {
    await localforage.clear()
    const nodes = { 'issue:1': { id: 'issue:1', type: 'gitlab_issue', projectId: 1, iid: 42 } }
    await writeGitLabSourceCache(config, { nodes, edges: {}, projects: { 1: { id: 1 } }, meta: { syncCursor: 'cursor', userId: '1', fullValidatedAt: Date.now() } })
    expect((await readGitLabSourceCache(config)).nodes).toEqual(nodes)
    for (const patch of [{ gitlabSourceKind: 'group' }, { gitlabApiBaseUrl: 'https://other.example' }, { projectId: 'a/c' }, { gitlabIncludeSubgroups: false }, { gitlabIncludeShared: true }]) {
      expect(gitlabSourceCacheKey({ ...config, ...patch })).not.toBe(gitlabSourceCacheKey(config))
      expect(await readGitLabSourceCache({ ...config, ...patch })).toBeNull()
    }
    expect((await readGitLabSourceCache(config)).meta.syncCursor).toBe('cursor')
  })
  it('round-trips duplicate IIDs through a JSON cache export', async () => {
    const groupConfig = { ...config, gitlabSourceKind: 'group', groupId: 'a' }
    const nodes = Object.fromEntries([1, 2].map(id => ['issue:' + id, { id: 'issue:' + id, projectId: id, iid: 42, fullReference: 'a/project-' + id + '#42' }]))
    await writeGitLabSourceCache(groupConfig, { nodes, edges: {}, projects: { 1: { id: 1 }, 2: { id: 2 } }, meta: { userId: '1', fullValidatedAt: Date.now() } })
    const exported = JSON.parse(JSON.stringify(await readGitLabSourceCache(groupConfig)))
    await localforage.clear()
    await writeGitLabSourceCache(groupConfig, exported)
    expect((await readGitLabSourceCache(groupConfig)).nodes).toEqual(nodes)
  })
  it('rejects legacy IID dictionaries and dangling edges', async () => {
    for (const value of [{ nodes: { 42: { id: '42' } }, edges: {} }, { nodes: { 'issue:1': { id: 'issue:1' } }, edges: { bad: { source: 'issue:1', target: '42' } } }]) {
      await writeGitLabSourceCache(config, value)
      expect(await readGitLabSourceCache(config)).toBeNull()
    }
  })
})
