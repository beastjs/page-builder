import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { BuilderProject } from '../server/project.js'
import { addTabs, discoverPageRoutes, discoverTabInstances } from '../server/tabs.js'
import type { TabsDraft } from '../shared/types.js'
import { ROUTER } from './fixtures.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'builder-tabs-')); roots.push(root)
  // Inspect the actual Tabs component and its imported icon union.
  for (const file of ['src/ui/Tabs.btsx', 'src/lib/icons/index.ts', 'src/lib/icons/icons.ts', 'src/lib/icons/types.ts']) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), await readFile(file, 'utf8'))
  }
  await mkdir(join(root, 'src/pages'), { recursive: true })
  await writeFile(join(root, 'src/pages/HomePage.btsx'), 'main\n  h1 Home\n\nstyle\n  main { padding: 20px; }\n')
  await writeFile(join(root, 'src/router.ts'), ROUTER)
  const project = new BuilderProject(root)
  const draft: TabsDraft = { page: 'src/pages/HomePage.btsx', routePath: '/', component: 'src/ui/Tabs.btsx', label: 'Page sections', active: 'one', items: [
    { href: '#one', id: 'one', label: 'First', shortLabel: 'One', icon: 'menu' },
    { href: '#two', id: 'two', label: 'Second', shortLabel: 'Two', icon: 'search' },
  ] }
  return { root, project, draft }
}

test('discovers the real Tabs props and resolves IconName to selectable values', async () => {
  const { project } = await fixture()
  const report = await project.scan()
  expect(report.pageRoutes).toEqual([{ file: 'src/pages/HomePage.btsx', name: 'HomePage', routePath: '/' }])
  expect(report.tabComponents).toHaveLength(1)
  const component = report.tabComponents[0]!
  expect(component).toMatchObject({ name: 'Tabs', itemProp: 'items', activeProp: 'activeId', labelProp: 'label', itemType: { name: 'TabItem', origin: 'declared' } })
  expect(component.reason).toBeUndefined()
  expect(component.itemType.fields.map(field => field.name)).toEqual(['href', 'id', 'label', 'shortLabel', 'icon'])
  expect(component.itemType.fields.find(field => field.name === 'icon')?.values?.sort()).toEqual(['arrow-right', 'close', 'menu', 'search'])
})

test('route discovery handles nested paths, import aliases, direct and lazy components', () => {
  const source = `import { createRootRoute as root, createRoute as route, createRouter } from '@octanejs/tanstack-router'
import Home from './pages/Home.btsx'
const rootRoute = root({})
const home = route({ getParentRoute: () => rootRoute, path: '/', component: Home })
const settings = route({ getParentRoute: () => rootRoute, path: '/settings' })
const profile = route({ getParentRoute: () => settings, path: '/profile', component: lazyPage(() => import('./pages/Profile.btsx')) })
const dynamic = route({ getParentRoute: () => rootRoute, path: '/users/$id', component: Home })
const unused = route({ getParentRoute: () => rootRoute, path: '/unused', component: Home })
const tree = rootRoute.addChildren([home, settings.addChildren([profile]), dynamic])
export const router = createRouter({ routeTree: tree })`
  const files = ['Home', 'Profile'].map(name => ({ path: `src/pages/${name}.btsx`, name, kind: 'page' as const, lines: 1, components: [], error: null }))
  expect(discoverPageRoutes(source, 'src/router.ts', files)).toEqual([
    { file: 'src/pages/Home.btsx', name: 'Home', routePath: '/' },
    { file: 'src/pages/Profile.btsx', name: 'Profile', routePath: '/settings/profile' },
  ])
})

test('reviews and saves Tabs in the page container while preserving its content and styles', async () => {
  const { project, root, draft } = await fixture()
  const preview = await project.previewTabs(draft)
  expect(preview.files).toHaveLength(1)
  expect(preview.source).toContain('import PageTabs from "../ui/Tabs.btsx"')
  expect(preview.source).toContain('main\n  PageTabs(items={')
  expect(preview.source).toContain('activeId={"one"} label="Page sections"')
  expect(preview.source).toContain('\n  h1 Home\n\nstyle\n  main { padding: 20px; }')
  await project.createTabs(draft, preview.hash)
  expect(await readFile(join(root, draft.page), 'utf8')).toBe(preview.source)
  expect(await project.tabCreation(preview.hash)).toEqual(preview)
  await expect(project.createTabs(draft, preview.hash)).rejects.toThrow('changed')
})

test('reuses an existing component import, avoids conflicting names, and supports component roots', async () => {
  const { project, draft } = await fixture()
  const component = (await project.scan()).tabComponents[0]!
  const existing = 'import Sections from "../ui/Tabs.btsx"\n\nmain\n  h1 Home\n'
  const reused = addTabs(existing, component, draft)
  expect(reused.match(/import /g)).toHaveLength(1)
  expect(reused).toContain('  Sections(items={')
  const componentRoot = 'import PageTabs from "../Layout.btsx"\n\nPageTabs\n'
  expect(addTabs(componentRoot, component, draft)).toContain('import PageTabs2 from "../ui/Tabs.btsx"')
  expect(addTabs(componentRoot, component, draft)).toContain('\nPageTabs2(items={')
})

test('rejects invalid fields, duplicate IDs, absent routes and changed reviewed source', async () => {
  const { project, draft, root } = await fixture()
  await expect(project.previewTabs({ ...draft, items: [{ ...draft.items[0]!, icon: 'unknown' }] })).rejects.toThrow('icon')
  await expect(project.previewTabs({ ...draft, items: [{ ...draft.items[0]!, shortLabel: '' }] })).rejects.toThrow('shortLabel')
  await expect(project.previewTabs({ ...draft, items: [draft.items[0]!, draft.items[0]!] })).rejects.toThrow('unique id')
  await expect(project.previewTabs({ ...draft, active: 'missing' })).rejects.toThrow('active tab')
  await expect(project.previewTabs({ ...draft, page: '../Secret.btsx' })).rejects.toThrow('page route')
  const preview = await project.previewTabs(draft)
  await writeFile(join(root, draft.page), 'main\n  h1 External edit\n')
  await expect(project.createTabs(draft, preview.hash)).rejects.toThrow('changed')
  expect(await readFile(join(root, draft.page), 'utf8')).toBe('main\n  h1 External edit\n')
})

test('rejects changed component contracts', async () => {
  const { project, draft, root } = await fixture()
  const preview = await project.previewTabs(draft)
  await writeFile(join(root, draft.component), (await readFile(join(root, draft.component), 'utf8')) + '\n// changed\n')
  await expect(project.createTabs(draft, preview.hash)).rejects.toThrow('changed')
})

test('discovers saved tabs and updates the selected group without duplicating or changing other groups', async () => {
  const { project, root, draft } = await fixture()
  const component = (await project.scan()).tabComponents[0]!
  const original = await project.source(draft.page)
  let source = addTabs(original, component, draft)
  source = addTabs(source, component, { ...draft, label: 'Other tabs' })
  source = source.replace('label="Page sections"', 'label="Page sections" className="keep-me"')
  await writeFile(join(root, draft.page), source)
  const instances = (await project.scan()).tabInstances
  expect(instances).toHaveLength(2)
  const editing = instances.find(instance => instance.draft?.label === 'Page sections')!.draft!
  expect(editing.items).toEqual(draft.items)
  editing.items[0]!.label = 'Updated first'
  editing.items.push({ href: '#three', id: 'three', label: 'Third', shortLabel: 'Three', icon: 'close' })
  editing.active = 'three'
  editing.label = 'Updated sections'
  const preview = await project.previewTabs(editing)
  expect(preview.source.match(/PageTabs\(items=/g)).toHaveLength(2)
  expect(preview.source).toContain('className="keep-me"')
  expect(preview.source).toContain('label="Other tabs"')
  expect(preview.source).toContain('activeId={"three"}')
  expect(preview.source).toContain('Updated first')
  expect(preview.source).toContain('h1 Home\n\nstyle\n  main { padding: 20px; }')
  await project.createTabs(editing, preview.hash)
  expect(await readFile(join(root, draft.page), 'utf8')).toBe(preview.source)
  await expect(project.previewTabs(editing)).rejects.toThrow('selected tabs changed')
})

test('tab edits reject changed source, invalid items and stale group identities', async () => {
  const { project, root, draft } = await fixture()
  await project.createTabs(draft, (await project.previewTabs(draft)).hash)
  const editing = (await project.scan()).tabInstances[0]!.draft!
  editing.items[0]!.label = 'Edited'
  const preview = await project.previewTabs(editing)
  await expect(project.createTabs({ ...editing, active: 'missing' }, preview.hash)).rejects.toThrow('active tab')
  await expect(project.createTabs({ ...editing, label: 'Changed draft' }, preview.hash)).rejects.toThrow('changed')
  const before = await project.source(draft.page)
  await writeFile(join(root, draft.page), before + '\n// external edit\n')
  await expect(project.createTabs(editing, preview.hash)).rejects.toThrow('changed')
  expect(await project.source(draft.page)).toContain('// external edit')
  await writeFile(join(root, draft.page), before.replace('label="Page sections"', 'label="External tabs"'))
  await expect(project.previewTabs(editing)).rejects.toThrow('selected tabs changed')
})

test('tab editing handles multiline props, aliases, omitted labels and Windows newlines', async () => {
  const { project, draft } = await fixture()
  const component = (await project.scan()).tabComponents[0]!
  for (const newline of ['\n', '\r\n']) {
    const source = ['import Sections from "../ui/Tabs.btsx"', '', 'main', '  Sections(', `    ~ items={${JSON.stringify(draft.items)}}`, '    ~ activeId={"one"}', '    ~ className="preserved"', '    ~ )', '  h1 Keep this', ''].join(newline)
    const instance = discoverTabInstances(source, { file: draft.page, name: 'Home', routePath: '/' }, [component])[0]!
    expect(instance.draft).toBeDefined()
    const updated = addTabs(source, component, { ...instance.draft!, label: 'Added label', active: 'two' })
    expect(updated).toContain('className="preserved"')
    expect(updated).toContain('label={"Added label"}')
    expect(updated).toContain('activeId={"two"}')
    expect(updated).toContain('  h1 Keep this')
    expect(updated.split(newline)).toHaveLength(source.split(newline).length)
    const next = discoverTabInstances(updated, { file: draft.page, name: 'Home', routePath: '/' }, [component])[0]!
    expect(next.draft?.label).toBe('Added label')
    expect(next.draft?.active).toBe('two')
  }
})

test('computed tab props stay read-only in the form and cannot be replaced through the edit API', async () => {
  const { project, draft } = await fixture()
  const component = (await project.scan()).tabComponents[0]!
  for (const props of ['items={getItems()} activeId="one"', `items={${JSON.stringify(draft.items)}} activeId={selected}`, `items={${JSON.stringify(draft.items)}} activeId="one" {...props}`]) {
    const source = `import Sections from "../ui/Tabs.btsx"\nmain\n  Sections(${props})\n`
    const instance = discoverTabInstances(source, { file: draft.page, name: 'Home', routePath: '/' }, [component])[0]!
    expect(instance.draft).toBeUndefined()
    expect(instance.reason).toContain('page source')
    expect(() => addTabs(source, component, { ...draft, instance: instance.id })).toThrow('page source')
  }
})
