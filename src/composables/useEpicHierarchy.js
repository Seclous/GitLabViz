import { ref, computed, watch, onScopeDispose } from 'vue'
import { createHierarchyAdapter } from '../services/gitlabHierarchy'
import { getGitLabSource, gitlabSourceCacheKey } from '../services/gitlabSourceCache'

export function useEpicHierarchy({ config, nodes, resolveBaseUrl, createAdapter = createHierarchyAdapter }) {
  const status = ref(''), fullPath = ref('')
  const epics = ref([]), selectedId = ref(null), includeTasks = ref(false)
  const hierarchyNodes = ref({}), hierarchyEdges = ref({})
  const warnings = ref([]), error = ref(''), loading = ref(false), indexReady = ref(false), mode = ref('')
  const enabled = computed(() => config.enableGitLab && config.gitlabSourceKind === 'group')
  let adapter, controller, generation = 0
  const clearSlice = () => { hierarchyNodes.value = {}; hierarchyEdges.value = {} }
  const cancel = () => { generation++; controller?.abort(); loading.value = false }
  const start = () => { cancel(); controller = new AbortController(); loading.value = true; error.value = ''; return generation }
  const cancelled = e => e?.name === 'AbortError' || e?.code === 'ERR_CANCELED'

  async function refresh() {
    const previousSelection = selectedId.value
    const run = start()
    indexReady.value = false
    epics.value = []
    warnings.value = []
    if (!enabled.value || !config.token) { loading.value = false; return }
    try {
      const baseUrl = await resolveBaseUrl()
      if (run !== generation) return
      adapter = createAdapter(baseUrl, config.token)
      const result = await adapter.listEpics(getGitLabSource(config), controller.signal)
      if (run !== generation) return
      status.value = result.status || ''
      fullPath.value = result.fullPath || ''
      epics.value = result.epics
      warnings.value = result.warnings
      mode.value = result.mode
      indexReady.value = true
      if (previousSelection && result.epics.some(e => e.id === previousSelection)) await loadSelection()
      else if (previousSelection) selectedId.value = null
    } catch (e) {
      if (run === generation && !cancelled(e)) error.value = 'Epic discovery failed. Check the connection, permissions, GitLab version, and tier, then retry.'
    } finally { if (run === generation) loading.value = false }
  }
  async function loadSelection() {
    const epic = epics.value.find(e => e.id === selectedId.value)
    const run = start()
    clearSlice()
    if (!epic || !adapter) { loading.value = false; return }
    try {
      const result = await adapter.loadEpic(epic, getGitLabSource(config), nodes, { signal: controller.signal, includeTasks: includeTasks.value })
      if (run !== generation) return
      hierarchyNodes.value = result.nodes
      hierarchyEdges.value = result.edges
      warnings.value = result.warnings
    } catch (e) {
      if (run === generation && !cancelled(e)) error.value = 'Epic hierarchy failed to load. Retry to load its descendants.'
    } finally { if (run === generation) loading.value = false }
  }
  watch([selectedId, includeTasks], loadSelection, { flush: 'sync' })
  // Source switches invalidate both requests and all hierarchy state immediately.
  watch(() => [gitlabSourceCacheKey(config), config.token, config.enableGitLab], () => {
    cancel(); adapter = null; selectedId.value = null; epics.value = []; warnings.value = []; error.value = ''; indexReady.value = false; clearSlice(); status.value = ''; fullPath.value = ''
  }, { flush: 'sync' })
  onScopeDispose(cancel)
  return { status, fullPath, enabled, epics, selectedId, includeTasks, hierarchyNodes, hierarchyEdges, warnings, error, loading, indexReady, mode,
    refresh, retry: () => selectedId.value ? loadSelection() : refresh(),
    cancel: () => { cancel(); selectedId.value = null; clearSlice() } }
}
