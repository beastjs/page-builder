import { expect, test } from '@playwright/test'

test('bundled OKX and BMR fonts load and apply to interface text, shortcuts and source editors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: {
    name: 'Fonts fixture', scannedAt: '', warnings: [], files: [], sections: [], navigationTargets: [], collections: [], pageRoutes: [], tabComponents: [], tabInstances: []
  } }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open Beast page builder', exact: true })).toBeVisible()
  const loaded = await page.evaluate(async () => {
    const faces = await Promise.all(['400 14px OKX', '500 14px OKX', '400 12px BMR'].map(font => document.fonts.load(font)))
    return faces.map(faces => faces.map(face => ({ family: face.family, weight: face.weight, status: face.status })))
  })
  expect(loaded).toEqual([
    [{ family: 'OKX', weight: '400', status: 'loaded' }],
    [{ family: 'OKX', weight: '500', status: 'loaded' }],
    [{ family: 'BMR', weight: '400', status: 'loaded' }]
  ])
  await expect(page.locator('.widget')).toHaveCSS('font-family', /^"?OKX"?,/)
  await expect(page.locator('.launcher kbd')).toHaveCSS('font-family', /^"?BMR"?,/)
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Create a new page/ }).click()
  await expect(page.getByLabel('Page name', { exact: true })).toHaveCSS('font-family', /^"?OKX"?,/)
  await expect(page.getByLabel('BTSX page source', { exact: true })).toHaveCSS('font-family', /^"?BMR"?,/)
  await page.screenshot({ path: '/tmp/beast-builder-fonts.png' })
  await page.locator('#beast-page-builder').evaluate(node => node.remove())
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
  await page.addScriptTag({ type: 'module', url: '/__beast-page-builder/client.js?fonts-remount=1' })
  await expect(page.getByRole('button', { name: 'Open Beast page builder', exact: true })).toBeVisible()
  expect(await page.evaluate(() => [...document.fonts].filter(face => ['OKX', 'BMR'].includes(face.family)).length)).toBe(3)
  expect(errors).toEqual([])
})
