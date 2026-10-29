// Copies the Design Studio section catalog from a play checkout. play is the authoring source;
// edit sections there and rerun this rather than editing the copies here.
// Usage: bun scripts/sync-catalog.ts [--from ~/Code/play] [--check]
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { STUDIO_STYLES } from '../server/styles.js'

const { values } = parseArgs({ options: { from: { type: 'string' }, check: { type: 'boolean' } } })
const studio = path.join(values.from?.replace(/^~/, homedir()) ?? path.join(homedir(), 'Code/play'), 'src/playground/studio')
const HEADER = '// Synced from play/src/playground/studio by scripts/sync-catalog.ts. Do not edit by hand.\n'

// Client-safe modules go to shared/; template sources stay server-only so they never reach dist/client.js.
const files = new Map<string, string>()
const relink = (source: string) => HEADER + source.replace(/from '(\.\.?\/[^']+)'/g, "from '$1.js'")
files.set('shared/catalog/types.ts', relink(await readFile(path.join(studio, 'types.ts'), 'utf8')))
files.set('shared/catalog/kinds.ts', relink(await readFile(path.join(studio, 'kinds.ts'), 'utf8')))
const sections = (await readdir(path.join(studio, 'sections'))).filter(name => name.endsWith('.ts')).sort()
for (const name of sections) {
  const source = await readFile(path.join(studio, 'sections', name), 'utf8')
  files.set(`server/catalog/sections/${name}`, relink(source).replace("from '../types.js'", "from '../../../shared/catalog/types.js'"))
}

// The base styles live in play's page composer, which cannot be copied whole, so only their text is compared.
const template = (source: string, name: string) => source.match(new RegExp(`const ${name} = \`([^\`]*)\``))?.[1]
const page = await readFile(path.join(studio, 'page.ts'), 'utf8')
const themes = await readFile(path.join(studio, 'themes.ts'), 'utf8')
const marker = page.match(/const STYLES_MARKER = '([^']*)'/)?.[1]
const upstreamStyles = template(page, 'STUDIO_STYLES')?.replace('${STYLES_MARKER}', marker ?? '').replace('${THEME_BASE}', template(themes, 'THEME_BASE') ?? '')
const stylesStale = upstreamStyles !== STUDIO_STYLES

if (values.check) {
  const stale: string[] = stylesStale ? ['server/styles.ts STUDIO_STYLES (update by hand)'] : []
  for (const [file, source] of files) if (await readFile(file, 'utf8').catch(() => '') !== source) stale.push(file)
  const extra = (await readdir('server/catalog/sections')).filter(name => !sections.includes(name))
  if (stale.length || extra.length) {
    console.error(`Catalog is out of sync with ${studio}:\n${[...stale, ...extra.map(name => `server/catalog/sections/${name} (removed upstream)`)].join('\n')}`)
    process.exit(1)
  }
  console.log(`Catalog matches ${studio} (${sections.length} section files).`)
} else {
  await rm('server/catalog/sections', { recursive: true, force: true })
  for (const [file, source] of files) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, source)
  }
  console.log(`Synced ${sections.length} section files from ${studio}. Register new kinds in server/catalog/index.ts.`)
  if (stylesStale) console.warn('STUDIO_STYLES in server/styles.ts no longer matches play; update it by hand.')
}
