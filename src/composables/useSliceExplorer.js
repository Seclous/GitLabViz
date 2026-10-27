import { computed, ref, watch } from 'vue'
import { selectSlice, presentSlice, scopeValues, dependencyClosure } from '../utils/groupSlices'
import { gitlabSourceCacheKey } from '../services/gitlabSourceCache'
import { RELATIONSHIP_TTL_MS } from '../utils/issueRelationships'

export function useSliceExplorer({ config, nodes, edges, hierarchy, relationships, filteredNodes, matchesFilters }) {
  const mode = ref('epic'), value = ref(''), query = ref(''), hops = ref(1), direction = ref('upstream')
  const layer = ref('both'), strict = ref(false), lanes = ref(true), collapsed = ref([]), nodeLimit = ref(200), enriching = ref(false)
  let revision = 0
  const enabled = computed(() => hierarchy.enabled)
  const scopes = computed(() => scopeValues(nodes))
  const searchResults = computed(() => {
    const text = query.value.trim().toLowerCase()
    return Object.values(nodes).filter(n => n.type === 'gitlab_issue' && !n.externalContext && (!text || [n.fullReference, n.projectPath, n.iid, n._raw?.title].join(' ').toLowerCase().includes(text))).slice(0, 80)
  })
  const slice = computed(() => selectSlice({ mode: mode.value, value: mode.value === 'epic' ? hierarchy.selectedId : value.value, nodes, edges,
    hierarchyNodes: mode.value === 'epic' && hierarchy.selectedId ? hierarchy.hierarchyNodes : {}, hierarchyEdges: mode.value === 'epic' ? hierarchy.hierarchyEdges : {}, hops: hops.value, direction: direction.value }))
  const presentation = computed(() => presentSlice(slice.value, matchesFilters ? Object.fromEntries(Object.entries(slice.value.nodes).filter(([, n]) => matchesFilters(n))) : filteredNodes.value, { strict: strict.value, hops: hops.value, direction: direction.value, collapsed: collapsed.value, layer: layer.value, nodeLimit: nodeLimit.value, edgeLimit: Math.max(400, nodeLimit.value * 2) }))
  const counts = computed(() => {
    const issues = Object.values(slice.value.nodes).filter(n => n.type === 'gitlab_issue')
    const required = dependencyClosure(slice.value.seeds, slice.value.nodes, slice.value.edges, { hops: Math.max(0, hops.value - 1), direction: direction.value })
    const coverageNodes = [...required].filter(id => slice.value.nodes[id]?.type === 'gitlab_issue')
    const fresh = coverageNodes.filter(id => (relationships.now || Date.now()) - (relationships.observations[id]?.at || 0) < RELATIONSHIP_TTL_MS && !relationships.errors[id]).length
    return { issues: issues.length, projects: new Set(issues.map(n => n.projectPath || n.projectId)).size, blocked: issues.filter(n => slice.value.blocked.has(n.id)).length,
      external: issues.filter(n => n.externalContext || !slice.value.seeds.includes(n.id)).length, fresh, required: coverageNodes.length,
      complete: Number(hops.value) === 0 || (coverageNodes.length > 0 && fresh === coverageNodes.length && !relationships.diagnostics.externalOmitted && !relationships.diagnostics.edgesOmitted),
      updated: Math.max(0, ...coverageNodes.map(id => relationships.observations[id]?.at || 0)) }
  })
  const breadcrumbs = computed(() => {
    if (mode.value !== 'epic') return []
    const byId = new Map(hierarchy.epics.map(e => [e.id, e])), result = [], seen = new Set()
    let item = byId.get(hierarchy.selectedId)
    while (item && !seen.has(item.id)) {
      seen.add(item.id)
      result.unshift({ id: item.id, title: (item.namespacePath || '') + '&' + item.iid + ' ' + item.title, url: item.webUrl || item.web_url, selectable: byId.has(item.id) })
      item = byId.get(item.parentId) || item.parent
    }
    return result
  })
  const tree = computed(() => {
    const children = new Map(), parent = new Map(), all = slice.value.nodes
    for (const e of Object.values(hierarchy.hierarchyEdges)) if (e.kind === 'contains' && all[e.target]?.type === 'gitlab_epic') { children.set(e.source, [...(children.get(e.source) || []), e.target]); parent.set(e.target, e.source) }
    const result = [], seen = new Set()
    function visit(id, depth) { if (seen.has(id)) return; seen.add(id); const n = all[id]; if (n?.type !== 'gitlab_epic') return; result.push({ id, depth, title: n.fullReference + ' ' + n._raw.title }); for (const child of children.get(id) || []) visit(child, depth + 1) }
    for (const n of Object.values(all)) if (n.type === 'gitlab_epic' && !parent.has(n.id)) visit(n.id, 0)
    return result
  })
  async function enrich() {
    if (enriching.value || relationships.running || !slice.value.seeds.length) return
    const run = ++revision; enriching.value = true
    try {
      for (let hop = 0; hop < Number(hops.value); hop++) {
        if (run !== revision) break
        const ids = dependencyClosure(slice.value.seeds, slice.value.nodes, slice.value.edges, { hops: hop, direction: direction.value })
        await relationships.scan({ seedNodes: [...ids].map(id => slice.value.nodes[id]).filter(n => n?.type === 'gitlab_issue') })
      }
    } finally { if (run === revision) enriching.value = false }
  }
  function toggleCollapse(id) { collapsed.value = collapsed.value.includes(id) ? collapsed.value.filter(x => x !== id) : [...collapsed.value, id] }
  function cancel() { revision++; enriching.value = false; relationships.cancel() }
  watch(mode, () => { value.value = '' }, { flush: 'sync' })
  watch(() => [mode.value, value.value, hierarchy.selectedId, hops.value, direction.value], () => { cancel(); nodeLimit.value = 200 })
  watch(() => gitlabSourceCacheKey(config), () => { cancel(); mode.value = 'epic'; value.value = ''; query.value = ''; collapsed.value = []; nodeLimit.value = 200 })
  return { enabled, mode, value, query, hops, direction, layer, strict, lanes, collapsed, nodeLimit, enriching, scopes, searchResults, slice, presentation, counts, tree, breadcrumbs, enrich, cancel, toggleCollapse }
}
