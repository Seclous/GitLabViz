import { gitlabSourceCacheKey, writeGitLabSourceCache } from '../services/gitlabSourceCache'
import { reactive, ref } from 'vue'
import localforage from 'localforage'

vi.mock('../services/gitlab', () => {
  return {
    normalizeGitLabApiBaseUrl: vi.fn((v) => String(v || '').replace(/\/+$/, '') + '/api/v4'),
    createGitLabClient: vi.fn(() => ({
      get: vi.fn(async () => ({ data: { name: 'Me', id: 123 } }))
    })),
    createGitLabGraphqlClient: vi.fn(),
    enrichEpicTitlesFromRest: vi.fn(),
    enrichIssuesFromGraphql: vi.fn(),
    fetchProjectIssuesRest: vi.fn(async () => []),
    fetchGroupProjects: vi.fn(async () => ({})),
    fetchGroupIssuesRest: vi.fn(async () => []),
    fetchIssueLinks: vi.fn(async () => []),
    fetchIssueResourceMilestoneEvents: vi.fn(async () => []),
    fetchTokenInfo: vi.fn(async () => ({ scopes: [], expiresAt: null })),
    describeGitLabRequestError: vi.fn((e) => e?.message || String(e)),
    getNetworkFailureCount: vi.fn(() => 0),
    resetNetworkFailureCount: vi.fn()
  }
})

vi.mock('../services/svn', () => ({ createSvnClient: vi.fn(), fetchSvnLog: vi.fn() }))
vi.mock('../services/cache', () => ({
  svnCacheGetMeta: vi.fn(async () => null),
  svnCacheClear: vi.fn(async () => null),
  normalizeRepoUrl: (u) => u
}))
vi.mock('../chatTools/mmClient', () => ({
  MattermostClient: vi.fn().mockImplementation(() => ({
    me: vi.fn(async () => ({})),
    teams: vi.fn(async () => ([]))
  }))
}))

import { useDataLoader, slimIssue } from './useDataLoader'

describe('useDataLoader', () => {
  it('retains custom-field values when slimming issues for the cache', () => {
    const custom_field_values = [{ custom_field: { name: 'Priority' }, selected_options: [{ value: 'High' }] }]
    expect(slimIssue({ iid: 1, custom_field_values }).custom_field_values).toEqual(custom_field_values)
  })

  it('initCachedData loads cached nodes/edges but filters out svn nodes', async () => {
    await localforage.clear()
    await writeGitLabSourceCache({}, { nodes: {
      'issue:1': { id: 'issue:1', type: 'gitlab_issue', _raw: {} },
      'svn-1': { id: 'svn-1', type: 'svn_commit', _raw: {} }
    }, edges: { 'svn-1-1': { source: 'svn-1', target: 'issue:1' } } })

    const settings = reactive({
      meta: {},
      config: { enableGitLab: false, enableSvn: false }
    })
    const nodes = reactive({})
    const edges = reactive({})
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({})
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(false)
    const vizMode = ref('issues')

    const { initCachedData } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph: () => ({ nodes: {}, edges: {} })
    })

    await initCachedData()

    expect(nodes['issue:1']).toBeTruthy()
    expect(nodes['svn-1']).toBeUndefined()
    expect(Object.keys(edges).some(k => k.includes('svn'))).toBe(false)
  })

  it('loadData validates missing gitlab config early', async () => {
    const settings = reactive({
      meta: {},
      config: { enableGitLab: true, token: '', projectId: '', gitlabApiBaseUrl: '' }
    })
    const nodes = reactive({})
    const edges = reactive({})
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({})
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(false)
    const vizMode = ref('issues')

    const { loadData } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph: () => ({ nodes: {}, edges: {} })
    })

    await loadData()
    expect(error.value).toContain('Please provide GitLab URL')
  })

  it('loadData (gitlab) builds nodes, processes links, and writes cache meta', async () => {
    const gitlab = await import('../services/gitlab')

    const issue1 = {
      id: 1,
      project_id: 9,
      iid: 1,
      title: 'A',
      state: 'opened',
      labels: [],
      author: { name: 'Alice' },
      assignee: null,
      assignees: [],
      milestone: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      closed_at: null,
      due_date: null,
      web_url: '',
      confidential: false,
      time_stats: { time_estimate: 0, total_time_spent: 0 },
      user_notes_count: 0,
      merge_requests_count: 0,
      upvotes: 0,
      downvotes: 0,
      has_tasks: false,
      task_status: null
    }

    gitlab.fetchProjectIssuesRest.mockResolvedValueOnce([issue1])
    gitlab.fetchIssueLinks.mockResolvedValueOnce([])

    const settings = reactive({
      meta: {},
      config: {
        enableGitLab: true,
        enableSvn: false,
        token: 't',
        projectId: 'p',
        gitlabApiBaseUrl: 'https://gitlab.example.com',
        gitlabClosedDays: 0
      }
    })
    const nodes = reactive({})
    const edges = reactive({})
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({})
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(false)
    const vizMode = ref('issues')

    const { loadData } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph: () => ({ nodes: {}, edges: {} })
    })

    await loadData()

    expect(nodes['issue:1']).toBeTruthy()
    expect(gitlabCacheMeta.value?.nodes).toBeGreaterThan(0)
    expect(gitlabCacheMeta.value?.edges).toBeGreaterThanOrEqual(0)
    expect(error.value).toBe('')
  })

  it('loads duplicate issue numbers across group projects without changing the view', async () => {
    const gitlab = await import('../services/gitlab')
    gitlab.fetchGroupProjects.mockResolvedValueOnce({ 11: { id: 11, path_with_namespace: 'team/a' }, 12: { id: 12, path_with_namespace: 'team/b' } })
    gitlab.fetchGroupIssuesRest.mockResolvedValueOnce([
      { id: 101, project_id: 11, iid: 42, title: 'First', state: 'opened', labels: [], references: { full: 'team/a#42' } },
      { id: 102, project_id: 12, iid: 42, title: 'Second', state: 'opened', labels: [], references: { full: 'team/b#42' } }
    ])
    const settings = reactive({
      meta: {},
      config: {
        enableGitLab: true,
        enableSvn: false,
        token: 't',
        gitlabSourceKind: 'group',
        groupId: 'team',
        gitlabIncludeSubgroups: true,
        gitlabIncludeShared: false,
        gitlabApiBaseUrl: 'https://gitlab.example.com',
        gitlabClosedDays: 0
      }
    })
    const nodes = reactive({})
    const edges = reactive({})
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({})
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(false)
    const vizMode = ref('issues')

    const { loadData } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph: () => ({ nodes: {}, edges: {} })
    })

    await loadData()

    expect(error.value).toBe('')
    expect(Object.keys(nodes).sort()).toEqual(['issue:101', 'issue:102'])
    expect(nodes['issue:101'].fullReference).toBe('team/a#42')
    expect(nodes['issue:102'].fullReference).toBe('team/b#42')
    expect(vizMode.value).toBe('issues')
    expect(error.value).toBe('')
  })

  it('handleClearSource(gitlab) clears cache + in-memory graph', async () => {
    const settings = reactive({
      meta: {},
      config: { enableGitLab: true, enableSvn: false }
    })
    const nodes = reactive({ '1': { id: '1', type: 'gitlab_issue', _raw: {} } })
    const edges = reactive({ '1-2': { source: '1', target: '2' } })
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({ nodes: 1, edges: 1, updatedAt: Date.now() })
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(false)
    const vizMode = ref('issues')

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const { handleClearSource } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph: () => ({ nodes: {}, edges: {} })
    })

    await handleClearSource('gitlab')
    expect(Object.keys(nodes).length).toBe(0)
    expect(Object.keys(edges).length).toBe(0)

    confirmSpy.mockRestore()
  })

  it('loadData (gitlab incremental) syncs closed transitions (keeps and updates cached issues even when gitlabClosedDays=0)', async () => {
    const gitlab = await import('../services/gitlab')
    gitlab.createGitLabGraphqlClient.mockReturnValueOnce({})
    gitlab.enrichIssuesFromGraphql.mockImplementationOnce(async (_client, _project, issues) => {
      for (const issue of issues) {
        issue.custom_field_values = [{ custom_field: { name: 'Priority' }, selected_options: [{ value: 'High' }] }]
      }
    })

    const closedIssue = {
      id: 1, project_id: 9, iid: 1,
      title: 'A',
      state: 'closed',
      labels: [],
      author: { name: 'Alice' },
      assignee: null,
      assignees: [],
      milestone: null,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      due_date: null,
      web_url: '',
      confidential: false,
      time_stats: { time_estimate: 0, total_time_spent: 0 },
      user_notes_count: 0,
      merge_requests_count: 0,
      upvotes: 0,
      downvotes: 0,
      has_tasks: false,
      task_status: null
    }

    gitlab.fetchProjectIssuesRest.mockResolvedValueOnce([closedIssue])

    const settings = reactive({
      meta: {},
      config: {
        enableGitLab: true,
        enableSvn: false,
        token: 't',
        projectId: 'p',
        gitlabApiBaseUrl: 'https://gitlab.example.com',
        gitlabClosedDays: 0
      }
    })
    const nodes = reactive({
      'issue:1': { id: 'issue:1', projectId: 9, type: 'gitlab_issue', _raw: { id: 1, project_id: 9, iid: 1, state: 'opened' } },
      'issue:2': { id: 'issue:2', projectId: 9, type: 'gitlab_issue', _raw: { id: 2, project_id: 9, iid: 2, state: 'opened' } }
    })
    const edges = reactive({ 'issue:1-issue:2': { source: 'issue:1', target: 'issue:2' }, 'svn-1-1': { source: 'svn-1', target: 'issue:1' } })
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({
      sourceKey: gitlabSourceCacheKey(settings.config),
      projectId: 'p',
      apiBaseUrl: 'https://gitlab.example.com/api/v4',
      syncCursor: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    })
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(false)
    const vizMode = ref('issues')

    const { loadData } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph: () => ({ nodes: {}, edges: {} })
    })

    await loadData()

    // cached issues are kept and updated (gitlabClosedDays does not block updates)
    expect(nodes['issue:1']).toBeTruthy()
    expect(nodes['issue:1']?.closedAt).toBeTruthy()
    // Unchanged issues from old caches also gain custom fields on a normal refresh.
    expect(nodes['issue:1']._raw.custom_field_values[0].selected_options[0].value).toBe('High')
    expect(nodes['issue:2']._raw.custom_field_values[0].selected_options[0].value).toBe('High')
    // Issue refresh preserves links; the independent relationship index refreshes them.
    expect(Object.keys(edges).some(k => k === 'issue:1-issue:2')).toBe(true)
    // but non-issue edges (e.g. SVN) remain
    expect(Object.keys(edges).some(k => k.includes('svn'))).toBe(true)

    // incremental fetch uses state=all + updated_after
    expect(gitlab.fetchProjectIssuesRest).toHaveBeenCalledWith(
      expect.anything(),
      'p',
      expect.any(Function),
      expect.objectContaining({
        state: 'all',
        params: expect.objectContaining({ updated_after: expect.any(String) })
      })
    )
  })

  it('initCachedData uses createMockIssuesGraph when cache empty', async () => {
    await localforage.clear()

    const settings = reactive({
      meta: {},
      config: { enableGitLab: false, enableSvn: false }
    })
    const nodes = reactive({})
    const edges = reactive({})
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({})
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(false)
    const vizMode = ref('issues')

    const createMockIssuesGraph = vi.fn(() => ({ nodes: { 'issue:1': { id: 'issue:1', type: 'gitlab_issue', _raw: {} } }, edges: {} }))

    const { initCachedData } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph
    })

    await initCachedData()
    expect(createMockIssuesGraph).toHaveBeenCalled()
    expect(nodes['issue:1']).toBeTruthy()
  })

  it('loadData validates missing svn url when svn enabled', async () => {
    const settings = reactive({
      meta: {},
      config: { enableGitLab: false, enableSvn: true }
    })
    const nodes = reactive({})
    const edges = reactive({})
    const issueGraphSnapshot = reactive({ nodes: {}, edges: {} })
    const svnUrl = ref('')
    const svnVizLimit = ref(2000)
    const svnRecentCommits = ref([])
    const svnCommitCount = ref(0)
    const gitlabCacheMeta = ref({})
    const mattermostMeta = ref({})
    const lastUpdated = ref(null)
    const loading = ref(false)
    const loadingMessage = ref('')
    const updateStatus = ref({})
    const error = ref('')
    const isElectron = ref(false)
    const canUseSvn = ref(true)
    const vizMode = ref('issues')

    const { loadData } = useDataLoader({
      settings,
      nodes,
      edges,
      issueGraphSnapshot,
      svnUrl,
      svnVizLimit,
      svnRecentCommits,
      svnCommitCount,
      gitlabCacheMeta,
      mattermostMeta,
      lastUpdated,
      loading,
      loadingMessage,
      updateStatus,
      error,
      isElectron,
      canUseSvn,
      vizMode,
      buildSvnVizGraph: () => {},
      resetFilters: () => {},
      createMockIssuesGraph: () => ({ nodes: {}, edges: {} })
    })

    await loadData()
    expect(error.value).toContain('Please provide SVN URL')
  })
})

