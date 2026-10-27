import { computed, ref, watch, onBeforeUnmount, toRaw } from 'vue'
import localforage from 'localforage'
import { createGitLabClient, fetchIssueLinks } from '../services/gitlab'
import { gitlabSourceCacheKey, getGitLabSource, verifyGitLabAccess, CACHE_ACCESS_TTL_MS } from '../services/gitlabSourceCache'
import { assembleRelationships, dependencySummary, RELATIONSHIP_TTL_MS } from '../utils/issueRelationships'

export function useIssueRelationships({ config, nodes, edges, visibleNodes, loading, resolveBaseUrl, projectDirectory = null }) {
  const running = ref(false), completed = ref(0), total = ref(0), errors = ref({}), observations = ref({})
  const message = ref('Relationships have not been indexed.'), diagnostics = ref({}), cacheWarning = ref('')
  const contextSeeds = {}
  const now = ref(Date.now())
  const freshnessTimer = setInterval(() => { now.value = Date.now() }, 60000)
  let verifiedIdentity = null, validatedAt = 0
  let generation = 0, controller, timer, ready = false, cacheWrite = Promise.resolve()
  const sourceKey = computed(() => gitlabSourceCacheKey(config))
  const primary = computed(() => Object.values(nodes).filter(n => n.type === 'gitlab_issue' && !n.externalContext))
  const summary = computed(() => dependencySummary(nodes, edges))
  const freshCount = computed(() => primary.value.filter(n => !errors.value[n.id] && now.value - (observations.value[n.id]?.at || 0) < RELATIONSHIP_TTL_MS).length)
  const indexedCount = computed(() => primary.value.filter(n => observations.value[n.id]).length)
  function apply() {
    const base = Object.fromEntries(primary.value.map(n => [n.id, n]))
    const next = assembleRelationships({ ...contextSeeds, ...base }, observations.value, { maxHops: 2, projectDirectory: projectDirectory?.value || {} })
    for (const [id, edge] of Object.entries(edges)) if (edge.kind === 'issue_link') delete edges[id]
    for (const [id, node] of Object.entries(nodes)) if (node.externalContext) delete nodes[id]
    Object.assign(nodes, Object.fromEntries(Object.entries(contextSeeds).filter(([id]) => !base[id]).map(([id, n]) => [id, { ...n, externalContext: true }])));
    Object.assign(nodes, next.external); Object.assign(edges, next.edges); diagnostics.value = next.diagnostics
  }
  function commit(key, revision) {
    if (key !== sourceKey.value || revision !== generation) return Promise.resolve()
    apply()
    const record = JSON.parse(JSON.stringify({ observations: toRaw(observations.value), errors: toRaw(errors.value), userId: verifiedIdentity?.userId, validatedAt }))
    // Writes are serialized: a completed older scan can never overwrite a newer snapshot.
    cacheWrite = cacheWrite.catch(() => {}).then(() => {
      if (key === sourceKey.value) return localforage.setItem('relationships:v2:' + key, record)
    }).then(() => { cacheWarning.value = '' }).catch(() => { cacheWarning.value = 'Relationship cache could not be saved; current results remain available.' })
    return cacheWrite
  }
  function cancel() {
    if (!running.value) return
    const key = sourceKey.value
    generation++; controller?.abort(); running.value = false
    void commit(key, generation)
    message.value = 'Cancelled. Completed requests are retained; coverage is partial.'
  }
  async function scan({ full = false, force = false, retry = false, seedNodes = null } = {}) {
    if (running.value || loading.value || !ready || !config.enableGitLab || !config.token) return
    if (Date.now() - validatedAt >= CACHE_ACCESS_TTL_MS) {
      const key = sourceKey.value, revision = generation
      ready = false
      try {
        const identity = await verifyGitLabAccess({ ...config, gitlabApiBaseUrl: resolveBaseUrl() })
        if (key !== sourceKey.value || revision !== generation) return
        if (identity.userId !== verifiedIdentity?.userId) throw new Error('Identity changed')
        verifiedIdentity = identity; validatedAt = Date.now(); ready = true
        observations.value = {}; errors.value = {}
        for (const id of Object.keys(contextSeeds)) delete contextSeeds[id]
        apply()
      } catch {
        if (key !== sourceKey.value || revision !== generation) return
        observations.value = {}; errors.value = {}
        for (const id of Object.keys(contextSeeds)) delete contextSeeds[id]
        apply()
        cacheWarning.value = 'GitLab access could not be verified. Refresh the source before scanning relationships.'
        return
      }
    }
    const candidates = seedNodes || (full ? primary.value : Object.values(visibleNodes.value).filter(n => n.type === 'gitlab_issue' && !n.externalContext))
    const max = full ? 2000 : 100
    const eligible = candidates.filter(n => n.projectId != null && n.iid != null).filter(n => retry ? errors.value[n.id] : force || errors.value[n.id] || Date.now() - (observations.value[n.id]?.at || 0) >= RELATIONSHIP_TTL_MS)
    const seeds = eligible.slice(0, max)
    for (const n of seeds) if (!nodes[n.id] && Object.keys(contextSeeds).length < 200) contextSeeds[n.id] = n
    if (!seeds.length) { message.value = 'Visible relationships are fresh (15 minute TTL). Refresh to check again.'; return }
    const revision = ++generation, key = sourceKey.value
    const client = createGitLabClient(resolveBaseUrl(), config.token)
    controller = new AbortController(); running.value = true; completed.value = 0; total.value = seeds.length
    message.value = eligible.length > max ? 'Request budget reached; narrow the view to index the remaining issues.' : 'Indexing issue links…'
    let cursor = 0
    async function worker() {
      while (cursor < seeds.length && revision === generation) {
        const node = seeds[cursor++]
        try {
          const links = await fetchIssueLinks(client, node.projectId || node._raw?.project_id, node.iid, { signal: controller.signal })
          if (revision !== generation || key !== sourceKey.value) return
          if (!Array.isArray(links)) throw new Error('Unexpected issue links response')
          now.value = Date.now()
          observations.value[node.id] = { at: now.value, links: links.map(link => ({
            id: link.id, project_id: link.project_id, iid: link.iid, title: link.title, state: link.state,
            web_url: link.web_url, references: link.references, link_type: link.link_type, issue_link_id: link.issue_link_id
          })) }
          delete errors.value[node.id]
        } catch (error) {
          if (revision !== generation) return
          const status = error?.response?.status
          if (status === 403 || status === 404) delete observations.value[node.id]
          errors.value[node.id] = status ? 'HTTP ' + status : 'Request failed'
        }
        completed.value++
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, seeds.length) }, worker))
    } finally {
      // Cancellation retains successful work but a source change never applies old results.
      if (revision === generation && key === sourceKey.value) {
        await commit(key, revision)
      }
      if (revision === generation) {
        running.value = false
        message.value = eligible.length > max ? 'Partial: request budget reached. Narrow the view for remaining issues.' : Object.keys(errors.value).length ? 'Partial: some issues could not be read. Retry failed requests.' : 'Relationship scan complete. Indexed context supports up to two dependency hops and 100 external issues.'
      }
    }
  }
  watch(sourceKey, async () => {
    generation++; controller?.abort(); clearTimeout(timer); running.value = false; ready = false
    for (const id of Object.keys(contextSeeds)) delete contextSeeds[id]
    observations.value = {}; errors.value = {}; completed.value = 0; total.value = 0
    message.value = 'Relationships have not been indexed.'
    for (const [id, edge] of Object.entries(edges)) if (edge.kind === 'issue_link') delete edges[id]
    for (const [id, node] of Object.entries(nodes)) if (node.externalContext) delete nodes[id]
    verifiedIdentity = null; validatedAt = 0
    const key = sourceKey.value, revision = generation
    if (!config.enableGitLab || !config.token) return
    let record
    cacheWarning.value = ''
    try {
      const identity = await verifyGitLabAccess({ ...config, gitlabApiBaseUrl: resolveBaseUrl() })
      if (revision !== generation || key !== sourceKey.value) return
      verifiedIdentity = identity; validatedAt = Date.now()
    }
    catch { if (key === sourceKey.value) { cacheWarning.value = 'GitLab access could not be verified. Relationship cache was not restored.'; ready = false }; return }
    try {
      await cacheWrite
      record = await localforage.getItem('relationships:v2:' + key)
      if (record?.userId !== verifiedIdentity.userId || Date.now() - (record?.validatedAt || 0) >= CACHE_ACCESS_TTL_MS) record = null
    } catch { cacheWarning.value = 'Relationship cache could not be read; scan to load current results.' }
    if (revision !== generation || key !== sourceKey.value) return
    observations.value = Object.fromEntries(Object.entries(record?.observations || {}).filter(([, value]) => Number.isFinite(value?.at) && Array.isArray(value?.links)))
    errors.value = record?.errors && typeof record.errors === 'object' ? record.errors : {}; ready = true
    if (Object.keys(observations.value).length) message.value = 'Relationships restored from cache. Refresh to verify the latest links.'
    if (!loading.value) apply()
  }, { immediate: true, flush: 'sync' })
  watch(() => loading.value + ':' + primary.value.map(n => n.id).join(','), () => { if (ready && !loading.value && !running.value) apply() })
  watch(() => [loading.value, Object.keys(visibleNodes.value).filter(id => !nodes[id]?.externalContext).join(',')], () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const visible = Object.values(visibleNodes.value).filter(n => n.type === 'gitlab_issue' && !n.externalContext)
      const isNarrow = visible.length < primary.value.length || getGitLabSource(config).kind === 'project'
      if (visible.length && visible.length <= 50 && isNarrow) void scan()
    }, 600)
  }, { immediate: true })
  onBeforeUnmount(() => { cancel(); clearTimeout(timer); clearInterval(freshnessTimer) })
  return { now, running, completed, total, errors, observations, message, cacheWarning, diagnostics, summary, indexedCount, freshCount, primary, scan, cancel }
}
