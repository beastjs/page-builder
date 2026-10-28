import { afterEach, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { clientConfig, createBuilderServer } from '../server/server.js'
import { HEADER, ROUTER } from './fixtures.js'

const servers: Server[] = [], roots: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'builder-api-')); roots.push(root)
  const builder = createBuilderServer(root)
  const server = createServer((req, res) => builder.middleware(req, res, () => { res.writeHead(404); res.end('App route') }))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return `http://127.0.0.1:${address.port}`
}
test('config defaults and overrides are serializable and validated', () => {
  expect(clientConfig({}).shortcut).toBe('Mod+B')
  expect(clientConfig({ launcher: false, scanDuration: 0, theme: 'dark', shortcut: 'Mod+Shift+B' })).toMatchObject({ launcher: false, scanDuration: 0, theme: 'dark', shortcut: 'Mod+Shift+B' })
  expect(() => clientConfig({ shortcut: 'B' })).toThrow('Shortcut')
  expect(() => clientConfig({ scanDuration: -10 })).toThrow('scanDuration')
})
test('API scans an empty project and leaves app requests alone', async () => {
  const origin = await fixture()
  const response = await fetch(origin + '/__beast-page-builder/scan')
  expect(response.status).toBe(200)
  expect((await response.json() as { files: unknown[] }).files).toEqual([])
  expect(await (await fetch(origin + '/app')).text()).toBe('App route')
})
test('API serves section summaries and fetches one template on demand', async () => {
  const origin = await fixture(), base = origin + '/__beast-page-builder'
  const summaries = await (await fetch(base + '/sections')).json() as { id: string; source?: string }[]
  expect(summaries.length).toBeGreaterThan(0)
  expect(summaries.some(summary => summary.source !== undefined)).toBe(false)
  const template = await (await fetch(base + '/sections/' + summaries[0]!.id)).json() as { id: string; source: string }
  expect(template).toMatchObject({ id: summaries[0]!.id, source: expect.stringContaining('data-section=') })
  expect((await fetch(base + '/sections/missing')).status).toBe(404)
  expect((await fetch(base + '/sections/%E0%A4%A')).status).toBe(404)
})
test('API rejects cross-site, malformed, oversized, and non-JSON writes', async () => {
  const origin = await fixture(), url = origin + '/__beast-page-builder/preview'
  expect((await fetch(url, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403)
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'a'.repeat(70_000) }) })).status).toBe(413)
})
test('API creates only the validated, reviewed draft and integrates its route and link', async () => {
  const origin = await fixture(), base = origin + '/__beast-page-builder'
  const root = roots.at(-1)!
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/router.ts'), ROUTER)
  await writeFile(join(root, 'src/Header.btsx'), HEADER)
  const draft = { name: 'HelloPage', source: 'main\n  h1 Hello\n' }
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
  const preview = await (await post('/preview', draft)).json() as { hash: string }
  expect((await post('/create', { ...draft, hash: preview.hash })).status).toBe(201)
  expect(await (await fetch(base + '/creation?hash=' + preview.hash)).json()).toMatchObject({ routePath: '/hello', files: expect.any(Array) })
  expect((await post('/create', { ...draft, hash: preview.hash })).status).toBe(409)
  expect(await (await fetch(base + '/source?path=src/pages/HelloPage.btsx')).json()).toEqual({ source: draft.source })
})

test('Tabs API validates, reviews and updates a registered page with a reload receipt', async () => {
  const origin = await fixture(), base = origin + '/__beast-page-builder'
  const root = roots.at(-1)!
  await mkdir(join(root, 'src/pages'), { recursive: true })
  await writeFile(join(root, 'src/router.ts'), ROUTER)
  await writeFile(join(root, 'src/pages/HomePage.btsx'), 'main\n  h1 Home\n')
  await writeFile(join(root, 'src/Tabs.btsx'), 'module\n  interface TabItem { id: string; label: string; href: string }\nprops { items, activeId }: { items: TabItem[]; activeId: string }\nnav(aria-label="Tabs")\n  each item in items key item.id\n    a(href={item.href} aria-current={activeId === item.id ? "page" : undefined}) #{item.label}\n')
  const draft = { page: 'src/pages/HomePage.btsx', routePath: '/', component: 'src/Tabs.btsx', active: 'home', items: [{ id: 'home', label: 'Home', href: '/' }] }
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
  expect((await post('/tabs/create', draft)).status).toBe(400)
  const reviewed = await post('/tabs/preview', draft)
  expect(reviewed.status).toBe(200)
  const preview = await reviewed.json() as { hash: string; source: string }
  expect((await post('/tabs/create', { ...draft, hash: preview.hash })).status).toBe(201)
  expect(await readFile(join(root, draft.page), 'utf8')).toBe(preview.source)
  expect(await (await fetch(base + '/tabs/creation?hash=' + preview.hash)).json()).toMatchObject({ routePath: '/', hash: preview.hash })
})

test('API reviews and saves page and tab edits with stale review protection', async () => {
  const origin = await fixture(), base = origin + '/__beast-page-builder'
  const root = roots.at(-1)!
  await mkdir(join(root, 'src/pages'), { recursive: true })
  await writeFile(join(root, 'src/router.ts'), ROUTER)
  await writeFile(join(root, 'src/pages/HomePage.btsx'), 'main\n  h1 Home\n')
  await writeFile(join(root, 'src/Tabs.btsx'), 'module\n  interface Item { id: string; label: string }\nprops { items, activeId }: { items: Item[]; activeId: string }\nnav\n  each item in items\n    a #{item.label}\n')
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
  const page = { name: 'HomePage', path: 'src/pages/HomePage.btsx', source: 'main\n  h1 Edited page\n' }
  expect((await post('/create', page)).status).toBe(400)
  const reviewed = await (await post('/preview', page)).json() as { hash: string }
  expect((await post('/create', { ...page, hash: reviewed.hash })).status).toBe(201)
  const tabs = { page: page.path, routePath: '/', component: 'src/Tabs.btsx', items: [{ id: 'one', label: 'First' }], active: 'one' }
  const preview = await (await post('/tabs/preview', tabs)).json() as { hash: string }
  expect((await post('/tabs/create', { ...tabs, hash: preview.hash })).status).toBe(201)
  const scan = await (await fetch(base + '/scan')).json() as { tabInstances: { draft: typeof tabs & { instance: string } }[] }
  const editing = { ...scan.tabInstances[0]!.draft, items: [{ id: 'one', label: 'Updated tab' }] }
  const update = await (await post('/tabs/preview', editing)).json() as { hash: string }
  expect((await post('/tabs/create', { ...editing, hash: update.hash })).status).toBe(201)
  const source = await readFile(join(root, page.path), 'utf8')
  expect(source).toContain('Updated tab')
  expect(source).toContain('h1 Edited page')
  expect(source.match(/PageTabs\(/g)).toHaveLength(1)
  expect((await post('/tabs/create', { ...editing, hash: update.hash })).status).toBe(409)
})
