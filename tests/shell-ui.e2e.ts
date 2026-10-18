import { expect, test, type Page } from '@playwright/test'
import type { ProjectScan } from '../shared/types.js'

const inventory: ProjectScan = {
  sections: [],
  name: 'Shell fixture', scannedAt: '', warnings: [], collections: [], files: [],
  navigationTargets: [], pageRoutes: [], tabComponents: [], tabInstances: []
}
const launcher = (page: Page) => page.getByRole('button', { name: 'Open Beast page builder', exact: true })
const close = (page: Page) => page.getByRole('button', { name: 'Close builder', exact: true }).click()
const ready = (page: Page) => expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
const positionKey = 'beast-page-builder:position:/__beast-page-builder'
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
  await page.goto('/')
}

for (const mobile of [false, true]) {
  test(`tab changes animate the panel height and retain scrollable results on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    await setup(page)
    await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: {
      ...inventory,
      files: Array.from({ length: 20 }, (_, index) => ({
        name: `Card${index}`, path: `src/components/Card${index}.btsx`, kind: 'component', lines: 2, components: [], error: null
      }))
    } }))
    if (mobile) await page.setViewportSize({ width: 390, height: 600 })
    await launcher(page).click()
    await ready(page)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const panel = page.locator('.panel')
    await panel.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)))
    const sampleTab = (name: string) => panel.evaluate(async (node, name) => {
      const start = node.getBoundingClientRect().height
      const tabs = node.querySelector<HTMLElement>('.tabs')!
      const tabsBox = tabs.getBoundingClientRect()
      let tabsAnimated = getComputedStyle(tabs).animationName !== 'none'
      let tabsMovement = 0
      node.querySelectorAll<HTMLButtonElement>('.tab').forEach(button => {
        if (button.textContent === name) button.click()
      })
      const heights: number[] = []
      const visibleHeights: number[] = []
      const results = node.querySelector<HTMLElement>('.results')!
      const paused = results.getAnimations({ subtree: true }).every(animation => animation.playState === 'paused')
      const initiallyHidden = getComputedStyle(results).visibility === 'hidden'
      const started = performance.now()
      while (performance.now() - started < 350) {
        await new Promise(requestAnimationFrame)
        const height = node.getBoundingClientRect().height
        const currentTabsBox = tabs.getBoundingClientRect()
        tabsMovement = Math.max(tabsMovement, Math.abs(currentTabsBox.y - tabsBox.y), Math.abs(currentTabsBox.height - tabsBox.height))
        tabsAnimated ||= getComputedStyle(tabs).animationName !== 'none'
        heights.push(height)
        if (getComputedStyle(results).visibility === 'visible') visibleHeights.push(height)
      }
      const entering = results.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')
      return { start, heights, visibleHeights, initiallyHidden, paused, entering, tabsAnimated, tabsMovement, end: node.getBoundingClientRect().height }
    }, name)
    const shrinking = await sampleTab('Pages')
    expect(shrinking.start - shrinking.end).toBeGreaterThan(10)
    expect(shrinking.heights.some(height => height > shrinking.end + 1 && height < shrinking.start - 1)).toBe(true)
    const growing = await sampleTab('Components')
    expect(growing.end - growing.start).toBeGreaterThan(10)
    expect(growing.heights.some(height => height > growing.start + 1 && height < growing.end - 1)).toBe(true)
    for (const sample of [shrinking, growing]) {
      expect(sample.tabsAnimated).toBe(false)
      expect(sample.tabsMovement).toBeLessThan(1)
      expect(sample.initiallyHidden).toBe(true)
      expect(sample.paused).toBe(true)
      expect(sample.entering).toBe(true)
      expect(sample.visibleHeights.length).toBeGreaterThan(0)
      expect(sample.visibleHeights.every(height => Math.abs(height - sample.end) < 1)).toBe(true)
    }
    expect(await page.locator('.results').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
    await page.locator('.result').last().scrollIntoViewIfNeeded()
    await expect(page.locator('.result').last()).toBeVisible()
    // Interrupt a shrink with a grow before either has finished.
    await panel.evaluate(async node => {
      const tabs = [...node.querySelectorAll<HTMLButtonElement>('.tab')]
      tabs.find(button => button.textContent === 'Pages')!.click()
      await new Promise(requestAnimationFrame)
      tabs.find(button => button.textContent === 'Components')!.click()
    })
    await expect.poll(() => panel.evaluate(node => Math.round(node.getBoundingClientRect().height))).toBe(Math.round(growing.end))
    await expect(page.locator('.results')).toBeVisible()
    const bounds = (await panel.boundingBox())!
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(mobile ? 600 : 1000)
    await close(page)
    await expect(panel).toBeHidden()
    await expect(panel).toHaveJSProperty('offsetHeight', 0)
  })
}

test('tab height changes remain immediate with reduced motion', async ({ page }) => {
  await setup(page)
  await launcher(page).click()
  await ready(page)
  const heights = await page.locator('.panel').evaluate(async node => {
    const start = node.getBoundingClientRect().height
    node.querySelectorAll<HTMLButtonElement>('.tab').forEach(button => {
      if (button.textContent === 'Pages') button.click()
    })
    const immediate = node.getBoundingClientRect().height
    await new Promise(requestAnimationFrame)
    return { start, immediate, next: node.getBoundingClientRect().height,
      visible: getComputedStyle(node.querySelector('.results')!).visibility }
  })
  expect(heights.immediate).not.toBe(heights.start)
  expect(heights.next).toBe(heights.immediate)
  expect(heights.visible).toBe('visible')
  await page.getByRole('button', { name: 'Create a page', exact: true }).click()
  await expect(page.getByLabel('Page name', { exact: true })).toBeFocused()
  await expect(page.locator('.panel')).not.toHaveAttribute('data-resizing')
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await expect(page.locator('.panel')).not.toHaveAttribute('data-resizing')
})

test('screen height changes animate both ways, preserve focus and continue through form rerenders', async ({ page }) => {
  await setup(page)
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: {
    ...inventory,
    files: [{ name: 'FixturePage', path: 'src/pages/FixturePage.btsx', kind: 'page', lines: 2, components: [], error: null }]
  } }))
  await page.route('**/__beast-page-builder/source?*', route => route.fulfill({ json: { source: 'main\n  h1 Hello\n' } }))
  await launcher(page).click()
  await ready(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const panel = page.locator('.panel')
  await panel.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)))
  const sample = (selector: string) => panel.evaluate(async (node, selector) => {
    const start = node.getBoundingClientRect().height
    node.querySelector<HTMLButtonElement>(selector)!.click()
    const immediate = node.getBoundingClientRect().height
    const resizing = node.hasAttribute('data-resizing')
    const paused = [...node.querySelectorAll('.builder-enter')].every(item => getComputedStyle(item).animationPlayState === 'paused')
    const input = node.querySelector<HTMLInputElement>('#page-name')
    const focused = !input || (node.getRootNode() as ShadowRoot).activeElement === input
    const animation = node.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'height' in frame))
    const heights: number[] = []
    let retained = true, changed = false
    const started = performance.now()
    while (performance.now() - started < 350) {
      await new Promise(requestAnimationFrame)
      heights.push(node.getBoundingClientRect().height)
      if (input && !changed && performance.now() - started > 60) {
        input.value = 'StillAnimatingPage'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        retained = node.getAnimations().includes(animation!)
        changed = true
      }
    }
    return { start, immediate, resizing, paused, focused, retained, heights, end: node.getBoundingClientRect().height }
  }, selector)
  const create = await sample('[data-action="action:create-page"]')
  expect(create.end - create.start).toBeGreaterThan(100)
  const back = await sample('[aria-label="Back to builder"]')
  expect(back.start - back.end).toBeGreaterThan(100)
  await page.locator('[data-action="file:src/pages/FixturePage.btsx"]').click()
  await expect(page.getByRole('heading', { name: 'FixturePage', exact: true })).toBeVisible()
  await expect(panel).not.toHaveAttribute('data-resizing')
  const edit = await sample('.edit-page')
  expect(edit.end - edit.start).toBeGreaterThan(100)
  const editBack = await sample('[aria-label="Back to builder"]')
  for (const result of [create, back, edit, editBack]) {
    expect(result.immediate).toBeCloseTo(result.start, 0)
    expect(result.resizing).toBe(true)
    expect(result.paused).toBe(true)
    expect(result.focused).toBe(true)
    expect(result.retained).toBe(true)
    expect(result.heights.some(height => height > Math.min(result.start, result.end) + 1 && height < Math.max(result.start, result.end) - 1)).toBe(true)
  }
  // A second screen change should start at the current frame of an unfinished transition.
  const interrupted = await panel.evaluate(async node => {
    node.querySelector<HTMLButtonElement>('[data-action="action:create-page"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 70))
    const from = node.getBoundingClientRect().height
    node.querySelector<HTMLButtonElement>('[aria-label="Back to builder"]')!.click()
    const immediate = node.getBoundingClientRect().height
    await new Promise(resolve => setTimeout(resolve, 300))
    return { from, immediate, resizing: node.hasAttribute('data-resizing'), height: node.getBoundingClientRect().height }
  })
  expect(interrupted.immediate).toBeCloseTo(interrupted.from, 0)
  expect(interrupted.resizing).toBe(false)
  expect(interrupted.height).toBeCloseTo(back.end, 0)
})

test('review disclosures animate native height changes without a screen render', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await page.route('**/__beast-page-builder/preview', route => route.fulfill({ json: {
    path: 'src/pages/PreviewPage.btsx', source: 'main\n', hash: 'a'.repeat(64), routePath: '/preview', navLabel: 'Preview',
    files: [{ path: 'src/pages/PreviewPage.btsx', action: 'create', before: null, source: 'main\n' + '  p More content\n'.repeat(20) }]
  } }))
  await launcher(page).click()
  await ready(page)
  await page.getByRole('button', { name: /Create a new page/ }).click()
  await page.getByRole('button', { name: 'Review page', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'One last look', exact: true })).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const panel = page.locator('.panel')
  await panel.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)))
  for (let index = 0; index < 2; index++) {
    const from = (await panel.boundingBox())!.height
    await page.locator('.planned-file > summary').click()
    await expect(panel).toHaveAttribute('data-resizing', '')
    const heights = await panel.evaluate(async node => {
      const heights: number[] = []
      while (node.hasAttribute('data-resizing')) {
        heights.push(node.getBoundingClientRect().height)
        await new Promise(requestAnimationFrame)
      }
      return heights
    })
    const to = (await panel.boundingBox())!.height
    expect(Math.abs(from - to)).toBeGreaterThan(100)
    expect(heights.some(height => height > Math.min(from, to) + 1 && height < Math.max(from, to) - 1)).toBe(true)
  }
  expect(errors).toEqual([])
})

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

test('builder coordinates persist after dragging, reopening and reload; keyboard moves persist and Home clears them', async ({ page }) => {
  await setup(page)
  await launcher(page).click()
  await ready(page)
  const panel = page.locator('.panel')
  const header = (await page.locator('.searchbar').boundingBox())!
  await page.mouse.move(header.x + header.width / 2, header.y + header.height - 4)
  await page.mouse.down()
  await page.mouse.move(header.x + header.width / 2 - 100, header.y + header.height - 4 + 30)
  await page.mouse.up()
  const moved = (await panel.boundingBox())!
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), positionKey)
  expect(saved.x).toBeCloseTo(moved.x, 1)
  expect(saved.y).toBeCloseTo(moved.y, 1)
  await close(page)
  await launcher(page).click()
  await ready(page)
  expect((await panel.boundingBox())!.x).toBeCloseTo(saved.x, 1)
  expect((await panel.boundingBox())!.y).toBeCloseTo(saved.y, 1)
  await page.reload()
  await launcher(page).click()
  await ready(page)
  expect((await panel.boundingBox())!.x).toBeCloseTo(saved.x, 1)
  expect((await panel.boundingBox())!.y).toBeCloseTo(saved.y, 1)
  await page.getByRole('button', { name: /Create a new page/ }).click()
  await page.getByRole('button', { name: 'Move builder', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowUp')
  const nudged = (await panel.boundingBox())!
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), positionKey)).toEqual({ x: nudged.x, y: nudged.y })
  await page.keyboard.press('Home')
  await expect(panel).not.toHaveAttribute('data-moved')
  expect(await page.evaluate(key => localStorage.getItem(key), positionKey)).toBeNull()
  await page.reload()
  await launcher(page).click()
  await ready(page)
  await expect(panel).not.toHaveAttribute('data-moved')
})

test('invalid saved coordinates are ignored and offscreen coordinates are clamped on restore', async ({ page }) => {
  await setup(page)
  for (const value of ['invalid JSON', '{"x":"10","y":20}', '{"x":1e999,"y":20}']) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: positionKey, value })
    await page.reload()
    await launcher(page).click()
    await ready(page)
    await expect(page.locator('.panel')).not.toHaveAttribute('data-moved')
  }
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ x: 9999, y: 9999 })), positionKey)
  await page.setViewportSize({ width: 390, height: 600 })
  await page.reload()
  await launcher(page).click()
  await ready(page)
  const box = (await page.locator('.panel').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(382)
  expect(box.y + box.height).toBeLessThanOrEqual(592)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), positionKey)).toEqual({ x: box.x, y: box.y })
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
  await page.getByRole('button', { name: /Create a new page/ }).click()
  const grip = page.getByRole('button', { name: 'Move builder', exact: true })
  await grip.focus()
  await page.keyboard.press('ArrowRight')
  const moved = (await page.locator('.panel').boundingBox())!
  await close(page)
  await launcher(page).click()
  await ready(page)
  expect((await page.locator('.panel').boundingBox())!.x).toBeCloseTo(moved.x, 1)
  expect((await page.locator('.panel').boundingBox())!.y).toBeCloseTo(moved.y, 1)
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
