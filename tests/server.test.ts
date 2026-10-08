import { afterEach, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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
