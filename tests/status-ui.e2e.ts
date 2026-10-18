import { expect, test, type Page } from '@playwright/test'
import type { ClientConfig, PagePreview, ProjectScan, TabsDraft } from '../shared/types.js'

const pagePath = 'src/pages/RecoveryPage.btsx'
const hash = 'c'.repeat(64)
const source = 'main\n  p Saved <source> & "quotes"\n'
const component = {
  id: 'src/components/Tabs.btsx', file: 'src/components/Tabs.btsx', name: 'Tabs', itemProp: 'items', activeProp: 'active', labelProp: 'label',
  itemType: { name: 'TabItem', origin: 'declared' as const, fields: ['id', 'label', 'href'].map(name => ({ name, type: 'string', optional: false, scalar: 'string' as const })) }
}
const tabsDraft: TabsDraft = {
  page: pagePath, routePath: '/', component: component.id, active: 'one', label: 'Recovered tabs',
  items: [{ id: 'one', label: 'First', href: '#one' }, { id: 'two', label: 'Second', href: '#two' }]
}
const inventory: ProjectScan = {
  name: 'Status fixture', scannedAt: '', warnings: [], collections: [],
  files: [{ name: 'RecoveryPage', path: pagePath, kind: 'page', lines: 3, components: [], error: null }],
  navigationTargets: [{ id: 'menu', file: 'src/Header.btsx', label: 'Main menu' }],
  pageRoutes: [{ file: pagePath, name: 'RecoveryPage', routePath: '/' }], tabComponents: [component], tabInstances: []
}
const config: ClientConfig = { shortcut: 'Mod+B', position: 'center', theme: 'light', scanDuration: 0, launcher: true, pagesDir: 'src/pages', routerFile: 'src/router.ts' }
const launcher = (page: Page) => page.getByRole('button', { name: 'Open Beast page builder', exact: true })
const close = (page: Page) => page.getByRole('button', { name: 'Close builder', exact: true }).click()
const ready = (page: Page) => expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
const pageKey = 'beast-page-builder:save:/__beast-page-builder'
const tabsKey = 'beast-page-builder:tabs:/__beast-page-builder'
function result(editing = false): PagePreview {
  return { path: pagePath, source, hash, routePath: '/', navLabel: 'Recovered', files: [
    { path: pagePath, action: editing ? 'edit' : 'create', before: editing ? 'main\n' : null, source },
    ...(!editing ? [{ path: 'src/router.ts', action: 'edit' as const, before: '', source: '// saved route\n' }] : [])
  ] }
}
async function setup(page: Page, scanDuration = 0) {
  await page.route('**/__beast-page-builder/config', route => route.fulfill({ json: { ...config, scanDuration } }))
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
}
async function seed(page: Page, tabs: boolean, editing = false) {
  const key = tabs ? tabsKey : pageKey
  const value = tabs ? JSON.stringify({ draft: { ...tabsDraft, ...(editing ? { instance: 'existing-tabs' } : {}) }, hash }) : hash
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('status-seeded')) return
    sessionStorage.setItem('status-seeded', 'yes')
    sessionStorage.setItem(key, value)
  }, { key, value })
  return { key, value }
}

// These fixtures intercept every write and receipt lookup; project source is untouched.
test('scan keeps its duration, progress, sonar, and single loader through rerenders and cleans it on exit', async ({ page }) => {
  await setup(page, 1600)
  await page.clock.install()
  await page.goto('/')
  await launcher(page).click()
  await expect(page.locator('.sonar > svg polygon')).toHaveCount(135)
  const loader = await page.locator('.sonar-core > svg').elementHandle()
  expect(loader).not.toBeNull()
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click()
  await page.clock.runFor(700)
  await expect(page.getByRole('status')).toHaveText('Resolving menus, tabs, and item types…')
  expect(await loader!.evaluate(node => node === node.parentElement?.querySelector('svg'))).toBe(true)
  await expect(page.locator('.sonar-core > svg')).toHaveCount(1)
  await expect(page.locator('style[data-loader="hex-trace"]')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/status-scan-desktop.png' })
  await expect(page.getByText('Builder ready', { exact: true })).toBeHidden()
  await page.clock.runFor(1000)
  await ready(page)
  expect(await loader!.evaluate(node => node.parentNode === null)).toBe(true)
  await page.getByRole('button', { name: /Rescan project/ }).click()
  const canceled = await page.locator('.sonar-core > svg').elementHandle()
  await close(page)
  expect(await canceled!.evaluate(node => node.parentNode === null)).toBe(true)
  await page.clock.runFor(3000)
  await expect(page.getByRole('dialog')).toBeHidden()
  await launcher(page).click()
  await expect(page.locator('.sonar-core > svg')).toHaveCount(1)
  await expect(page.locator('style[data-loader="hex-trace"]')).toHaveCount(1)
  await close(page)
})

test('reduced motion skips a long scan duration and renders the mobile sonar without animation', async ({ page }) => {
  await setup(page, 60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/__beast-page-builder/scan', async route => { await pending; await route.fulfill({ json: inventory }) })
  try {
    await page.goto('/')
    await launcher(page).click()
    const spinning = page.locator('.sonar-core .ld-hex-trace-spin')
    await expect(spinning).toBeVisible()
    expect(await spinning.evaluate(node => getComputedStyle(node).animationName)).toBe('none')
    await expect(page.locator('.sonar > svg polygon')).toHaveCount(135)
    await page.screenshot({ path: 'test-results/status-scan-mobile.png' })
    release()
    await ready(page)
    await expect(page.locator('.sonar-core')).toHaveCount(0)
  } finally { release() }
})

test('scan failures render literal alerts, retry, and return safely with and without an inventory', async ({ page }) => {
  await setup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let scans = 0
  const error = 'Scan failed <img data-status-injection> & "retry"'
  await page.route('**/__beast-page-builder/scan', route => {
    scans++
    return route.fulfill(scans === 3 ? { json: inventory } : { status: 503, json: { error } })
  })
  await page.goto('/')
  await launcher(page).click()
  await expect(page.getByRole('alert')).toHaveText(error)
  await expect(page.locator('[data-status-injection]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Scan project', exact: true }).click()
  await expect.poll(() => scans).toBe(2)
  await expect(page.getByRole('alert')).toHaveText(error)
  await page.locator('.topbar .back').click()
  await ready(page)
  await page.getByRole('button', { name: /Rescan project/ }).click()
  await expect(page.getByRole('alert')).toHaveText(error)
  await page.screenshot({ path: 'test-results/status-error.png' })
  await page.locator('.topbar .back').click()
  await ready(page)
  expect(scans).toBe(4)
  await close(page)
  await expect(launcher(page)).toBeFocused()
})

for (const mode of ['create-page', 'edit-page', 'add-tabs', 'edit-tabs'] as const) {
  test(`${mode} receipt survives reload and success actions acknowledge the saved result`, async ({ page }) => {
    const tabs = mode.includes('tabs'), editing = mode.startsWith('edit')
    const saved = result(editing)
    const receipt = await seed(page, tabs, editing)
    await setup(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let lookups = 0
    await page.route(`**/__beast-page-builder/${tabs ? 'tabs/' : ''}creation?*`, route => { lookups++; return route.fulfill({ json: saved }) })
    if (mode === 'edit-tabs') await page.setViewportSize({ width: 390, height: 844 })
    const success = () => expect(page.getByRole('heading', { name: tabs ? 'Your tabs are ready.' : `RecoveryPage is ${editing ? 'updated' : 'created'}.`, exact: true })).toBeVisible()
    const stored = () => page.evaluate(key => sessionStorage.getItem(key), receipt.key)
    const restore = async () => {
      await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), receipt)
      await page.reload()
      await success()
    }
    await page.goto('/')
    await success()
    expect(await stored()).toBe(receipt.value)
    await page.reload()
    await success()
    expect(lookups).toBe(2)
    await page.getByRole('button', { name: 'Dark mode', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    if (mode === 'create-page' || mode === 'edit-tabs') await page.screenshot({ path: `test-results/status-success-${mode}.png` })
    if (mode === 'create-page') {
      await page.locator('.topbar .back').click()
      await ready(page)
      expect(await stored()).toBeNull()
      await restore()
      await page.getByRole('button', { name: 'Edit page', exact: true }).click()
      await expect(page.getByLabel('BTSX page source', { exact: true })).toHaveValue(source)
      expect(await stored()).toBeNull()
      await page.locator('.topbar .back').click()
      await ready(page)
      await restore()
      await page.locator('.done').click()
      await ready(page)
      expect(await stored()).toBeNull()
      await page.getByRole('button', { name: /Create a new page/ }).click()
      await expect(page.getByLabel('Page name', { exact: true })).toHaveValue('UntitledPage')
    } else if (mode === 'edit-page') {
      await expect(page.getByRole('link', { name: 'Open page', exact: true })).toHaveAttribute('href', '/')
      await page.getByRole('link', { name: 'Open page', exact: true }).click()
      expect(await stored()).toBeNull()
      await expect(page.getByRole('dialog')).toBeHidden()
    } else if (mode === 'add-tabs') {
      await expect(page.locator('.success-body p')).toHaveText('2 tabs added to /.')
      await page.locator('.done').click()
      await ready(page)
      expect(await stored()).toBeNull()
      await page.getByRole('button', { name: /Add Tabs to a page/ }).click()
      await expect(page.getByRole('heading', { name: 'Add Tabs', exact: true })).toBeVisible()
      await page.evaluate(() => history.pushState({}, '', '/unknown-route'))
      await expect(page.getByRole('button', { name: 'Review Tabs', exact: true })).toBeDisabled()
    } else {
      await expect(page.locator('.success-body p')).toHaveText('2 tabs updated on /.')
      await page.locator('.topbar .back').click()
      await ready(page)
      expect(await stored()).toBeNull()
      await restore()
      await close(page)
      expect(await stored()).toBeNull()
      await expect(page.getByRole('dialog')).toBeHidden()
      await launcher(page).click()
      await ready(page)
    }
  })
}

for (const tabs of [false, true]) {
  test(`pending ${tabs ? 'tabs' : 'page'} recovery cannot reopen after a newer open and close`, async ({ page }) => {
    await seed(page, tabs)
    await setup(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(resolve => { release = resolve })
    const endpoint = `**/__beast-page-builder/${tabs ? 'tabs/' : ''}creation?*`
    await page.route(endpoint, async route => { requested = true; await pending; await route.fulfill({ json: result() }) })
    try {
      await page.goto('/')
      await expect.poll(() => requested).toBe(true)
      await launcher(page).click()
      await ready(page)
      await close(page)
      const response = page.waitForResponse(endpoint)
      release()
      await response
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(launcher(page)).toBeFocused()
      await launcher(page).click()
      await ready(page)
    } finally { release() }
  })
}

test('an expired receipt is cleared without opening the builder', async ({ page }) => {
  await seed(page, false)
  await setup(page)
  await page.route('**/__beast-page-builder/creation?*', route => route.fulfill({ status: 404, json: { error: 'Receipt expired' } }))
  await page.goto('/')
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), pageKey)).toBeNull()
  await expect(page.getByRole('dialog')).toBeHidden()
  await launcher(page).click()
  await ready(page)
})

test('a completed old save cannot replace or steal focus from a newly reopened draft', async ({ page }) => {
  await setup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/preview', route => route.fulfill({ json: result() }))
  let release!: () => void, saving = false
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/__beast-page-builder/create', async route => { saving = true; await pending; await route.fulfill({ json: result() }) })
  try {
    await page.goto('/')
    await launcher(page).click()
    await ready(page)
    await page.getByRole('button', { name: /Create a new page/ }).click()
    await page.getByLabel('Page name', { exact: true }).fill('RecoveryPage')
    await page.getByRole('button', { name: 'Review page', exact: true }).click()
    await page.getByRole('button', { name: 'Create page', exact: true }).click()
    await expect.poll(() => saving).toBe(true)
    await close(page)
    await launcher(page).click()
    await ready(page)
    await page.getByRole('button', { name: /Create a new page/ }).click()
    const name = page.getByLabel('Page name', { exact: true })
    await name.fill('NewerDraft')
    const response = page.waitForResponse('**/__beast-page-builder/create')
    release()
    await response
    await expect(page.getByRole('button', { name: 'Review page', exact: true })).toBeEnabled()
    await expect(name).toHaveValue('NewerDraft')
    await expect(name).toBeFocused()
    await expect(page.locator('.success-body')).toHaveCount(0)
  } finally { release() }
})

test('an aborted scan cannot replace the next inventory and removing the host disposes its loader', async ({ page }) => {
  await setup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let release!: () => void, started = false, completed = false, scans = 0
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/__beast-page-builder/scan', async route => {
    scans++
    if (scans === 1) {
      started = true
      await pending
      // The first fetch is intentionally aborted by closing the builder.
      await route.fulfill({ json: { ...inventory, name: 'Obsolete inventory' } }).catch(() => {})
      completed = true
    } else await route.fulfill({ json: { ...inventory, name: 'Latest inventory' } })
  })
  try {
    await page.goto('/')
    await launcher(page).click()
    await expect.poll(() => started).toBe(true)
    await close(page)
    await launcher(page).click()
    await ready(page)
    release()
    await expect.poll(() => completed).toBe(true)
    await expect(page.locator('.project-chip')).toHaveText('Latest inventory')
    await expect(page.getByRole('dialog')).toBeVisible()
    // Hold a new scan open while the app removes the widget mount, as during HMR.
    await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
    await page.route('**/__beast-page-builder/config', route => route.fulfill({ json: { ...config, scanDuration: 60_000 } }))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByRole('button', { name: /Rescan project/ }).click()
    const loader = await page.locator('.sonar-core > svg').elementHandle()
    expect(loader).not.toBeNull()
    await page.locator('#beast-page-builder').evaluate(node => node.remove())
    expect(await loader!.evaluate(node => node.parentNode === null)).toBe(true)
    await expect(page.locator('#beast-page-builder')).toHaveCount(0)
  } finally { release() }
})
