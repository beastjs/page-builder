import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { build, createServer } from 'vite'
import { rspack, type Compiler } from '@rspack/core'
import { RspackDevServer } from '@rspack/dev-server'
import { createRsbuild } from '@rsbuild/core'

// Exercise the built, publishable entrypoints, not a separate adapter fixture.
const entry = (name: string) => new URL(`../dist/${name}.js`, import.meta.url).href
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'builder-bundler-')); roots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/main.js'), 'document.body.dataset.app = "ready"')
  await writeFile(join(root, 'src/App.btsx'), 'main\n  h1 Fixture\n')
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>')
  return root
}
const scan = async (origin: string) => {
  const response = await fetch(origin + '/__beast-page-builder/scan')
  expect(response.status).toBe(200)
  expect((await response.json() as { files: { path: string }[] }).files[0]?.path).toBe('src/App.btsx')
}

test('Vite serves the widget and API, including under a non-root base', async () => {
  const root = await fixture()
  const { beastPageBuilder } = await import(entry('vite'))
  const server = await createServer({ root, configFile: false, base: '/studio/', plugins: [beastPageBuilder({ theme: 'dark' })], server: { host: '127.0.0.1', port: 0 } })
  try {
    await server.listen()
    const origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`
    const html = await (await fetch(origin + '/studio/')).text()
    expect(html).toContain('/studio/__beast-page-builder/client.js')
    const script = await fetch(origin + '/studio/__beast-page-builder/client.js')
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect(await script.text()).toContain('Getting to know your project')
    expect(await (await fetch(origin + '/studio/__beast-page-builder/config')).json()).toMatchObject({ theme: 'dark' })
    await scan(origin + '/studio')
  } finally { await server.close() }
}, 30_000)

test('Vite production builds contain no widget or injection', async () => {
  const root = await fixture()
  const { beastPageBuilder } = await import(entry('vite'))
  await build({ root, configFile: false, plugins: [beastPageBuilder()], logLevel: 'silent' })
  expect(await readFile(join(root, 'dist/index.html'), 'utf8')).not.toContain('__beast-page-builder')
}, 30_000)

function run(compiler: Compiler) {
  return new Promise<void>((resolve, reject) => compiler.run((error, stats) => compiler.close(() => {
    if (error) reject(error)
    else if (stats?.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })))
    else resolve()
  })))
}
test('Rspack serve bundles the widget and serves the API', async () => {
  const root = await fixture()
  const { beastPageBuilder } = await import(entry('rspack'))
  const compiler = rspack({ context: root, mode: 'development', entry: './src/main.js', output: { path: join(root, 'dist') }, plugins: [beastPageBuilder()], devServer: { host: '127.0.0.1', port: 'auto' }, infrastructureLogging: { level: 'error' }, stats: 'none' })
  const server = new RspackDevServer(compiler.options.devServer || {}, compiler)
  try {
    await server.start()
    const origin = `http://127.0.0.1:${(server.server!.address() as AddressInfo).port}`
    expect(await (await fetch(origin + '/main.js')).text()).toContain('Getting to know your project')
    await scan(origin)
  } finally { await server.stop() }
}, 30_000)

test('Rspack production builds leave the widget out', async () => {
  const root = await fixture()
  const { beastPageBuilder } = await import(entry('rspack'))
  const compiler = rspack({ context: root, mode: 'production', entry: './src/main.js', output: { path: join(root, 'dist') }, plugins: [beastPageBuilder()], infrastructureLogging: { level: 'error' }, stats: 'none' })
  await run(compiler)
  expect(await readFile(join(root, 'dist/main.js'), 'utf8')).not.toContain('beast-page-builder')
}, 30_000)

test('Rsbuild dev bundles the widget and serves the API', async () => {
  const root = await fixture()
  const { beastPageBuilder } = await import(entry('rsbuild'))
  const rsbuild = await createRsbuild({ cwd: root, config: { logLevel: 'error', source: { entry: { index: './src/main.js' } }, html: { template: './index.html' }, server: { host: '127.0.0.1', printUrls: false }, dev: { cliShortcuts: false }, plugins: [beastPageBuilder()] } })
  const { port, server } = await rsbuild.startDevServer()
  try {
    const origin = `http://127.0.0.1:${port}`
    const html = await (await fetch(origin)).text()
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]!)
    const bundles = (await Promise.all(scripts.filter(path => path !== '/src/main.js').map(async path => (await fetch(new URL(path, origin))).text()))).join('\n')
    expect(bundles).toContain('Getting to know your project')
    await scan(origin)
  } finally { await server.close() }
}, 30_000)

test('Rsbuild production builds leave the widget out', async () => {
  const root = await fixture()
  const { beastPageBuilder } = await import(entry('rsbuild'))
  const rsbuild = await createRsbuild({ cwd: root, config: { logLevel: 'error', source: { entry: { index: './src/main.js' } }, plugins: [beastPageBuilder()], output: { distPath: { root: 'dist' } } } })
  await rsbuild.build()
  const html = await readFile(join(root, 'dist/index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]!)
  for (const path of scripts) expect(await readFile(join(root, 'dist', path.replace(/^\//, '')), 'utf8')).not.toContain('beast-page-builder')
}, 30_000)
