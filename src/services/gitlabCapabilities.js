// Read-only diagnostics. Keep credentials and server error bodies out of results.
export async function probeGitLabCapabilities(client, groupPath) {
  const group = String(groupPath || '').trim()
  if (!group) throw new Error('Provide a group ID or path first.')
  const encoded = encodeURIComponent(group)
  const checks = []
  async function check(name, request, validate = () => true) {
    try {
      const response = await request()
      checks.push({ name, status: validate(response.data) ? 'available' : 'unknown' })
    } catch (error) {
      const code = error?.response?.status
      checks.push({ name, status: code === 401 || code === 403 ? 'denied'
        : code === 404 ? 'unavailable' : code === 429 ? 'rate limited' : 'failed' })
    }
  }
  // Run sequentially: diagnostics should not create a burst of API requests.
  await check('Version API', () => client.get('/version'), data => !!data?.version)
  await check('Group access', () => client.get(`/groups/${encoded}`), data => !!data?.id)
  await check('Group project directory', () => client.get(`/groups/${encoded}/projects`, {
    params: { include_subgroups: true, with_shared: false, per_page: 1 }
  }), Array.isArray)
  await check('Group issue index', () => client.get(`/groups/${encoded}/issues`, {
    params: { scope: 'all', state: 'all', per_page: 1 }
  }), Array.isArray)
  const graphqlUrl = String(client.defaults?.baseURL || '').replace(/\/api\/v4\/?$/, '/api/graphql')
  await check('Work item hierarchy schema', () => client.post(graphqlUrl, {
    query: '{ groupType: __type(name: "Group") { fields { name } } hierarchyType: __type(name: "WorkItemWidgetHierarchy") { fields { name } } }'
  }), data => {
    if (data?.errors?.length) return false
    const fields = data?.data?.groupType?.fields || []
    const hierarchy = data?.data?.hierarchyType?.fields || []
    return fields.some(field => field.name === 'workItems') && hierarchy.some(field => field.name === 'children')
  })
  return checks
}
