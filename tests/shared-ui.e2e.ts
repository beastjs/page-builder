import { test, expect, type Page } from '@playwright/test'

async function openTabs(page: Page, path = '/') {
  await page.goto(path)
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Add Tabs to a page/ }).click()
  await expect(page.getByRole('heading', { name: 'Add Tabs', exact: true })).toBeVisible()
}

test('shared header goes back and closes while retaining the tabs draft and restoring focus', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openTabs(page)
  const label = page.getByLabel('label · Tab 1', { exact: true })
  await label.fill('Keep this draft')
  await expect(page.getByText('Choose a page and define its tab items', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /Search pages/ })).toBeFocused()
  await page.getByRole('button', { name: /Add Tabs to a page/ }).click()
  await expect(label).toHaveValue('Keep this draft')
  await page.getByRole('button', { name: 'Close builder', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  const launcher = page.getByRole('button', { name: 'Open Beast page builder', exact: true })
  await expect(launcher).toBeFocused()
  await launcher.click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Add Tabs to a page/ }).click()
  await expect(label).toHaveValue('Keep this draft')
  expect(errors).toEqual([])
})

test('shared footer submits its form once, exposes pending state, and keeps theme and errors usable', async ({ page }) => {
  let requests = 0
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const error = 'Review failed <pending> & retry'
  await page.route('**/__beast-page-builder/tabs/preview', async route => {
    requests++
    await pending
    await route.fulfill({ status: 422, json: { error } })
  })
  try {
    await openTabs(page)
    const href = page.getByLabel('href · Tab 1', { exact: true })
    await href.fill('#keep-this-value')
    const review = page.getByRole('button', { name: 'Review Tabs', exact: true })
    await review.click()
    await expect.poll(() => requests).toBe(1)
    const checking = page.getByRole('button', { name: 'Checking…', exact: true })
    await expect(checking).toBeDisabled()
    await expect(checking).toHaveAttribute('aria-busy', 'true')
    await href.press('Enter')
    const theme = page.getByRole('button', { name: 'Dark mode', exact: true })
    await expect(theme).toBeEnabled()
    await theme.click()
    await expect(theme).toHaveAttribute('aria-pressed', 'true')
    await expect(checking).toBeDisabled()
    expect(requests).toBe(1)
    release()
    await expect(page.getByRole('status').filter({ hasText: error })).toHaveText(error)
    await expect(review).toBeEnabled()
    await expect(review).not.toHaveAttribute('aria-busy', 'true')
    await expect(href).toHaveValue('#keep-this-value')
    await review.click()
    await expect.poll(() => requests).toBe(2)
    await expect(review).toBeEnabled()
    await expect(theme).toHaveCount(1)
  } finally {
    release()
  }
})

test('shared header grip supports keyboard reset and pointer dragging on the tabs screen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openTabs(page)
  const label = page.getByLabel('label · Tab 1', { exact: true })
  await label.fill('Move without losing me')
  const dialog = page.getByRole('dialog')
  const before = (await dialog.boundingBox())!
  const grip = page.getByRole('button', { name: 'Move builder', exact: true })
  await grip.focus()
  await grip.press('ArrowRight')
  await grip.press('Shift+ArrowDown')
  const moved = (await dialog.boundingBox())!
  expect(moved.x).toBeCloseTo(before.x + 10, 0)
  expect(moved.y).toBeCloseTo(before.y + 40, 0)
  await grip.press('Home')
  await expect(dialog).not.toHaveAttribute('data-moved')
  const reset = (await dialog.boundingBox())!
  const handle = (await grip.boundingBox())!
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 75, y + 25, { steps: 6 })
  await page.mouse.up()
  const dragged = (await dialog.boundingBox())!
  expect(dragged.x).toBeCloseTo(reset.x + 75, 0)
  expect(dragged.y).toBeCloseTo(reset.y + 25, 0)
  await expect(dialog).not.toHaveAttribute('data-dragging')
  await expect(label).toHaveValue('Move without losing me')
  await page.screenshot({ path: 'test-results/shared-components-desktop.png' })
})

test('shared controls fit on mobile and keep drafts through touch movement and theme changes', async ({ page }) => {
  await page.route('**/__beast-page-builder/config', async route => {
    const response = await route.fetch()
    await route.fulfill({ json: { ...await response.json(), position: 'bottom-right' } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openTabs(page)
  const label = page.getByLabel('label · Tab 1', { exact: true })
  await label.fill('Mobile draft')
  const dialog = page.getByRole('dialog')
  const before = (await dialog.boundingBox())!
  const grip = (await page.getByRole('button', { name: 'Move builder', exact: true }).boundingBox())!
  const session = await page.context().newCDPSession(page)
  try {
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 70 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const after = (await dialog.boundingBox())!
    expect(after.y).toBeCloseTo(before.y - 70, 0)
    expect(after.x).toBeGreaterThanOrEqual(0)
    expect(after.x + after.width).toBeLessThanOrEqual(390)
    expect(after.y + after.height).toBeLessThanOrEqual(844)
    await expect(dialog).not.toHaveAttribute('data-dragging')
    const theme = page.getByRole('button', { name: 'Dark mode', exact: true })
    await theme.click()
    await expect(theme).toHaveAttribute('aria-pressed', 'true')
    await expect(label).toHaveValue('Mobile draft')
    await expect(page.getByRole('button', { name: 'Review Tabs', exact: true })).toBeEnabled()
    await page.screenshot({ path: 'test-results/shared-components-mobile.png' })
  } finally {
    await session.detach()
  }
})

test('shared footer stays disabled until the selected page route is loaded', async ({ page }) => {
  await openTabs(page, '/not-a-page')
  const review = page.getByRole('button', { name: 'Review Tabs', exact: true })
  await expect(review).toBeDisabled()
  const route = page.getByRole('combobox', { name: 'Page route', exact: true })
  await route.fill('Home')
  await route.press('Enter')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Add Tabs', exact: true })).toBeVisible()
  await expect(review).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toHaveCount(1)
})
