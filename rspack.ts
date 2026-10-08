import type { Compiler, RspackPluginInstance } from '@rspack/core'
import { createBuilderServer } from './server/server.js'
import type { BeastPageBuilderOptions } from './shared/types.js'
export type { BeastPageBuilderOptions, ProjectScan, DetectedCollection, DetectedItem, ItemType, ItemField, NavigationTarget } from './shared/types.js'

export class BeastPageBuilderRspackPlugin implements RspackPluginInstance {
  constructor(readonly options: BeastPageBuilderOptions = {}) {}
  apply(compiler: Compiler): void {
    const configured = compiler.options.devServer
    if (configured === false) return
    const devServer = configured ?? (compiler.options.devServer = {})
    const previous = devServer.setupMiddlewares
    devServer.setupMiddlewares = (middlewares, server) => {
      const result = previous?.(middlewares, server) ?? middlewares
      // Rspack establishes the compiler platform after applying plugins.
      if (!compiler.platform.web) return result
      const builder = createBuilderServer(compiler.context, this.options)
      // Runs only under rspack serve; production entries are untouched.
      new compiler.rspack.EntryPlugin(compiler.context, builder.clientEntry, { name: undefined }).apply(compiler)
      const bundle = result.findIndex(middleware => typeof middleware === 'object' && middleware.name === '@rspack/dev-middleware')
      result.splice(bundle === -1 ? result.length : bundle, 0, { name: 'beast:page-builder', middleware: builder.middleware })
      return result
    }
  }
}
export function beastPageBuilder(options: BeastPageBuilderOptions = {}): BeastPageBuilderRspackPlugin {
  return new BeastPageBuilderRspackPlugin(options)
}
