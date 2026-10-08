import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BuilderProject } from '../server/project.js'
import { HEADER, ROUTER } from './fixtures.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'builder-discovery-')); roots.push(root)
  for (const [file, source] of Object.entries(files)) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), source) }
  return { root, project: new BuilderProject(root) }
}
const contract = `export interface NavItem { href: string; label: string; icon: 'page' | 'folder'; disabled?: boolean; priority: number }`

test('discovers arrays in arbitrary modules and resolves imported item contracts through tsconfig paths', async () => {
  const { project } = await fixture({
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    'src/contracts.ts': contract,
    'src/data.ts': `import type { NavItem } from '@/contracts'; export const workspaceEntries: NavItem[] = [{ href: '/', label: 'Home', icon: 'folder', priority: 1 }]`,
    'src/Header.btsx': `import { workspaceEntries as entries } from './data'\n\nnav.main\n  each item in entries\n    a(href={item.href}) #{item.label}\n`,
  })
  const report = await project.scan()
  const data = report.collections.find(collection => collection.name === 'workspaceEntries')!
  expect(data.itemType.name).toBe('NavItem')
  expect(data.itemType.origin).toBe('declared')
  expect(data.itemType.fields.find(field => field.name === 'icon')?.values).toEqual(['page', 'folder'])
  expect(data.itemType.fields.find(field => field.name === 'disabled')?.optional).toBe(true)
  expect(data.consumers.map(consumer => consumer.file)).toEqual(['src/Header.btsx'])
  const nav = report.collections.find(collection => collection.source === 'markup')!
  expect(nav.bindings).toEqual(['entries'])
  expect(nav.items[0]?.label).toBe('Home')
  expect(nav.items[0]?.itemType.name).toBe('NavItem')
  expect(report.navigationTargets.map(target => target.array)).toEqual(['workspaceEntries'])
})

test('tablist semantics resolve aliased data without a conventional array name', async () => {
  const { project } = await fixture({
    'src/types.ts': `export interface Section { value: 'overview' | 'activity'; label: string; disabled?: boolean }`,
    'src/data.ts': `import type { Section } from './types'; export const sections: Section[] = [{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity', disabled: true }]`,
    'src/pages/Home.btsx': `import { sections as entries } from '../data'\n\nnav(role="tablist")\n  each item in entries\n    button(role="tab" value={item.value}) #{item.label}\n`,
  })
  const report = await project.scan()
  expect(report.collections).toHaveLength(2)
  for (const collection of report.collections) {
    expect(collection.kind).toBe('tabs')
    expect(collection.items.map(item => item.kind)).toEqual(['tab', 'tab'])
    expect(collection.itemType.name).toBe('Section')
  }
  expect(report.navigationTargets).toHaveLength(0)
})

test('each item retains its discriminated union variant and semantic kind', async () => {
  const { project } = await fixture({ 'src/data.ts': `
    type LinkItem = { kind: 'link'; href: string; label: string }
    type ActionItem = { kind: 'action'; onClick: () => void; label: string }
    export const menuItems: (LinkItem | ActionItem)[] = [
      { kind: 'link', href: '/about', label: 'About' },
      { kind: 'link', href: 'https://example.com', label: 'Docs' },
      { kind: 'action', onClick: () => {}, label: 'Refresh' }
    ]` })
  const data = (await project.scan()).collections[0]!
  expect(data.itemType.variants?.map(type => type.name)).toEqual(['LinkItem', 'ActionItem'])
  expect(data.items.map(item => [item.kind, item.itemType.name])).toEqual([['internal-link', 'LinkItem'], ['external-link', 'LinkItem'], ['action', 'ActionItem']])
})

test('inventories page-local menus, static tabs, anchors and actions without offering tabs as page targets', async () => {
  const { project } = await fixture({
    'src/Header.btsx': HEADER,
    'src/pages/Home.btsx': 'main\n  nav.local\n    a(href="#details") Details\n    button(onClick={() => {}}) Refresh\n  div(role="tablist")\n    button(role="tab" value="one") First\n    button(role="tab" value="two") Second\n',
  })
  const report = await project.scan()
  const local = report.collections.find(collection => collection.name === 'nav.local')!
  expect(local.items.map(item => item.kind)).toEqual(['anchor', 'action'])
  expect(local.editable).toBe(false)
  const tabs = report.collections.find(collection => collection.kind === 'tabs')!
  expect(tabs.items.map(item => item.value)).toEqual(['one', 'two'])
  expect(report.navigationTargets.map(target => target.file)).toEqual(['src/Header.btsx'])
})

test('acquires imported BTSX item props and local module contracts', async () => {
  const { project } = await fixture({
    'src/NavItem.btsx': 'module\n  export interface NavItemProps { href: string; label: string; icon?: string }\nprops { href, label }: NavItemProps\na(href={href}) #{label}\n',
    'src/Header.btsx': `import NavItem from './NavItem.btsx'\n\nnav\n  NavItem(href="/docs" label="Docs")\n`,
    'src/Tabs.btsx': `module\n  interface LocalTab { id: string; label: string }\nsetup\n  const tabs: LocalTab[] = [{ id: 'first', label: 'First' }]\ndiv(role="tablist")\n  each tab in tabs\n    button(role="tab") #{tab.label}\n`,
  })
  const report = await project.scan()
  const item = report.collections.find(collection => collection.file === 'src/Header.btsx')!.items[0]!
  expect(item.itemType.name).toBe('NavItemProps')
  expect(item.itemType.fields.find(field => field.name === 'icon')?.optional).toBe(true)
  const local = report.collections.find(collection => collection.name === 'tabs')!
  expect(local.itemType.name).toBe('LocalTab')
  expect(local.editable).toBe(false)
  expect(report.collections.find(collection => collection.name === 'div')?.items[0]?.label).toBe('First')
})

test('untyped shapes and primitive tabs are inferred, unrelated arrays are excluded', async () => {
  const { project } = await fixture({ 'src/data.ts': `export const unrelated = [{ label: 'Not UI' }]; export const tabs = ['One', 'Two'] as const; export const links = [{ href: '/', title: 'Home' }]` })
  const report = await project.scan()
  expect(report.collections.map(collection => collection.name)).toEqual(['links', 'tabs'])
  expect(report.collections.find(collection => collection.name === 'links')?.itemType.origin).toBe('inferred')
  expect(report.collections.find(collection => collection.name === 'tabs')?.items[0]?.itemType.fields).toEqual([])
})

test('empty typed navs use their required contract and validate configured field defaults', async () => {
  const { root } = await fixture({ 'src/router.ts': ROUTER, 'src/data.ts': contract + '\nexport const workspaceEntries: NavItem[] = []' })
  const options = { navigation: { file: 'src/data.ts', array: 'workspaceEntries', itemDefaults: { icon: 'page', priority: 2 } } }
  const project = new BuilderProject(root, options)
  const draft = { name: 'AboutPage', source: 'main\n  h1 About\n' }
  const preview = await project.preview(draft)
  expect(preview.files[2]!.source).toContain('"href": "/about"')
  expect(preview.files[2]!.source).toContain('"label": "About"')
  expect(preview.files[2]!.source).not.toContain('"disabled"')
  await expect(new BuilderProject(root, { navigation: { file: 'src/data.ts', array: 'workspaceEntries' } }).preview(draft)).rejects.toThrow('itemDefaults.icon')
  await expect(new BuilderProject(root, { navigation: { ...options.navigation, itemDefaults: { icon: 'invalid', priority: 2 } } }).preview(draft)).rejects.toThrow('must match')
  await expect(new BuilderProject(root, { navigation: { ...options.navigation, itemDefaults: { icon: 'page', priority: 'wrong' } } }).preview(draft)).rejects.toThrow('must be number')
})

test('navigation configuration limits insertion targets while preserving the complete UI inventory', async () => {
  const { root } = await fixture({ 'src/Header.btsx': HEADER, 'src/Other.btsx': 'nav.other\n  a(href="/other") Other\n', 'src/data.ts': 'export const tabs = [{ value: "one", label: "One" }]' })
  const report = await new BuilderProject(root, { navigation: { file: 'src/Header.btsx' } }).scan()
  expect(report.collections).toHaveLength(3)
  expect(report.navigationTargets).toHaveLength(1)
})

test('typed computed tab data is inspected without executing module code', async () => {
  const { project } = await fixture({
    'src/data.ts': `interface TabItem { value: string; label: string }; export const records: TabItem[] = (() => { throw new Error('Do not execute'); })()`,
    'src/Tabs.btsx': `import { records } from './data'\n\ndiv(role="tablist")\n  each tab in records\n    button(role="tab") #{tab.label}\n`,
  })
  const report = await project.scan()
  const data = report.collections.find(collection => collection.name === 'records')!
  expect(data.itemType.name).toBe('TabItem')
  expect(data.items).toHaveLength(0)
  expect(data.editable).toBe(false)
  expect(data.reason).toContain('runtime')
  expect(report.collections.find(collection => collection.name === 'div')?.itemType.name).toBe('TabItem')
})

test('named tab component aliases and link-based tabs are classified as tabs', async () => {
  const { project } = await fixture({
    'src/data.ts': `export const links = [{ href: '/one', label: 'One' }]`,
    'src/Tabs.btsx': `import { TabsList as List, TabsTrigger as Trigger } from './ui'\nimport { links } from './data'\n\nList\n  each item in links\n    Trigger(href={item.href}) #{item.label}\n`,
  })
  const report = await project.scan()
  expect(report.collections.every(collection => collection.kind === 'tabs')).toBe(true)
  expect(report.collections.every(collection => collection.items[0]?.kind === 'tab')).toBe(true)
  expect(report.navigationTargets).toHaveLength(0)
})

test('new links preserve a declared link variant instead of action fields', async () => {
  const { root, project } = await fixture({
    'src/router.ts': ROUTER,
    'src/data.ts': `type Item = { kind: 'link'; href: string; label: string } | { kind: 'action'; onClick: () => void; label: string }; export const menuItems: Item[] = [{ kind: 'action', onClick: () => {}, label: 'Refresh' }, { kind: 'link', href: '/', label: 'Home' }]`,
  })
  const report = await project.scan()
  const preview = await project.preview({ name: 'AboutPage', source: 'main\n  h1 About\n', navigationTarget: report.navigationTargets[0]!.id })
  expect(preview.files[2]!.source).toContain('"kind": "link", "href": "/about", "label": "About"')
})

test('tab contracts passed as BTSX props are resolved even when values exist only at runtime', async () => {
  const { project } = await fixture({ 'src/Tabs.btsx': `module\n  interface TabItem { id: string; label: string; disabled?: boolean }\nprops { tabs }: { tabs: TabItem[] }\ndiv(role="tablist")\n  each tab in tabs\n    button #{tab.label}\n` })
  const report = await project.scan()
  const tabs = report.collections[0]!
  expect(tabs.itemType.name).toBe('TabItem')
  expect(tabs.itemType.origin).toBe('declared')
  expect(tabs.bindings).toEqual(['tabs'])
  expect(tabs.items[0]?.kind).toBe('tab')
  expect(tabs.reason).toContain('runtime')
})

test('menu arrays in TSX modules remain editable alongside JSX declarations', async () => {
  const { project } = await fixture({
    'src/router.ts': ROUTER,
    'src/menu.tsx': `interface NavItem { to: string; title: string }; export const menuItems: NavItem[] = [{ to: '/', title: 'Home' }]; export const Icon = () => <svg />`,
  })
  const preview = await project.preview({ name: 'AboutPage', source: 'main\n  h1 About\n' })
  expect(preview.files[2]!.source).toContain('"to": "/about", "title": "About"')
  expect(preview.files[2]!.source).toContain('() => <svg />')
})
