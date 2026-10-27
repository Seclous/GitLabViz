import { createGitLabClient, updateIssue } from '../services/gitlab'
import { slimIssue } from './useDataLoader'

export function useGitLabIssueMutations ({
  settings,
  nodes,
  issueGraph,
  resolveGitLabApiBaseUrl,
  snackbarText,
  snackbar
}) {
  const onIssueStateChange = async ({ nodeId, iid, projectId, state_event } = {}) => {
    const key = nodeId || (settings.config.gitlabSourceKind !== 'group' ? Object.keys(nodes).find(k => String(nodes[k]?._raw?.iid ?? nodes[k]?.id) === String(iid)) : null)
    const node = nodes[key]
    const ownProject = node?.projectId || node?._raw?.project_id || projectId || (settings.config.gitlabSourceKind !== 'group' ? settings.config.projectId : null)
    const issueIid = String(node?._raw?.iid || iid || '').trim()
    if (!node || !ownProject) return
    const ev = String(state_event || '').trim()
    if (!issueIid || (ev !== 'close' && ev !== 'reopen')) return

    if (!settings.meta.gitlabCanWrite) {
      alert('Write is disabled for this token (needs api scope).')
      return
    }
    if (!settings.config.enableGitLab) return

    const baseUrl = resolveGitLabApiBaseUrl()
    if (!baseUrl || !ownProject || !settings.config.token) {
      alert('Missing GitLab URL / Project / Token.')
      return
    }

    try {
      const client = createGitLabClient(baseUrl, settings.config.token)
      const prev = nodes[key]?._raw || null
      const updated = await updateIssue(client, ownProject, issueIid, { state_event: ev })
      // REST update responses can omit fields we rely on for grouping (ex: epic/iteration).
      if (updated && prev) {
        if (updated.epic == null && prev.epic) updated.epic = prev.epic
        if (updated.epic_iid == null && prev.epic_iid) updated.epic_iid = prev.epic_iid
        if (updated.iteration == null && prev.iteration) updated.iteration = prev.iteration
      }
      if (issueGraph.value && issueGraph.value.markDataOnlyUpdate) issueGraph.value.markDataOnlyUpdate()
      if (nodes[key]) nodes[key]._raw = slimIssue({ ...prev, ...updated })
      snackbarText.value = ev === 'close' ? `Closed #${issueIid}` : `Reopened #${issueIid}`
      snackbar.value = true
    } catch (e) {
      const status = e?.response?.status
      const msg = status ? `GitLab error ${status}: ${e?.message || String(e)}` : (e?.message || String(e))
      alert(msg)
    }
  }

  const onIssueAssigneeChange = async ({ nodeId, iid, projectId, assignee_ids } = {}) => {
    const key = nodeId || (settings.config.gitlabSourceKind !== 'group' ? Object.keys(nodes).find(k => String(nodes[k]?._raw?.iid ?? nodes[k]?.id) === String(iid)) : null)
    const node = nodes[key]
    const ownProject = node?.projectId || node?._raw?.project_id || projectId || (settings.config.gitlabSourceKind !== 'group' ? settings.config.projectId : null)
    const issueIid = String(node?._raw?.iid || iid || '').trim()
    if (!node || !ownProject) return
    const list = Array.isArray(assignee_ids) ? assignee_ids : null
    if (!issueIid || !list) return

    if (!settings.meta.gitlabCanWrite) {
      alert('Write is disabled for this token (needs api scope).')
      return
    }
    if (!settings.config.enableGitLab) return

    const baseUrl = resolveGitLabApiBaseUrl()
    if (!baseUrl || !ownProject || !settings.config.token) {
      alert('Missing GitLab URL / Project / Token.')
      return
    }

    try {
      const client = createGitLabClient(baseUrl, settings.config.token)
      const prev = nodes[key]?._raw || null
      const updated = await updateIssue(client, ownProject, issueIid, { assignee_ids: list })

      // Keep the rest of the app consistent (some parts use _raw.assignee directly).
      if (updated) {
        if (!updated.assignee && Array.isArray(updated.assignees) && updated.assignees.length) updated.assignee = updated.assignees[0]
        if (Array.isArray(updated.assignees) && updated.assignees.length === 0) updated.assignee = null
      }

      // REST update responses can omit fields we rely on for grouping (ex: epic/iteration).
      if (updated && prev) {
        if (updated.epic == null && prev.epic) updated.epic = prev.epic
        if (updated.epic_iid == null && prev.epic_iid) updated.epic_iid = prev.epic_iid
        if (updated.iteration == null && prev.iteration) updated.iteration = prev.iteration
      }

      if (issueGraph.value && issueGraph.value.markDataOnlyUpdate) issueGraph.value.markDataOnlyUpdate()
      if (nodes[key]) nodes[key]._raw = slimIssue({ ...prev, ...updated })
      snackbarText.value = list.length ? `Assigned #${issueIid}` : `Unassigned #${issueIid}`
      snackbar.value = true
    } catch (e) {
      const status = e?.response?.status
      const msg = status ? `GitLab error ${status}: ${e?.message || String(e)}` : (e?.message || String(e))
      alert(msg)
    }
  }

  return { onIssueStateChange, onIssueAssigneeChange }
}

