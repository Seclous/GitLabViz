import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const bundle = await readFile(new URL('../dist/index.html', import.meta.url))
const standalone = await readFile(new URL('../index.html', import.meta.url))
assert.ok(bundle.equals(standalone), 'Root and dist HTML must be byte-for-byte identical')
// Inspect markup without asking jsdom to parse Vuetify's production CSS.
const html = bundle.toString()
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
const document = new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')).window.document
assert.ok(document.querySelector('#app'), 'Missing application mount')
assert.ok([...document.scripts].some(script => script.type === 'module' && script.textContent.length > 1000), 'Missing bundled application')
assert.equal(document.querySelectorAll('script[src], link[rel="stylesheet"][href]').length, 0, 'Standalone bundle must inline scripts and styles')
assert.ok(styles.some(match => match[1].length > 1000), 'Missing bundled styles')
const hash = createHash('sha256').update(bundle).digest('hex')
await writeFile(new URL('../dist/SHA256SUMS', import.meta.url), `${hash}  index.html\n`)
const manifest = await readFile(new URL('../dist/SHA256SUMS', import.meta.url), 'utf8')
assert.equal(manifest.trim().split(/\s+/)[0], createHash('sha256').update(await readFile(new URL('../dist/index.html', import.meta.url))).digest('hex'))
console.log(`Standalone HTML verified (${bundle.length} bytes), SHA-256 ${hash}`)
