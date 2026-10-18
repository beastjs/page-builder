import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BASE, type BeastPageBuilderOptions, type ClientConfig, type PageDraft, type TabsDraft } from '../shared/types.js'
import { BuilderError, BuilderProject } from './project.js'

// The server modules are bundled into each public entrypoint in dist/.
export const CLIENT_ENTRY = fileURLToPath(new URL('./client.js', import.meta.url))
const SHORTCUT = /^(?:Mod|Meta|Ctrl)(?:\+Shift)?\+[A-Za-z]$/

export function clientConfig(options: BeastPageBuilderOptions): ClientConfig {
  const shortcut = options.shortcut ?? 'Mod+B'
  if (!SHORTCUT.test(shortcut)) throw new BuilderError('Shortcut must be Mod+B, Meta+B, Ctrl+B, or include +Shift.')
  if (options.position && !['center', 'bottom-right'].includes(options.position)) throw new BuilderError('Unknown widget position.')
  if (options.theme && !['light', 'dark', 'auto'].includes(options.theme)) throw new BuilderError('Unknown widget theme.')
  const scanDuration = options.scanDuration ?? 1600
  if (!Number.isFinite(scanDuration) || scanDuration < 0 || scanDuration > 10_000) throw new BuilderError('scanDuration must be between 0 and 10,000 milliseconds.')
  return { shortcut, position: options.position ?? 'center', theme: options.theme ?? 'light', scanDuration, launcher: options.launcher ?? true, pagesDir: options.pagesDir ?? 'src/pages', routerFile: options.routerFile ?? 'src/router.ts' }
}

function checkOrigin(req: IncomingMessage): void {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new BuilderError('Cross-site requests are refused.', 403)
  const origin = req.headers.origin
  if (origin) {
    let host: string
    try { host = new URL(origin).host } catch { throw new BuilderError('Invalid origin.', 403) }
    if (host !== req.headers.host) throw new BuilderError('Request must come from the development page.', 403)
  }
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new BuilderError('Expected application/json.', 415)
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk)
    if (length > 65_536) throw new BuilderError('Request is too large.', 413)
    chunks.push(Buffer.from(chunk))
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error()
    return result as Record<string, unknown>
  } catch { throw new BuilderError('Invalid JSON body.') }
}

export function createBuilderServer(root: string, options: BeastPageBuilderOptions = {}, basePath = '/') {
  const config = clientConfig(options)
  const project = new BuilderProject(root, options)
  const middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const prefixedBase = basePath.replace(/\/$/, '') + BASE
    // Vite's base middleware may run after this middleware; accept both shapes.
    const routeBase = url.pathname.startsWith(prefixedBase + '/') ? prefixedBase : BASE
    if (!url.pathname.startsWith(routeBase + '/')) return next()
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(data))
    }
    void (async () => {
      checkOrigin(req)
      const route = url.pathname.slice(routeBase.length)
      if (req.method === 'GET' && route === '/client.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(await readFile(CLIENT_ENTRY, 'utf8'))
      } else if (req.method === 'GET' && route === '/config') send(200, config)
      else if (req.method === 'GET' && route === '/scan') send(200, await project.scan())
      else if (req.method === 'GET' && route === '/creation') send(200, await project.creation(url.searchParams.get('hash') ?? ''))
      else if (req.method === 'GET' && route === '/source') send(200, { source: await project.source(url.searchParams.get('path') ?? '') })
      else if (req.method === 'GET' && route === '/tabs/creation') send(200, await project.tabCreation(url.searchParams.get('hash') ?? ''))
      else if (req.method === 'POST' && (route === '/tabs/preview' || route === '/tabs/create')) {
        const body = await jsonBody(req)
        const draft = { page: body.page, routePath: body.routePath, component: body.component, items: body.items, active: body.active, label: body.label, instance: body.instance } as TabsDraft
        send(route === '/tabs/create' ? 201 : 200, route === '/tabs/create' ? await project.createTabs(draft, body.hash as string) : await project.previewTabs(draft))
      }
      else if (req.method === 'POST' && (route === '/preview' || route === '/create')) {
        const body = await jsonBody(req)
        const draft = { name: body.name, source: body.source, routePath: body.routePath, navLabel: body.navLabel, navigationTarget: body.navigationTarget, path: body.path, section: body.section } as PageDraft
        send(route === '/create' ? 201 : 200, route === '/create' ? await project.create(draft, body.hash as string) : await project.preview(draft))
      } else send(404, { error: 'Unknown page-builder endpoint.' })
    })().catch(error => {
      const code = (error as NodeJS.ErrnoException).code
      send(error instanceof BuilderError ? error.status : code === 'ENOENT' ? 404 : 500, { error: error instanceof Error ? error.message : String(error) })
    })
  }
  return { middleware, project, clientEntry: CLIENT_ENTRY }
}
