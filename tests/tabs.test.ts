import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { BuilderProject } from '../server/project.js'
import { addTabs, discoverPageRoutes } from '../server/tabs.js'
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
