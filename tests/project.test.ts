import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuilderProject } from '../server/project.js'
import { templates } from '../client/templates.js'
import { templatesOf } from '../server/catalog/index.js'
import { sectionKinds } from '../shared/catalog/kinds.js'
import { HEADER, ROUTER } from './fixtures.js'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'beast-builder-'))
  roots.push(root)
  await mkdir(join(root, 'src/components'), { recursive: true })
  await mkdir(join(root, 'src/pages'), { recursive: true })
  await writeFile(join(root, 'src/components/Card.btsx'), 'component Badge\n  span Badge\n\narticle\n  Badge()\n')
  await writeFile(join(root, 'src/pages/HomePage.btsx'), 'main\n  h1 Hello\n')
  await writeFile(join(root, 'src/router.ts'), ROUTER)
  await writeFile(join(root, 'src/components/Header.btsx'), HEADER)
  return { root, project: new BuilderProject(root) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('project scanning', () => {
  test('scans real Beast files and local declarations once across overlapping directories', async () => {
    const { project } = await fixture()
    const report = await project.scan()
    expect(report.files.map(file => file.path)).toEqual(['src/components/Card.btsx', 'src/components/Header.btsx', 'src/pages/HomePage.btsx'])
    expect(report.files[0]!.components).toEqual(['Card', 'Badge'])
    expect(report.files[2]!.kind).toBe('page')
    expect(report.warnings).toEqual([])
  })
  test('keeps broken files in the inventory with their diagnostics', async () => {
    const { root, project } = await fixture()
    await writeFile(join(root, 'src/Broken.btsx'), 'main\n   p hello\n  span wrong indent\n')
    expect((await project.scan()).files.find(file => file.name === 'Broken')?.error).toBeTruthy()
  })
  test('ignores dependencies and symlinks and allows empty projects', async () => {
    const { root } = await fixture()
    await mkdir(join(root, 'src/node_modules'), { recursive: true })
    await writeFile(join(root, 'src/node_modules/Nope.btsx'), 'div Nope')
    await symlink(join(root, 'src/components/Card.btsx'), join(root, 'src/Duplicate.btsx'))
    expect((await new BuilderProject(root).scan()).files).toHaveLength(3)
    expect((await new BuilderProject(root, { include: ['empty'], pagesDir: 'empty/pages' }).scan()).files).toEqual([])
  })
  test('refuses source reads outside the scan directories', async () => {
    const { project } = await fixture()
    await expect(project.source('../Secret.btsx')).rejects.toThrow('outside')
    await expect(project.source('/tmp/Secret.btsx')).rejects.toThrow('project-relative')
    expect(await project.source('src/pages/HomePage.btsx')).toContain('h1 Hello')
  })
  test('refuses symlink escapes for reads and creation', async () => {
    const { root, project } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'beast-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'Secret.btsx'), 'main Secret')
    await symlink(outside, join(root, 'src/escape'))
    await expect(project.source('src/escape/Secret.btsx')).rejects.toThrow('outside')
    const escaped = new BuilderProject(root, { pagesDir: 'src/escape/pages' })
    await expect(escaped.preview({ name: 'Oops', source: templates.blank })).rejects.toThrow('outside')
  })
})

describe('page creation', () => {
  test('validates both starter templates and creates the exact reviewed source', async () => {
    const { root, project } = await fixture()
    for (const [key, source] of Object.entries(templates)) {
      const draft = { name: `${key === 'blank' ? 'Blank' : 'Landing'}Page`, source }
      const preview = await project.preview(draft)
      await expect(readFile(join(root, preview.path))).rejects.toThrow()
      await project.create(draft, preview.hash)
      expect(await readFile(join(root, preview.path), 'utf8')).toBe(preview.source)
    }
  })
  test('refuses changed drafts, invalid names, broken source, and overwrites', async () => {
    const { root, project } = await fixture()
    const draft = { name: 'AboutPage', source: templates.blank }
    const preview = await project.preview(draft)
    await expect(project.create({ ...draft, source: 'main Changed' }, preview.hash)).rejects.toThrow('changed')
    await expect(project.preview({ ...draft, name: '../Oops' })).rejects.toThrow('PascalCase')
    await expect(project.preview({ ...draft, source: 'main\n   p Hello\n  p Bad' })).rejects.toThrow()
    await project.create(draft, preview.hash)
    await expect(project.create(draft, preview.hash)).rejects.toThrow('already exists')
    expect(await readFile(join(root, preview.path), 'utf8')).toBe(preview.source)
  })
  test('exclusive writes prevent concurrent creation from replacing a file', async () => {
    const { project } = await fixture()
    const draft = { name: 'RacePage', source: templates.blank }
    const preview = await project.preview(draft)
    const results = await Promise.allSettled([project.create(draft, preview.hash), project.create(draft, preview.hash)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  })
  test('directory configuration cannot leave the project', async () => {
    const { root } = await fixture()
    expect(() => new BuilderProject(root, { include: ['../private'] })).toThrow('inside')
    expect(() => new BuilderProject(root, { pagesDir: '/tmp' })).toThrow('inside')
  })
})

describe('section discovery', () => {
  test('links studio section components to the pages that render them', async () => {
    const { project, root } = await fixture()
    await mkdir(join(root, 'src/sections'), { recursive: true })
    await writeFile(join(root, 'src/sections/Stats.btsx'), "section(data-section='stats')\n  p Numbers\n")
    await writeFile(join(root, 'src/sections/Unused.btsx'), "section(data-section='faq')\n  p Questions\n")
    await writeFile(join(root, 'src/pages/HomePage.btsx'), "import Stats from '../sections/Stats.btsx'\nimport type Unused from '../sections/Unused.btsx'\n\nmain\n  h1 Hello\n  Stats\n")
    const report = await project.scan()
    expect(report.sections.find(section => section.file === 'src/sections/Stats.btsx')).toEqual({
      id: 'src/sections/Stats.btsx:1:stats', elementId: 'stats', file: 'src/sections/Stats.btsx', line: 1, marker: 'data-section', kind: 'stats',
      usedBy: [{ file: 'src/pages/HomePage.btsx', line: 6 }],
    })
    expect(report.sections.find(section => section.file === 'src/sections/Unused.btsx')?.usedBy).toBeUndefined()
  })
})

describe('page editing', () => {
  test('discovers section IDs and reviews and saves their component file with stale review protection', async () => {
    const { project, root } = await fixture()
    const path = 'src/components/Header.btsx'
    await writeFile(join(root, path), HEADER.replace('header\n', 'header#topbar\n'))
    const router = await readFile(join(root, 'src/router.ts'), 'utf8')
    const report = await project.scan()
    expect(report.sections).toEqual([{ id: `${path}:2:topbar`, file: path, line: 2, elementId: 'topbar', kind: 'topbar' }])
    const source = (await project.source(path)).replace(' Home', ' Welcome')
    const draft = { name: 'Header', path, section: 'topbar', source }
    const preview = await project.preview(draft)
    expect(preview.section).toBe('topbar')
    expect(preview.files).toHaveLength(1)
    expect(preview.files[0]).toMatchObject({ path, source, action: 'edit' })
    await expect(project.preview({ ...draft, section: 'missing' })).rejects.toThrow('section changed')
    await expect(project.create({ ...draft, source: source + '\n' + 'p Changed\n' }, preview.hash)).rejects.toThrow('changed')
    await project.create(draft, preview.hash)
    expect(await project.source(path)).toBe(source)
    expect(await readFile(join(root, 'src/router.ts'), 'utf8')).toBe(router)
    expect((await project.creation(preview.hash)).section).toBe('topbar')
    const next = { ...draft, source: source.replace(' Welcome', ' Updated') }
    const reviewed = await project.preview(next)
    await writeFile(join(root, path), source.replace('#topbar', '#renamed'))
    await expect(project.create(next, reviewed.hash)).rejects.toThrow('section changed')
  })
  test('reviews and saves existing page content without touching router or navigation', async () => {
    const { project, root } = await fixture()
    const router = await readFile(join(root, 'src/router.ts'), 'utf8')
    const header = await readFile(join(root, 'src/components/Header.btsx'), 'utf8')
    const draft = { name: 'HomePage', path: 'src/pages/HomePage.btsx', source: 'main\n  h1 Updated page\n\nstyle\n  h1 { color: red; }\n' }
    const preview = await project.preview(draft)
    expect(preview.files).toEqual([{ path: draft.path, action: 'edit', before: 'main\n  h1 Hello\n', source: draft.source }])
    expect(preview.routePath).toBe('/')
    await project.create(draft, preview.hash)
    expect(await project.source(draft.path)).toBe(draft.source)
    expect(await readFile(join(root, 'src/router.ts'), 'utf8')).toBe(router)
    expect(await readFile(join(root, 'src/components/Header.btsx'), 'utf8')).toBe(header)
    expect(await project.creation(preview.hash)).toEqual(preview)
  })
  test('rejects stale review, changed drafts, invalid source and non-page paths', async () => {
    const { project, root } = await fixture()
    const draft = { name: 'HomePage', path: 'src/pages/HomePage.btsx', source: 'main\n  h1 Updated\n' }
    const preview = await project.preview(draft)
    await expect(project.create({ ...draft, source: 'main Another edit' }, preview.hash)).rejects.toThrow('changed')
    await writeFile(join(root, draft.path), 'main\n  h1 External edit\n')
    await expect(project.create(draft, preview.hash)).rejects.toThrow('changed')
    expect(await project.source(draft.path)).toContain('External edit')
    await expect(project.preview({ ...draft, source: 'main\n   p Bad\n  p Indent' })).rejects.toThrow()
    await expect(project.preview({ ...draft, path: 'src/components/Header.btsx' })).rejects.toThrow('page from')
    await expect(project.preview({ ...draft, path: '../Outside.btsx' })).rejects.toThrow('outside')
    await expect(project.create(draft, '')).rejects.toThrow('Review')
  })
})

describe('section installs', () => {
  test('installs a catalog section as a component, renders it on the page, and links it in the next scan', async () => {
    const { project, root } = await fixture()
    const draft = { page: 'src/pages/HomePage.btsx', template: 'stats-row' }
    const preview = await project.previewSection(draft)
    expect(preview).toMatchObject({ path: 'src/sections/Stats.btsx', page: draft.page, name: 'Stats', kind: 'stats', template: 'stats-row' })
    expect(preview.files.map(file => [file.path, file.action])).toEqual([['src/sections/Stats.btsx', 'create'], [draft.page, 'edit']])
    expect(preview.files[1]!.source).toBe("import Stats from '../sections/Stats.btsx'\n\nmain\n  h1 Hello\n  Stats\n")
    await project.installSection(draft, preview.hash)
    expect(await readFile(join(root, 'src/sections/Stats.btsx'), 'utf8')).toContain("data-section='stats'")
    expect(await project.sectionInstall(preview.hash)).toEqual(preview)
    const report = await project.scan()
    expect(report.files.find(file => file.path === 'src/sections/Stats.btsx')?.kind).toBe('component')
    expect(report.sections.find(section => section.file === 'src/sections/Stats.btsx')?.usedBy).toEqual([{ file: draft.page, line: 5 }])

    // A second section of the same kind is numbered, placed in story order, and never replaces the first.
    const again = await project.previewSection({ ...draft, template: 'stats-story' })
    expect(again).toMatchObject({ name: 'Stats2', path: 'src/sections/Stats2.btsx' })
    const hero = await project.previewSection({ ...draft, template: templatesOf('hero')[0]!.id })
    expect(hero.files[1]!.source).toBe("import Stats from '../sections/Stats.btsx'\nimport Hero from '../sections/Hero.btsx'\n\nmain\n  h1 Hello\n  Hero\n  Stats\n")
  })

  test('one template of every kind previews as an install that compiles on a page', async () => {
    // tests/catalog.test.ts compiles every template; this covers each kind's name and page wiring.
    const { project } = await fixture()
    const failures: string[] = []
    for (const template of sectionKinds.map(kind => templatesOf(kind.id)[0]!)) {
      try { await project.previewSection({ page: 'src/pages/HomePage.btsx', template: template.id }) }
      catch (error) { failures.push(`${template.id}: ${error instanceof Error ? error.message.split('\n')[0] : error}`) }
    }
    expect(failures).toEqual([])
  }, 20_000)

  test('rejects taken names, unknown inputs, and stale reviews', async () => {
    const { project, root } = await fixture()
    const draft = { page: 'src/pages/HomePage.btsx', template: 'stats-row' }
    await mkdir(join(root, 'src/sections'), { recursive: true })
    await writeFile(join(root, 'src/sections/Stats.btsx'), "section(data-section='stats')\n  p Mine\n")
    expect((await project.previewSection(draft)).name).toBe('Stats2')
    await expect(project.previewSection({ ...draft, name: 'Stats' })).rejects.toThrow('already used')
    await expect(project.previewSection({ ...draft, name: 'HomePage' })).rejects.toThrow('already used')
    await expect(project.previewSection({ ...draft, name: 'stats' })).rejects.toThrow('PascalCase')
    await expect(project.previewSection({ ...draft, template: 'missing' })).rejects.toThrow('Unknown section template')
    await expect(project.previewSection({ ...draft, page: 'src/components/Card.btsx' })).rejects.toThrow('Choose a page')
    const preview = await project.previewSection({ ...draft, name: 'Numbers' })
    await writeFile(join(root, 'src/pages/HomePage.btsx'), 'main\n  h1 Changed\n')
    await expect(project.installSection({ ...draft, name: 'Numbers' }, preview.hash)).rejects.toThrow('Review again')
    await expect(readFile(join(root, 'src/sections/Numbers.btsx'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'src/sections/Stats.btsx'), 'utf8')).toContain('Mine')
  })

  test('adds the studio base styles to the Tailwind stylesheet once, and warns when Tailwind is missing', async () => {
    const { project, root } = await fixture()
    const draft = { page: 'src/pages/HomePage.btsx', template: 'stats-row' }
    expect((await project.previewSection(draft)).warnings).toHaveLength(2)
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' } }))
    await writeFile(join(root, 'src/style.css'), '@import "tailwindcss";\n')
    expect((await project.scan()).tailwind).toEqual({ version: '^4.1.0', integration: '@tailwindcss/vite', stylesheet: 'src/style.css', ready: true })
    const preview = await project.previewSection(draft)
    expect(preview.warnings).toEqual([])
    expect(preview.files.map(file => [file.path, file.action])).toEqual([['src/sections/Stats.btsx', 'create'], [draft.page, 'edit'], ['src/style.css', 'edit']])
    await project.installSection(draft, preview.hash)
    expect(await readFile(join(root, 'src/style.css'), 'utf8')).toContain('@keyframes studio-marquee')
    const next = await project.previewSection({ ...draft, template: 'stats-story' })
    expect(next.files.map(file => file.path)).toEqual(['src/sections/Stats2.btsx', draft.page])
  })

  test('reads Tailwind from the package above a nested bundler root, stopping at the repository', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'beast-builder-repo-')); roots.push(outer)
    const repository = join(outer, 'repo'), app = join(repository, 'playground')
    await mkdir(join(repository, '.git'), { recursive: true })
    await mkdir(join(app, 'src'), { recursive: true })
    await writeFile(join(outer, 'package.json'), JSON.stringify({ devDependencies: { tailwindcss: '^3.0.0' } }))
    await writeFile(join(repository, 'package.json'), JSON.stringify({ devDependencies: { tailwindcss: '^4.3.3', '@tailwindcss/vite': '^4.3.3' } }))
    await writeFile(join(app, 'src/style.css'), '@import "tailwindcss/utilities.css" layer(utilities);\n')
    expect((await new BuilderProject(app).scan()).tailwind).toEqual({ version: '^4.3.3', integration: '@tailwindcss/vite', stylesheet: 'src/style.css', ready: true })
  })

  test('sectionsDir defaults beside pagesDir and must stay out of page folders', async () => {
    const { root } = await fixture()
    expect(new BuilderProject(root).sectionsDir).toBe('src/sections')
    expect(new BuilderProject(root, { pagesDir: 'app/pages' }).sectionsDir).toBe('app/sections')
    expect(new BuilderProject(root).include).toContain('src/sections')
    expect(() => new BuilderProject(root, { sectionsDir: 'src/pages/sections' })).toThrow('outside pagesDir')
    expect(() => new BuilderProject(root, { sectionsDir: 'src/routes/blocks' })).toThrow('outside pagesDir')
    expect(() => new BuilderProject(root, { sectionsDir: '../elsewhere' })).toThrow('inside')
  })
})
