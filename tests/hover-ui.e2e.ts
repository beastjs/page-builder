import { expect, test, type Page } from '@playwright/test'
import type { DetectedCollection, ProjectScan } from '../shared/types.js'
import { paletteTabs } from '../client/palette/types.js'

const collection = (kind: 'navigation' | 'tabs'): DetectedCollection => ({
  id: kind, name: `${kind}Items`, file: 'src/data.ts', line: 1, kind, source: 'data', editable: false,
  itemType: { name: 'Item', origin: 'inferred', fields: [] }, items: [], bindings: [], consumers: [], dataSources: []
})
const inventory: ProjectScan = {
  name: 'Hover fixture', scannedAt: '', warnings: [], navigationTargets: [], sections: [], pageRoutes: [], tabComponents: [], tabInstances: [],
  collections: [collection('navigation'), collection('tabs')],
  files: [
    { path: 'src/pages/Home.btsx', name: 'Home', kind: 'page', lines: 2, components: [], error: null },
    ...Array.from({ length: 24 }, (_, index) => ({
      path: `src/components/Card${index}.btsx`, name: `Card${index}`, kind: 'component' as const, lines: 2, components: [], error: null
    }))
  ]
}
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/config', route => route.fulfill({ json: {
    shortcut: 'Mod+B', position: 'center', theme: 'light', scanDuration: 0, launcher: true, pagesDir: 'src/pages', routerFile: 'src/router.ts'
  } }))
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
}

for (const mobile of [false, true]) {
  test(`one hover indicator aligns across every content tab on ${mobile ? 'mobile' : 'desktop'} with reduced motion`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    if (mobile) await page.setViewportSize({ width: 390, height: 700 })
    await setup(page)
    const marker = page.locator('.result-hover')
    await expect(marker).toHaveCount(1)
    await expect(marker).toHaveAttribute('aria-hidden', 'true')
    await expect(marker).toHaveCSS('pointer-events', 'none')
    await expect(marker).toHaveCSS('transition-duration', '0s')
    for (const tab of paletteTabs) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      const row = page.locator('.result').first()
      await row.hover()
      await expect(marker).toHaveCSS('opacity', '1')
      const item = (await row.boundingBox())!
      const indicator = (await marker.boundingBox())!
      for (const dimension of ['x', 'y', 'width', 'height'] as const) expect(indicator[dimension]).toBeCloseTo(item[dimension], 0)
    }
    await page.getByRole('button', { name: 'Dark mode', exact: true }).click()
    await page.locator('.result').first().hover()
    expect(await marker.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(45, 48, 54)')
    await page.mouse.move(0, 0)
    await expect(marker).toHaveCSS('opacity', '0')
    expect(errors).toEqual([])
  })
}

test('hover slides between rows, tracks scrolling and clears on filtering without changing keyboard selection', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await page.getByRole('button', { name: 'Components', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const panel = page.locator('.panel')
  await panel.evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)))
  const rows = page.locator('.result')
  const marker = page.locator('.result-hover')
  await rows.nth(1).hover()
  await expect(marker).toHaveCSS('opacity', '1')
  const first = (await rows.nth(1).boundingBox())!
  await expect.poll(async () => (await marker.boundingBox())!.y).toBeCloseTo(first.y, 0)
  const original = await marker.elementHandle()
  await rows.nth(4).hover()
  const positions = await marker.evaluate(async node => {
    const positions: number[] = []
    const start = performance.now()
    while (performance.now() - start < 240) {
      positions.push(node.getBoundingClientRect().y)
      await new Promise(requestAnimationFrame)
    }
    return positions
  })
  const target = (await rows.nth(4).boundingBox())!
  expect(positions.some(y => y > first.y + 1 && y < target.y - 1)).toBe(true)
  expect((await marker.boundingBox())!.y).toBeCloseTo(target.y, 0)
  expect(await marker.evaluate((node, original) => node === original, original)).toBe(true)
  await expect(rows.first()).toHaveClass(/selected/)
  await expect(rows.nth(4)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.screenshot({ path: '/tmp/beast-result-hover.png' })
  await page.locator('.results').evaluate(node => { node.scrollTop += 72 })
  const x = target.x + target.width / 2, y = target.y + target.height / 2
  const hovered = await panel.evaluate((node, { x, y }) => {
    const root = node.getRootNode() as ShadowRoot
    return root.elementFromPoint(x, y)?.closest('.result')?.getBoundingClientRect().y
  }, { x, y })
  expect(hovered).toBeDefined()
  await expect.poll(async () => (await marker.boundingBox())!.y).toBeCloseTo(hovered!, 0)
  const search = page.getByRole('textbox', { name: /Search pages/ })
  await search.fill('no-matching-results')
  await expect(page.getByText('Nothing here just yet', { exact: true })).toBeVisible()
  await expect(marker).toHaveCSS('opacity', '0')
  await expect.poll(() => page.locator('.results').evaluate(node => node.scrollHeight - node.clientHeight)).toBe(0)
  await search.fill('Card')
  await search.press('ArrowDown')
  await expect(page.locator('.result.selected')).toHaveAttribute('data-index', '1')
  expect(errors).toEqual([])
})
