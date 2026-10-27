import { computed, ref, watch, onBeforeUnmount, toRaw } from 'vue'
import localforage from 'localforage'
import { createGitLabClient, fetchIssueLinks } from '../services/gitlab'
import { gitlabSourceCacheKey, getGitLabSource } from '../services/gitlabSourceCache'
import { assembleRelationships, dependencySummary, RELATIONSHIP_TTL_MS } from '../utils/issueRelationships'

export function useIssueRelationships({ config, nodes, edges, visibleNodes, loading, resolveBaseUrl }) {
  const running = ref(false), completed = ref(0), total = ref(0), errors = ref({}), observations = ref({})
  const message = ref('Relationships have not been indexed.'), diagnostics = ref({}), cacheWarning = ref('')
  const now = ref(Date.now())
  const freshnessTimer = setInterval(() => { now.value = Date.now() }, 60000)
  let generation = 0, controller, timer, ready = false
  const sourceKey = computed(() => gitlabSourceCacheKey(config))
  const primary = computed(() => Object.values(nodes).filter(n => n.type === 'gitlab_issue' && !n.externalContext))
  const summary = computed(() => dependencySummary(nodes, edges))
  const freshCount = computed(() => primary.value.filter(n => now.value - (observations.value[n.id]?.at || 0) < RELATIONSHIP_TTL_MS).length)
  const indexedCount = computed(() => primary.value.filter(n => observations.value[n.id]).length)
  function apply() {
    const base = Object.fromEntries(primary.value.map(n => [n.id, n]))
    const next = assembleRelationships(base, observations.value)
    for (const [id, edge] of Object.entries(edges)) if (edge.kind === 'issue_link') delete edges[id]
    for (const [id, node] of Object.entries(nodes)) if (node.externalContext) delete nodes[id]
    Object.assign(nodes, next.external); Object.assign(edges, next.edges); diagnostics.value = next.diagnostics
  }
  function cancel() { generation++; controller?.abort(); running.value = false; message.value = 'Cancelled. Completed requests are retained; coverage is partial.' }
  async function scan({ full = false, force = false, retry = false } = {}) {
    if (running.value || loading.value || !ready || !config.enableGitLab || !config.token) return
    const candidates = full ? primary.value : Object.values(visibleNodes.value).filter(n => n.type === 'gitlab_issue' && !n.externalContext)
    const max = full ? 2000 : 100
    const eligible = candidates.filter(n => retry ? errors.value[n.id] : force || Date.now() - (observations.value[n.id]?.at || 0) >= RELATIONSHIP_TTL_MS)
    const seeds = eligible.slice(0, max)
    if (!seeds.length) { message.value = 'Visible relationships are fresh (15 minute TTL). Refresh to check again.'; return }
    const revision = ++generation, key = sourceKey.value, cacheKey = 'relationships:v1:' + key
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
          errors.value[node.id] = status ? 'HTTP ' + status : 'Request failed'
        }
        completed.value++
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, seeds.length) }, worker))
    } finally {
      // Cancellation retains successful work but a source change never applies old results.
      if (key === sourceKey.value) {
        apply()
        const record = JSON.parse(JSON.stringify(toRaw(observations.value)))
        try {
          await localforage.setItem(cacheKey, { observations: record, errors: { ...errors.value } })
          cacheWarning.value = ''
        } catch { cacheWarning.value = 'Relationship cache could not be saved; current results remain available.' }
      }
      if (revision === generation) {
        running.value = false
        message.value = eligible.length > max ? 'Partial: request budget reached. Narrow the view for remaining issues.' : Object.keys(errors.value).length ? 'Partial: some issues could not be read. Retry failed requests.' : 'Relationship scan complete. External context is limited to one hop and 100 issues.'
      }
    }
  }
  watch(sourceKey, async () => {
    generation++; controller?.abort(); clearTimeout(timer); running.value = false; ready = false
    observations.value = {}; errors.value = {}; completed.value = 0; total.value = 0
    message.value = 'Relationships have not been indexed.'
    const key = sourceKey.value
    let record
    cacheWarning.value = ''
    try { record = await localforage.getItem('relationships:v1:' + key) }
    catch { if (key === sourceKey.value) cacheWarning.value = 'Relationship cache unavailable; scan to rebuild coverage.' }
    if (key !== sourceKey.value) return
    observations.value = record?.observations || {}; errors.value = record?.errors || {}; ready = true
    if (Object.keys(observations.value).length) message.value = 'Relationships restored from cache. Refresh to verify the latest links.'
    if (!loading.value) apply()
  }, { immediate: true })
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
  return { running, completed, total, errors, message, cacheWarning, diagnostics, summary, indexedCount, freshCount, primary, scan, cancel }
}
