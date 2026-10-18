import { expect, test, type Page } from '@playwright/test'
import type { ProjectScan } from '../shared/types.js'

const inventory: ProjectScan = {
  name: 'Shell fixture', scannedAt: '', warnings: [], collections: [], files: [],
  navigationTargets: [], pageRoutes: [], tabComponents: [], tabInstances: []
}
const launcher = (page: Page) => page.getByRole('button', { name: 'Open Beast page builder', exact: true })
const close = (page: Page) => page.getByRole('button', { name: 'Close builder', exact: true }).click()
const ready = (page: Page) => expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
  await page.goto('/')
}

test('one stable shell survives repeated open/close cycles while screen effects and drafts have separate lifetimes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  const button = await launcher(page).elementHandle()
  const panel = await page.locator('.panel').elementHandle()
  await launcher(page).click()
  await ready(page)
  await page.getByRole('button', { name: /Create a new page/ }).click()
  await page.getByLabel('Page name', { exact: true }).fill('RetainedDraft')
  await page.getByLabel('BTSX page source', { exact: true }).fill('main\n  p Keep my source\n')
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click()
  for (let cycle = 0; cycle < 5; cycle++) {
    await close(page)
    await expect(launcher(page)).toBeFocused()
    await expect(page.locator('.panel > *')).toHaveCount(0)
    await launcher(page).click()
    await ready(page)
    await page.getByRole('button', { name: /Create a new page/ }).click()
    await expect(page.getByLabel('Page name', { exact: true })).toHaveValue('RetainedDraft')
    await expect(page.getByLabel('BTSX page source', { exact: true })).toHaveValue('main\n  p Keep my source\n')
    await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.page-form')).toHaveCount(1)
  }
  expect(await button!.evaluate(node => node === (node.getRootNode() as ShadowRoot).querySelector('.launcher'))).toBe(true)
  expect(await panel!.evaluate(node => node === (node.getRootNode() as ShadowRoot).querySelector('.panel'))).toBe(true)
  await expect(page.locator('#beast-page-builder')).toHaveCount(1)
  await expect(page.locator('.widget')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/shell-draft-desktop.png' })
  expect(errors).toEqual([])
})

test('closing during a drag releases capture and a moved panel clamps after a viewport resize', async ({ page }) => {
  await setup(page)
  await launcher(page).click()
  await ready(page)
  await page.getByRole('button', { name: /Create a new page/ }).click()
  const grip = page.getByRole('button', { name: 'Move builder', exact: true })
  const box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 160, box.y + 120)
  await expect(page.locator('.panel')).toHaveAttribute('data-dragging', '')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.panel')).not.toHaveAttribute('data-dragging')
  await launcher(page).click()
  await ready(page)
  await page.getByRole('button', { name: /Create a new page/ }).click()
  await page.setViewportSize({ width: 390, height: 600 })
  await expect.poll(async () => {
    const bounds = (await page.getByRole('dialog').boundingBox())!
    return bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= 382 && bounds.y + bounds.height <= 592
  }).toBe(true)
  await page.screenshot({ path: 'test-results/shell-resize-mobile.png' })
  await page.getByRole('button', { name: 'Move builder', exact: true }).focus()
  await page.keyboard.press('Home')
  await expect(page.locator('.panel')).not.toHaveAttribute('data-moved')
  await close(page)
})

test('removal disposes global shortcuts and a fresh mount remains usable without duplicate controls', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await launcher(page).click()
  await ready(page)
  // A second module URL executes bootstrap again, as dev-server reinjection can.
  await page.addScriptTag({ type: 'module', url: '/__beast-page-builder/client.js?shell-duplicate=1' })
  await expect(page.locator('#beast-page-builder')).toHaveCount(1)
  await expect(launcher(page)).toHaveCount(1)
  await page.locator('#beast-page-builder').evaluate(node => node.remove())
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
  const dispatchShortcut = () => page.evaluate(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform)
    const event = new KeyboardEvent('keydown', { key: 'b', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(await dispatchShortcut()).toBe(false)
  await page.addScriptTag({ type: 'module', url: '/__beast-page-builder/client.js?shell-remount=1' })
  await expect(launcher(page)).toBeVisible()
  expect(await dispatchShortcut()).toBe(true)
  await ready(page)
  await expect(page.locator('.result')).not.toHaveCount(0)
  await close(page)
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(errors).toEqual([])
})

test('preferences stay usable in memory when browser storage is unavailable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method]
      Storage.prototype[method] = function (key: string, ...args: string[]) {
        if (key.startsWith('beast-page-builder:')) throw new DOMException('Storage blocked', 'SecurityError')
        return Reflect.apply(original, this, [key, ...args])
      }
    }
  })
  await page.route('**/__beast-page-builder/config', route => route.fulfill({ json: {
    shortcut: 'Ctrl+Shift+K', position: 'center', theme: 'light', launcher: true,
    scanDuration: 0, pagesDir: 'src/pages', routerFile: 'src/router.ts'
  } }))
  await setup(page)
  await expect(page.locator('.launcher kbd')).toHaveText('Ctrl Shift K')
  await page.keyboard.press('Control+K')
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.keyboard.press('Control+Shift+K')
  await ready(page)
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click()
  await page.getByRole('button', { name: /Hide launcher/ }).click()
  await expect(launcher(page)).toBeHidden()
  await close(page)
  await page.keyboard.press('Control+Shift+K')
  await ready(page)
  await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(launcher(page)).toBeHidden()
  await page.getByRole('button', { name: /Show launcher/ }).click()
  await expect(launcher(page)).toBeVisible()
  expect(errors).toEqual([])
})

test('a pending file load cannot replace a different screen in the same open session', async ({ page }) => {
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: {
    ...inventory, files: [{ path: 'src/pages/DelayedPage.btsx', name: 'DelayedPage', kind: 'page', lines: 2, components: [], error: null }]
  } }))
  let release!: () => void, loading = false
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/__beast-page-builder/source?*', async route => {
    loading = true
    await pending
    await route.fulfill({ json: { source: 'main\n  p Older file\n' } })
  })
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await launcher(page).click()
    await ready(page)
    await page.getByRole('button', { name: /DelayedPage src\/pages/ }).click()
    await expect.poll(() => loading).toBe(true)
    await page.getByRole('button', { name: /Create a new page/ }).click()
    const name = page.getByLabel('Page name', { exact: true })
    await name.fill('NewerScreen')
    const response = page.waitForResponse('**/__beast-page-builder/source?*')
    release()
    await response
    await expect(page.getByRole('button', { name: 'Review page', exact: true })).toBeEnabled()
    await expect(name).toHaveValue('NewerScreen')
    await expect(name).toBeFocused()
    await expect(page.locator('.source-viewer')).toHaveCount(0)
  } finally { release() }
})
