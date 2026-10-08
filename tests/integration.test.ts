import { afterEach, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuilderProject } from '../server/project.js'
import { addNavigation, discoverNavigation, registerRoute } from '../server/integration.js'
import { HEADER, ROUTER } from './fixtures.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'builder-integration-')); roots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/router.ts'), ROUTER)
  await writeFile(join(root, 'src/Header.btsx'), HEADER)
  return { root, project: new BuilderProject(root) }
}
const draft = { name: 'PricingPage', source: 'main\n  h1 Pricing\n', routePath: '/pricing', navLabel: 'Pricing' }

test('review and save include the exact page, route, and navigation with permissions preserved', async () => {
  const { root, project } = await fixture()
  await chmod(join(root, 'src/router.ts'), 0o664)
  const preview = await project.preview(draft)
  expect(preview.files.map(file => [file.path, file.action])).toEqual([['src/pages/PricingPage.btsx', 'create'], ['src/router.ts', 'edit'], ['src/Header.btsx', 'edit']])
  expect(preview.files[1]!.source).toContain('import("./pages/PricingPage.btsx")')
  expect(preview.files[1]!.source).toContain('addChildren([indexRoute, pricingPageRoute])')
  expect(preview.files[2]!.source).toContain('Link(to="/pricing") #{"Pricing"}')
  await project.create(draft, preview.hash)
  for (const file of preview.files) expect(await readFile(join(root, file.path), 'utf8')).toBe(file.source)
  expect((await stat(join(root, 'src/router.ts'))).mode & 0o777).toBe(0o664)
  expect(await readdir(join(root, 'src'))).not.toContain(expect.stringContaining('.tmp'))
})

test('an edited router or menu invalidates review before any new file is created', async () => {
  const { root, project } = await fixture()
  let preview = await project.preview(draft)
  await writeFile(join(root, 'src/router.ts'), ROUTER + '// user change\n')
  await expect(project.create(draft, preview.hash)).rejects.toThrow('changed')
  expect(await readFile(join(root, 'src/Header.btsx'), 'utf8')).toBe(HEADER)
  await expect(readFile(join(root, preview.path))).rejects.toThrow()
  preview = await project.preview(draft)
  await writeFile(join(root, 'src/Header.btsx'), HEADER + '  p User change\n')
  await expect(project.create(draft, preview.hash)).rejects.toThrow('changed')
  expect(await readFile(join(root, 'src/router.ts'), 'utf8')).toBe(ROUTER + '// user change\n')
  await expect(readFile(join(root, preview.path))).rejects.toThrow()
})

test('duplicate routes and links, invalid URLs, and missing integrations are refused', async () => {
  const { root, project } = await fixture()
  await expect(project.preview({ ...draft, routePath: '/Bad URL' })).rejects.toThrow('static URL')
  await expect(project.preview({ ...draft, navLabel: 'Bad\nlabel' })).rejects.toThrow('navigation label')
  await project.create(draft, (await project.preview(draft)).hash)
  await expect(project.preview({ ...draft, name: 'OtherPage' })).rejects.toThrow('Route /pricing already exists')
  const nav = 'nav\n  a(href="/other") Other\n'
  const target = discoverNavigation(nav, 'src/Nav.btsx')[0]!
  expect(() => addNavigation(nav, target, '/other', 'Other')).toThrow('already links')
  await rm(join(root, 'src/router.ts'))
  await expect(project.preview({ ...draft, name: 'MissingPage', routePath: '/missing' })).rejects.toThrow('missing')
})

test('two separately reviewed pages cannot replace each other’s router/menu updates', async () => {
  const { root, project } = await fixture()
  const second = { ...draft, name: 'AboutPage', routePath: '/about', navLabel: 'About' }
  const [one, two] = await Promise.all([project.preview(draft), project.preview(second)])
  const outcomes = await Promise.allSettled([project.create(draft, one.hash), project.create(second, two.hash)])
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(await readFile(join(root, 'src/router.ts'), 'utf8')).toContain('"/pricing"')
  await expect(readFile(join(root, 'src/pages/AboutPage.btsx'))).rejects.toThrow()
})

test('failed staging leaves every original file intact and cleans temporary files', async () => {
  const { root } = await fixture()
  await mkdir(join(root, 'src/menu'))
  const nav = join(root, 'src/menu/Nav.btsx')
  await writeFile(nav, HEADER)
  const project = new BuilderProject(root, { navigation: { file: 'src/menu/Nav.btsx' } })
  const preview = await project.preview(draft)
  await chmod(join(root, 'src/menu'), 0o555)
  try { await expect(project.create(draft, preview.hash)).rejects.toThrow() }
  finally { await chmod(join(root, 'src/menu'), 0o755) }
  expect(await readFile(join(root, 'src/router.ts'), 'utf8')).toBe(ROUTER)
  expect(await readFile(nav, 'utf8')).toBe(HEADER)
  await expect(readFile(join(root, preview.path))).rejects.toThrow()
  expect((await readdir(join(root, 'src'))).filter(name => name.endsWith('.tmp'))).toEqual([])
})

test('supports aliased router imports, lazyPage wrappers, comments, and custom page directories', () => {
  const source = ROUTER.replace('createRoute,', 'createRoute as route,').replace('= createRoute(', '= route(').replace('lazyRouteComponent(()', 'lazyPage(()').replace('const routeTree', 'function lazyPage(loader: any) { return lazyRouteComponent(loader) }\nconst routeTree').replace('[indexRoute]', '[\n  indexRoute, // keep this comment\n]')
  const result = registerRoute(source, 'src/router.ts', 'views/Pricing.btsx', 'Pricing', '/pricing')
  expect(result).toContain('= route({')
  expect(result).toContain('lazyPage(() => import("../views/Pricing.btsx"))')
  expect(result).toContain('indexRoute, // keep this comment')
  expect(result).toContain('pricingRoute,\n]')
  const noLazy = ROUTER.replace(', lazyRouteComponent', '').replace("lazyRouteComponent(() => import('./pages/HomePage.btsx'))", 'App')
  expect(registerRoute(noLazy, 'src/router.ts', 'src/pages/Pricing.btsx', 'Pricing', '/pricing')).toContain('createRouter, lazyRouteComponent')
})

test('grouped TypeScript menu items retain the host schema and existing groups', async () => {
  const { root } = await fixture()
  const navs = `export const navGroups = [
  { title: 'Workspace', items: [{ href: '/', label: 'Home', icon: 'folder', value: 'home', short: 'Home', tags: ['home'] }] },
  { title: 'Resources', items: [{ href: 'https://example.com', label: 'Docs' }] }
] as const\n`
  await writeFile(join(root, 'src/navs.ts'), navs)
  const project = new BuilderProject(root, { navigation: { file: 'src/navs.ts', array: 'navGroups', group: 'Workspace', itemDefaults: { icon: 'page' } } })
  expect((await project.scan()).navigationTargets).toHaveLength(1)
  const preview = await project.preview(draft)
  const menu = preview.files[2]!.source
  expect(menu).toContain('"href": "/pricing", "label": "Pricing"')
  expect(menu).toContain('"value": "pricing"')
  expect(menu).toContain('"icon": "page"')
  expect(menu).toContain("{ title: 'Resources', items: [{ href: 'https://example.com', label: 'Docs' }] }")
  await project.create(draft, preview.hash)
})

test('menu discovery requires explicit selection when several menus are available', async () => {
  const { root, project } = await fixture()
  await writeFile(join(root, 'src/OtherNav.btsx'), 'nav.secondary\n  a(href="/") Home\n')
  await expect(project.preview(draft)).rejects.toThrow('Choose a navigation menu')
  const target = (await project.scan()).navigationTargets.find(target => target.file === 'src/OtherNav.btsx')!
  const preview = await project.preview({ ...draft, navigationTarget: target.id })
  expect(preview.files[2]!.path).toBe('src/OtherNav.btsx')
})

test('BTSX labels remain literal and nested link content is preserved', () => {
  const nav = 'header\n  nav.menu\n    Link(\n      ~ to="/"\n      ~ className="nav-link"\n      ~ )\n      span Home\n  p Outside\n'
  const label = 'Pricing #{value} " special'
  const result = addNavigation(nav, discoverNavigation(nav, 'src/Header.btsx')[0]!, '/pricing', label)
  expect(result).toContain('      span Home\n    Link(to="/pricing" className="nav-link")')
  expect(result).toContain('#{' + JSON.stringify(label) + '}\n  p Outside')
})
