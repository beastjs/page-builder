import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuilderProject } from '../server/project.js'
import { templates } from '../client/templates.js'
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

describe('page editing', () => {
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
