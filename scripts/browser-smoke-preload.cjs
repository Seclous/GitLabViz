const { contextBridge } = require('electron')
const origin = process.argv.find(arg => arg.startsWith('--fixture-origin=')).split('=').slice(1).join('=')
contextBridge.exposeInMainWorld('electronAPI', {
  settingsGet: async () => ({ settings: {
    config: { token: 'fixture-only', gitlabApiBaseUrl: origin, gitlabSourceKind: 'group', groupId: 'fixture/core', enableSvn: false, gitlabClosedDays: 0 },
    uiState: { view: { layout: 'list' } }
  } }),
  settingsSet: async () => ({ ok: true })
})
