import localforage from 'localforage'
export const GITLAB_CACHE_SCHEMA = 2
export const getGitLabSource = (config) => ({
  kind: config.gitlabSourceKind === 'group' ? 'group' : 'project',
  idOrPath: String(config.gitlabSourceKind === 'group' ? config.groupId || '' : config.projectId || '').trim(),
  includeSubgroups: config.gitlabIncludeSubgroups !== false,
  includeShared: config.gitlabIncludeShared === true
})
export const gitlabSourceCacheKey = (config) => {
  const source = getGitLabSource(config)
  const origin = String(config.gitlabApiBaseUrl || '').trim().replace(/\/+$/, '').replace(/\/api\/v4$/, '')
  return 'gitlab:v' + GITLAB_CACHE_SCHEMA + ':' + JSON.stringify([origin, source.kind, source.idOrPath, source.includeSubgroups, source.includeShared])
}
export const validateGitLabSourceCache = (config, value) => {
  if (value?.schema !== GITLAB_CACHE_SCHEMA || value?.meta?.sourceKey !== gitlabSourceCacheKey(config) || !value.nodes || !value.edges) return false
  return Object.entries(value.nodes).every(([id, n]) => n && n.id === id && (n.type === 'svn_commit' || id.startsWith('svn-') || /^issue:|^project:.*:issue:/.test(id))) && Object.values(value.edges).every(e => value.nodes[e.source] && value.nodes[e.target])
}
export const readGitLabSourceCache = async (config) => {
  const value = await localforage.getItem(gitlabSourceCacheKey(config))
  return validateGitLabSourceCache(config, value) ? value : null
}
export const writeGitLabSourceCache = async (config, value) => {
  const key = gitlabSourceCacheKey(config)
  const record = { ...value, schema: GITLAB_CACHE_SCHEMA, meta: { ...value.meta, sourceKey: key } }
  await localforage.setItem(key, record)
  return record.meta
}
export const clearGitLabSourceCache = config => localforage.removeItem(gitlabSourceCacheKey(config))
