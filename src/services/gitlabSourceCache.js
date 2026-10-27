import localforage from 'localforage'
import { createGitLabClient, gitlabRequest, normalizeGitLabApiBaseUrl } from './gitlab'
import { credentialFingerprint } from '../utils/credentialFingerprint'
export const GITLAB_CACHE_SCHEMA = 3
export const CACHE_ACCESS_TTL_MS = 15 * 60 * 1000
export async function verifyGitLabAccess(config, signal) {
  if (!config.token) throw new Error('GitLab authentication is required to restore cached data.')
  const client = createGitLabClient(normalizeGitLabApiBaseUrl(config.gitlabApiBaseUrl), config.token)
  const user = (await gitlabRequest(client, 'get', '/user', { signal })).data
  if (user?.id == null) throw new Error('GitLab identity could not be verified.')
  const source = getGitLabSource(config)
  const scope = (await gitlabRequest(client, 'get', '/' + (source.kind === 'group' ? 'groups/' : 'projects/') + encodeURIComponent(source.idOrPath), { signal })).data
  return { userId: String(user.id), userName: user.name || '', fullPath: scope?.full_path || scope?.path_with_namespace || source.idOrPath }
}
export const getGitLabSource = (config) => ({
  kind: config.gitlabSourceKind === 'group' ? 'group' : 'project',
  idOrPath: String(config.gitlabSourceKind === 'group' ? config.groupId || '' : config.projectId || '').trim(),
  includeSubgroups: config.gitlabIncludeSubgroups !== false,
  includeShared: config.gitlabIncludeShared === true
})
export const gitlabSourceCacheKey = (config) => {
  const source = getGitLabSource(config)
  const origin = String(config.gitlabApiBaseUrl || '').trim().replace(/\/+$/, '').replace(/\/api\/v4$/, '')
  return 'gitlab:v' + GITLAB_CACHE_SCHEMA + ':' + JSON.stringify([origin, credentialFingerprint(String(config.token || '')), source.kind, source.idOrPath, source.includeSubgroups, source.includeShared])
}
export const validateGitLabSourceCache = (config, value) => {
  if (value?.schema !== GITLAB_CACHE_SCHEMA || value?.meta?.sourceKey !== gitlabSourceCacheKey(config) || !value.nodes || !value.edges) return false
  return Object.entries(value.nodes).every(([id, n]) => n && n.id === id && (n.type === 'svn_commit' || id.startsWith('svn-') || /^issue:|^project:.*:issue:/.test(id))) && Object.values(value.edges).every(e => value.nodes[e.source] && value.nodes[e.target])
}
export const readGitLabSourceCache = async (config) => {
  const identity = await verifyGitLabAccess(config)
  const value = await localforage.getItem(gitlabSourceCacheKey(config))
  return validateGitLabSourceCache(config, value) && value.meta.userId === identity.userId && Date.now() - (value.meta.fullValidatedAt || 0) < CACHE_ACCESS_TTL_MS ? value : null
}
export const writeGitLabSourceCache = async (config, value) => {
  const key = gitlabSourceCacheKey(config)
  const record = { ...value, schema: GITLAB_CACHE_SCHEMA, meta: { ...value.meta, sourceKey: key } }
  await localforage.setItem(key, record)
  return record.meta
}
export const clearGitLabSourceCache = config => localforage.removeItem(gitlabSourceCacheKey(config))
