import type { RsbuildPlugin } from '@rsbuild/core'
import { createBuilderServer, CLIENT_ENTRY } from './server/server.js'
import type { BeastPageBuilderOptions } from './shared/types.js'
export type { BeastPageBuilderOptions, ProjectScan, DetectedCollection, DetectedItem, ItemType, ItemField, NavigationTarget } from './shared/types.js'

export function beastPageBuilder(options: BeastPageBuilderOptions = {}): RsbuildPlugin {
  return {
    name: 'beast:page-builder', apply: 'serve',
    setup(api) {
      api.modifyEnvironmentConfig((config, { mergeEnvironmentConfig }) => {
        if (config.output.target !== 'web') return config
        return mergeEnvironmentConfig(config, { source: { preEntry: [CLIENT_ENTRY] } })
      })
      api.onBeforeStartDevServer(({ server }) => {
        server.middlewares.use(createBuilderServer(api.context.rootPath, options).middleware)
      })
    },
  }
}
