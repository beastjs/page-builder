import { existsSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { beastOctane } from 'beast-tsrx/vite'
import tailwindcss from '@tailwindcss/vite'
import { browserFixtureRoot } from '../tests/browser-fixture.js'
import { ROUTER } from '../tests/fixtures.js'

const { beastPageBuilder } = await import(pathToFileURL(resolve('dist/vite.js')).href)

// Preserve the playground's relative imports into shared src/ while keeping writes in our own cache.
const fixture = dirname(browserFixtureRoot)
await rm(fixture, { recursive: true, force: true })
await mkdir(join(browserFixtureRoot, 'src/components'), { recursive: true })
await mkdir(join(browserFixtureRoot, 'src/pages'), { recursive: true })
await cp('src', join(fixture, 'src'), { recursive: true })
for (const file of ['main.ts', 'style.css', 'lib/sections.ts', 'pages/Home.btsx', 'components/Header.btsx', 'components/ProjectCard.btsx', 'components/SectionTabs.btsx', 'components/Tabs.btsx']) {
  await mkdir(dirname(join(browserFixtureRoot, 'src', file)), { recursive: true })
  await cp(join('playground/src', file), join(browserFixtureRoot, 'src', file))
}
// Sections installed into the playground are imported by its pages, so they travel with them.
if (existsSync('playground/src/sections')) await cp('playground/src/sections', join(browserFixtureRoot, 'src/sections'), { recursive: true })
await cp('playground/index.html', join(browserFixtureRoot, 'index.html'))
await writeFile(join(browserFixtureRoot, 'src/router.ts'), ROUTER.replaceAll('HomePage', 'Home'))
await writeFile(join(browserFixtureRoot, 'src/App.btsx'), "import Header from './components/Header.btsx'\nimport { Outlet } from '@octanejs/tanstack-router'\n\nmain.workspace\n  Header\n  Outlet\n")
const server = await createServer({
  configFile: false,
  root: browserFixtureRoot,
  plugins: [beastOctane(), tailwindcss(), beastPageBuilder()],
  server: { port: 5191, strictPort: true, host: '127.0.0.1', fs: { allow: [resolve('.')] } }
})
await server.listen()
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => process.exit(0)) })
