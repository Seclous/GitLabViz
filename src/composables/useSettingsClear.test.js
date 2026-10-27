import { it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import localforage from 'localforage'
vi.mock('localforage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), clear: vi.fn(async () => {}) } }))
import { useSettingsStore } from './useSettingsStore'
it('clears browser credentials and caches after pending saves and stops subsequent persistence', async () => {
  const store = useSettingsStore(); await store.init()
  store.settings.config.token = 'fixture-token'; await nextTick()
  localStorage.setItem('fixture', 'value'); sessionStorage.setItem('fixture', 'value')
  await store.clearBrowserSiteData()
  expect(localforage.clear).toHaveBeenCalledTimes(1)
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  expect(localforage.clear.mock.invocationCallOrder[0]).toBeGreaterThan(localforage.setItem.mock.invocationCallOrder.at(-1))
  const saves = localforage.setItem.mock.calls.length
  store.settings.config.token = ''; await nextTick()
  expect(localforage.setItem).toHaveBeenCalledTimes(saves)
})
