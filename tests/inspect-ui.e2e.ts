import { expect, test, type Page } from '@playwright/test'
import type { DetectedCollection, ItemType, ProjectScan, TabInstance } from '../shared/types.js'

const pagePath = 'src/pages/FixturePage.btsx'
const brokenPath = 'src/components/BrokenCard.btsx'
const plainPath = 'src/components/PlainCard.btsx'
const source = 'main\n  p Literal <img data-inspect-injection> & "quotes"\n  p ' + 'Long source '.repeat(45) + '\n'
const plainSource = 'section\n  p Another component\n'
const error = 'Compiler error <diagnostic> & "quotes"'
const component = {
  id: 'src/components/Tabs.btsx', file: 'src/components/Tabs.btsx', name: 'Tabs', itemProp: 'items', activeProp: 'active', labelProp: 'label',
  itemType: { name: 'TabItem', origin: 'declared' as const, fields: [
    { name: 'id', type: 'string', optional: false, scalar: 'string' as const },
    { name: 'label', type: 'string', optional: false, scalar: 'string' as const },
    { name: 'href', type: 'string', optional: false, scalar: 'string' as const }
  ] }
}
const group = (id: string, label: string, line: number): TabInstance => ({
  id, page: pagePath, routePath: '/', component: component.id, line,
  draft: { page: pagePath, routePath: '/', component: component.id, instance: id, active: id, label,
    items: [{ id, label: `${label} item`, href: `#${id}` }] }
})
const linkType: ItemType = {
  name: 'LinkEntry', origin: 'declared', fields: [
    { name: 'href', type: 'string', optional: false },
    { name: 'icon', type: '"menu" | "add"', optional: true }
  ]
}
const union: ItemType = {
  name: 'NavigationEntry', origin: 'declared', fields: [
    { name: 'kind', type: '"link" | "action"', optional: false },
    { name: 'extraordinarilyLongOptionalFieldNameForHorizontalScrolling', type: 'string', optional: true }
  ],
  variants: [linkType, { name: 'ActionEntry', origin: 'declared', fields: [], variants: [
    { name: 'MenuAction', origin: 'declared', fields: [{ name: 'action', type: '() => void', optional: false }] }
  ] }]
}
const navigation: DetectedCollection = {
  id: 'navigation', name: 'workspaceLinks', file: 'src/data/navigation.ts', line: 9, kind: 'navigation', source: 'data', editable: true,
  itemType: union, bindings: ['workspaceLinks', 'safe<binding>&'], consumers: [
    { file: 'src/Header.btsx', line: 4, name: 'NavBar' }, { file: 'src/Sidebar.btsx', line: 7, name: 'SideNav' }
  ], dataSources: [], items: [
    { label: 'Docs <img data-inspect-injection>', kind: 'internal-link', line: 10, component: 'Link<Safe>&', destination: '/docs?x=<tag>&y="q"', value: 'one&<two>', itemType: linkType },
    { label: 'External', kind: 'external-link', line: 11, destination: 'https://example.com', itemType: linkType },
    { label: 'Jump', kind: 'anchor', line: 12, destination: '#content', itemType: linkType },
    { label: 'Run action', kind: 'action', line: 13, itemType: { name: 'ActionEntry', origin: 'declared', fields: [] } },
    { label: 'Unknown', kind: 'unknown', line: 14, itemType: { name: '{}', origin: 'inferred', fields: [] } }
  ]
}
const computed: DetectedCollection = {
  ...navigation, id: 'computed', name: 'computedLinks', editable: false, items: [], bindings: ['runtimeLinks'], consumers: [],
  reason: 'Computed <read-only> & data. Edit this collection in source.'
}
const emptyTabs: DetectedCollection = {
  ...navigation, id: 'empty-tabs', name: 'emptyTabs', kind: 'tabs', source: 'markup', editable: false, items: [],
  itemType: { name: 'InferredTab', origin: 'inferred', fields: [] }, bindings: [], consumers: []
}
const inventory: ProjectScan = {
  name: 'Inspector fixture', scannedAt: '', warnings: [], navigationTargets: [],
  files: [
    { name: 'FixturePage', path: pagePath, kind: 'page', lines: 6, components: ['FixturePage', 'LocalCard'], error: null },
    { name: 'BrokenCard', path: brokenPath, kind: 'component', lines: 4, components: ['BrokenCard'], error },
    { name: 'PlainCard', path: plainPath, kind: 'component', lines: 2, components: [], error: null }
  ],
  collections: [navigation, computed, emptyTabs], pageRoutes: [{ file: pagePath, name: 'FixturePage', routePath: '/' }], tabComponents: [component],
  tabInstances: [group('first', 'First group', 2), group('second', 'Second group', 14),
    { id: 'computed-tabs', page: pagePath, routePath: '/', component: component.id, line: 30, reason: 'Computed items <read-only> & source only.' },
    { id: 'unknown-tabs', page: pagePath, routePath: '/', component: component.id, line: 35 },
    { ...group('other', 'Other page group', 1), page: 'src/pages/OtherPage.btsx' }]
}
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
  await page.route('**/__beast-page-builder/source?*', route => {
    const path = new URL(route.request().url()).searchParams.get('path')
    return route.fulfill({ json: { source: path === plainPath ? plainSource : source } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
}
async function openFile(page: Page, name = 'BrokenCard', filter = 'Components') {
  await page.getByRole('button', { name: filter, exact: true }).click()
  await page.getByRole('button', { name: new RegExp(`${name} src/`) }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}
async function back(page: Page) {
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /Search pages/ })).toBeFocused()
}
async function mockCopy(page: Page, copy: (value: string) => Promise<void>) {
  await page.exposeFunction('builderTestCopy', copy)
  await page.addInitScript(() => {
    const state = window as unknown as { builderTestCopy: (value: string) => Promise<void>; copyFinished: boolean }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => {
      await state.builderTestCopy(value)
      state.copyFinished = true
    } } })
  })
}

test('file inspector preserves literal source and diagnostics, copies exact text, and retains its DOM through theme changes', async ({ page }) => {
  const copies: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mockCopy(page, async value => { copies.push(value) })
  await setup(page)
  await openFile(page)
  const viewer = page.getByLabel(`Source ${brokenPath}`, { exact: true })
  expect(await viewer.textContent()).toBe(source)
  await expect(page.locator('.error-note')).toHaveText(error)
  await expect(page.locator('[data-inspect-injection]')).toHaveCount(0)
  await expect(page.locator('.action-footer > span')).toHaveText('4 lines · 1 component')
  await expect(page.getByRole('button', { name: 'Edit page', exact: true })).toHaveCount(0)
  await viewer.evaluate(node => node.setAttribute('data-retained-source', 'yes'))
  await page.getByRole('button', { name: 'Copy source', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Source copied.')
  expect(copies).toEqual([source])
  const theme = page.getByRole('button', { name: 'Dark mode', exact: true })
  await theme.click()
  await expect(theme).toHaveAttribute('aria-pressed', 'true')
  await expect(viewer).toHaveAttribute('data-retained-source', 'yes')
  await viewer.focus()
  await expect(viewer).toBeFocused()
  expect(await viewer.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/inspector-source-desktop.png' })
  await page.getByRole('button', { name: 'Close builder', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open Beast page builder', exact: true })).toBeFocused()
  expect(errors).toEqual([])
})

test('clipboard rejection keeps source available and copying can be retried', async ({ page }) => {
  const copies: string[] = []
  await mockCopy(page, async value => { copies.push(value); if (copies.length === 1) throw new Error('Permission denied') })
  await setup(page)
  await openFile(page, 'PlainCard')
  const copy = page.getByRole('button', { name: 'Copy source', exact: true })
  await copy.click()
  await expect(page.getByRole('status')).toHaveText('Could not access the clipboard. Select the source to copy it.')
  expect(await page.getByLabel(`Source ${plainPath}`, { exact: true }).textContent()).toBe(plainSource)
  await expect(copy).toBeEnabled()
  await copy.click()
  await expect(page.getByRole('status')).toHaveText('Source copied.')
  expect(copies).toEqual([plainSource, plainSource])
})

test('late clipboard feedback cannot change a subsequently opened file', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const copies: string[] = []
  await mockCopy(page, async value => { copies.push(value); await pending })
  try {
    await setup(page)
    await openFile(page)
    await page.getByRole('button', { name: 'Copy source', exact: true }).click()
    await expect.poll(() => copies.length).toBe(1)
    await back(page)
    await openFile(page, 'PlainCard')
    await expect(page.getByRole('status')).toBeEmpty()
    release()
    await page.waitForFunction(() => (window as unknown as { copyFinished: boolean }).copyFinished)
    await expect(page.getByRole('status')).toBeEmpty()
    await expect(page.locator('.action-footer > span')).toHaveText('2 lines · 0 components')
    expect(await page.getByLabel(`Source ${plainPath}`, { exact: true }).textContent()).toBe(plainSource)
  } finally { release() }
})

test('page inspection opens the correct page editor and selected tab group while leaving computed groups source-only', async ({ page }) => {
  await setup(page)
  await openFile(page, 'FixturePage', 'Pages')
  await expect(page.locator('.action-footer > span')).toHaveText('6 lines · 2 components')
  await expect(page.locator('[data-edit-tabs]')).toHaveCount(2)
  await expect(page.locator('.existing-tabs')).toContainText('Line 30: Computed items <read-only> & source only.')
  await expect(page.locator('.existing-tabs')).toContainText('Line 35: Edit these tabs in the page source.')
  await expect(page.getByRole('button', { name: /Other page group/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit page', exact: true }).click()
  await expect(page.getByLabel('BTSX page source', { exact: true })).toHaveValue(source)
  await expect(page.getByLabel('BTSX page source', { exact: true })).toBeFocused()
  await back(page)
  await openFile(page, 'FixturePage', 'Pages')
  await page.getByRole('button', { name: 'Edit tabs · Second group · Line 14', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Edit Tabs', exact: true })).toBeVisible()
  await expect(page.getByLabel('Tabs label', { exact: true })).toHaveValue('Second group')
  await expect(page.getByLabel('label · Tab 1', { exact: true })).toHaveValue('Second group item')
  await expect(page.getByLabel('id · Tab 1', { exact: true })).toHaveValue('second')
})

test('source-only tab actions open the containing file inspector', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await page.getByRole('button', { name: /Edit Tabs · FixturePage Edit source · src\/pages\/FixturePage.btsx:30/ }).click()
  await expect(page.getByRole('heading', { name: 'FixturePage', exact: true })).toBeVisible()
  await expect(page.locator('.existing-tabs')).toContainText('Computed items <read-only> & source only.')
  await expect(page.locator('[data-edit-tabs="computed-tabs"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review Tabs', exact: true })).toHaveCount(0)
})

test('navigation inspection renders union types, consumers, item metadata and retained disclosure state on desktop and mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await page.getByRole('button', { name: 'Navs', exact: true }).click()
  await page.getByRole('button', { name: /workspaceLinks 5 items/ }).click()
  await expect(page.getByRole('heading', { name: 'workspaceLinks', exact: true })).toBeVisible()
  await expect(page.locator('.header-text > p')).toHaveText('src/data/navigation.ts:9')
  await expect(page.locator('.collection-meta')).toHaveText('NavigationShared data · 5 items')
  const contract = page.locator('.collection-body > .type-contract')
  await expect(contract.locator(':scope > .type-title > code')).toHaveText('NavigationEntry')
  await expect(contract.getByRole('cell', { name: 'Optional', exact: true })).toBeVisible()
  await contract.locator(':scope > .type-variants > summary').click()
  await expect(contract.getByText('LinkEntry', { exact: true })).toBeVisible()
  await contract.getByText('1 item variants', { exact: true }).click()
  await expect(contract.getByText('MenuAction', { exact: true })).toBeVisible()
  await expect(page.getByText('Data binding: workspaceLinks, safe<binding>&', { exact: true })).toBeVisible()
  await expect(page.locator('.consumer-list li')).toHaveText(['src/Header.btsx:4 · NavBar', 'src/Sidebar.btsx:7 · SideNav'])
  await expect(page.locator('.detected-item > summary .type-badge')).toHaveText(['internal link', 'external link', 'anchor', 'action', 'unknown'])
  const item = page.locator('.detected-item').first()
  await item.locator(':scope > summary').click()
  await expect(item.locator('.item-body > p')).toHaveText('Component: Link<Safe>& · Line 10 · Destination: /docs?x=<tag>&y="q" · Value: one&<two>')
  await expect(item.locator('.type-title > code')).toHaveText('LinkEntry')
  await expect(page.locator('[data-inspect-injection]')).toHaveCount(0)
  await item.evaluate(node => node.setAttribute('data-retained-item', 'yes'))
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click()
  await expect(item).toHaveAttribute('open')
  await expect(item).toHaveAttribute('data-retained-item', 'yes')
  await expect(contract.locator(':scope > .type-variants')).toHaveAttribute('open')
  await expect(page.locator('.action-footer > span')).toHaveText('Available for new page links')
  await page.screenshot({ path: 'test-results/inspector-collection-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const fields = contract.locator(':scope > .fields-scroll')
  expect(await fields.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
  await fields.scrollIntoViewIfNeeded()
  await fields.evaluate(node => { node.scrollLeft = node.scrollWidth })
  await page.screenshot({ path: 'test-results/inspector-collection-mobile.png' })
  const box = (await page.getByRole('dialog').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(box.y + box.height).toBeLessThanOrEqual(844)
  expect(errors).toEqual([])
})

test('computed collections retain their read-only explanation and empty tabs expose inferred types without table fields', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Navs', exact: true }).click()
  await page.getByRole('button', { name: /computedLinks 0 items/ }).click()
  await expect(page.getByText(computed.reason!, { exact: true })).toBeVisible()
  await expect(page.getByText('No literal items found. The group may populate its items at runtime.', { exact: true })).toBeVisible()
  await expect(page.locator('.collection-body > .type-contract .type-title > code').first()).toHaveText('NavigationEntry')
  await expect(page.locator('.consumer-list')).toHaveCount(0)
  await expect(page.locator('.action-footer > span')).toHaveText('Inspect item types and source bindings')
  await back(page)
  await page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await page.getByRole('button', { name: /emptyTabs 0 items/ }).click()
  await expect(page.locator('.collection-meta')).toHaveText('TabsRendered markup · 0 items')
  await expect(page.locator('.type-title > code')).toHaveText('InferredTab')
  await expect(page.getByText('Inferred shape', { exact: true })).toBeVisible()
  await expect(page.locator('table.type-fields')).toHaveCount(0)
  await expect(page.locator('.detected-item')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit page', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy source', exact: true })).toHaveCount(0)
})
