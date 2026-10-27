// Runs the production standalone HTML in Chromium against a disposable local API.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlabviz-smoke-'))
app.setPath('userData', temporaryProfile)
const requests = []
const projects = [
  { id: 11, path_with_namespace: 'fixture/core/connectors/api', name: 'api' },
  { id: 22, path_with_namespace: 'fixture/core/services/backend', name: 'backend' }
]
const issues = projects.map((project, index) => ({
  id: 101 + index, iid: 42, project_id: project.id, title: index ? 'Backend fixture issue' : 'API fixture issue',
  state: 'opened', labels: ['Scope::' + (index ? 'Backend' : 'API'), 'Type::Task'],
  references: { full: project.path_with_namespace + '#42' },
  web_url: 'http://fixture.invalid/' + project.path_with_namespace + '/-/issues/42',
  created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString(), assignees: []
}))
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const route = decodeURIComponent(url.pathname)
  requests.push(route)
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Next-Page', '')
  let result
  if (route === '/' || route === '/index.html') {
    res.setHeader('Content-Type', 'text/html')
    res.end(fs.readFileSync(path.join(__dirname, '../dist/index.html'))); return
  }
  if (route === '/api/v4/user') result = { id: 1, name: 'Fixture user' }
  else if (route === '/api/v4/personal_access_tokens/self') result = { scopes: ['read_api'], expires_at: null }
  else if (route === '/api/v4/groups/fixture/core') result = { id: 3, full_path: 'fixture/core' }
  else if (route === '/api/v4/groups/fixture/core/projects') result = projects
  else if (route === '/api/v4/groups/fixture/core/issues') result = url.searchParams.get('state') === 'closed' ? [] : issues
  else if (/\/issues\/42\/links$/.test(route)) result = []
  else if (route === '/api/graphql') {
    let body = ''; for await (const chunk of req) body += chunk
    const { query, variables } = JSON.parse(body)
    if (query.includes('EnrichIssueCustomFields')) {
      result = { data: { namespace: { item0: { widgets: [{ customFieldValues: [
        { customField: { name: 'Priority' }, selectedOptions: [{ value: variables.fullPath.endsWith('/api') ? 'High' : 'Low' }] },
        { customField: { name: 'Review Status' }, selectedOptions: [{ value: 'Ready' }] }
      ] }] } } } }
    } else result = { data: { namespace: { workItems: { nodes: [], pageInfo: { hasNextPage: false } } } } }
  } else { console.error('Unhandled fixture route:', route); res.statusCode = 404; result = { message: 'Fixture route unavailable' } }
  res.end(JSON.stringify(result))
})
let window
const evaluate = code => window.webContents.executeJavaScript(code)
async function waitFor(code, description) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    if (await evaluate(code)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Timed out: ' + description + '\n' + await evaluate('document.body.innerText.slice(-8000)'))
}
;(async () => {
  await app.whenReady()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  window = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: {
    preload: path.join(__dirname, 'browser-smoke-preload.cjs'), additionalArguments: ['--fixture-origin=' + origin]
  } })
  await window.loadURL(origin + '/#/list')
  await waitFor('!!document.querySelector("#glv-refresh-data-btn")', 'application bootstrap')
  await evaluate('document.querySelector("#glv-refresh-data-btn").click()')
  await waitFor('document.body.innerText.includes("API fixture issue") && document.body.innerText.includes("Backend fixture issue")', 'both group projects with identical IIDs')
  await waitFor('document.body.innerText.includes("High") && document.body.innerText.includes("Low")', 'custom Priority values')
  const text = await evaluate('document.body.innerText')
  assert.ok(text.includes('connectors/api') && text.includes('services/backend'), 'Relative project paths are visible')
  await evaluate('document.getElementById([...document.querySelectorAll("label")].find(e => e.textContent.trim() === "Review Status").htmlFor).closest(".v-field").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))')
  await waitFor('document.body.innerText.includes("Ready")', 'Review Status custom field option')
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  assert.ok(await evaluate('[...document.querySelectorAll("label")].some(e => e.textContent.trim() === "Scope")'), 'Scope facet is available')
  assert.ok(await evaluate('[...document.querySelectorAll("label")].some(e => e.textContent.trim() === "Review Status")'), 'Review Status facet is available')
  const count = requests.length
  await evaluate('[...document.querySelectorAll("button")].find(e => e.textContent.includes("Collapse explorer")).click()')
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#group-explorer-controls")).display'), 'none')
  await evaluate('[...document.querySelectorAll("button")].find(e => e.textContent.includes("Expand explorer")).click()')
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#group-explorer-controls")).display'), 'none')
  assert.equal(requests.slice(count).filter(route => route.includes('/groups/') && route.endsWith('/issues')).length, 0, 'Explorer toggle does not refetch the index')
  assert.equal(requests.filter(route => /^\/api\/v4\/projects\/\d+\/issues$/.test(route)).length, 0, 'Group scan does not fan out to project issue lists')
  console.log('Browser smoke passed: group All issues, same IIDs, custom Priority/Review Status, Scope facet, relative paths, explorer toggle, no project fan-out.')
})().then(() => finish(0), error => { console.error(error); finish(1) })
function finish(code) {
  if (window) window.destroy()
  server.close()
  app.exit(code)
}
