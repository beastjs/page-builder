import type { Plugin } from 'vite'
import { createBuilderServer } from './server/server.js'
import { BASE, type BeastPageBuilderOptions } from './shared/types.js'
export type { BeastPageBuilderOptions, ProjectScan, DetectedCollection, DetectedItem, ItemType, ItemField, NavigationTarget } from './shared/types.js'

export function beastPageBuilder(options: BeastPageBuilderOptions = {}): Plugin {
  let root = process.cwd()
  let base = '/'
  return {
    name: 'beast:page-builder', apply: 'serve',
    configResolved(config) { root = config.root; base = config.base },
    configureServer(server) {
      const builder = createBuilderServer(root, options, base)
      server.middlewares.use(builder.middleware)
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: `${base}${BASE.slice(1)}/client.js` }, injectTo: 'body' }]
    },
  }
}
