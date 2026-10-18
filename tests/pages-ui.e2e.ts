import { expect, test, type Page } from '@playwright/test'
import type { NavigationTarget, PageDraft, PagePreview, ProjectScan } from '../shared/types.js'
import { sections, templates } from '../client/templates.js'

const targets: NavigationTarget[] = [
  { id: 'main', file: 'src/Header.btsx', label: 'Main menu', itemType: { name: 'MainLink', origin: 'declared', fields: [] } },
  { id: 'footer', file: 'src/Footer.btsx', label: 'Footer menu', itemType: { name: 'FooterLink', origin: 'inferred', fields: [] } }
]
const inventory: ProjectScan = {
  sections: [],
  name: 'Page editor fixture', scannedAt: '', warnings: [], navigationTargets: targets,
  files: [{ name: 'FixturePage', path: 'src/pages/FixturePage.btsx', kind: 'page', lines: 3, components: [], error: null }],
  collections: [], pageRoutes: [], tabComponents: [], tabInstances: []
}
const result = (draft: PageDraft): PagePreview => ({
  path: draft.path ?? `src/pages/${draft.name}.btsx`, source: draft.source, hash: 'a'.repeat(64),
  routePath: draft.routePath ?? '/fixture', navLabel: draft.navLabel ?? 'Fixture',
  files: [{ path: draft.path ?? `src/pages/${draft.name}.btsx`, source: draft.source, before: null, action: 'create' }]
})
async function setup(page: Page, navigationTargets = targets) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: { ...inventory, navigationTargets } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
}
async function create(page: Page) {
  await page.getByRole('button', { name: /Create a new page/ }).click()
  await expect(page.getByLabel('Page name', { exact: true })).toBeFocused()
}

test('page suggestions track typing until overridden; source selection and drafts survive view and theme changes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await create(page)
  const name = page.getByLabel('Page name', { exact: true })
  const path = page.getByLabel('Page URL', { exact: true })
  const label = page.getByLabel('Navigation label', { exact: true })
  await name.fill('AboutUsPage')
  await expect(path).toHaveValue('/about-us')
  await expect(label).toHaveValue('About Us')
  await path.fill('/custom')
  await label.fill('Custom <link> & label')
  await name.fill('PricingPage')
  await expect(path).toHaveValue('/custom')
  await expect(label).toHaveValue('Custom <link> & label')
  const menu = page.getByLabel('Add link to', { exact: true })
  await menu.selectOption('main')
  await expect(page.locator('.nav-contract')).toHaveText('Item type: MainLink · Declared type')
  await menu.selectOption('footer')
  await expect(page.locator('.nav-contract')).toHaveText('Item type: FooterLink · Inferred shape')
  const source = page.getByLabel('BTSX page source', { exact: true })
  await source.fill('main\n  p Preserve my caret\n')
  await source.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(9, 17))
  await source.press('x')
  await expect(source).toBeFocused()
  await expect(source).toHaveValue('main\n  p x my caret\n')
  expect(await source.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(10)
  const theme = page.getByRole('button', { name: 'Dark mode', exact: true })
  await theme.click()
  await expect(source).toHaveValue('main\n  p x my caret\n')
  expect(await source.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(10)
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await create(page)
  await expect(source).toHaveValue('main\n  p x my caret\n')
  await expect(menu).toHaveValue('footer')
  await expect(path).toHaveValue('/custom')
  await page.getByRole('button', { name: 'Close builder', exact: true }).click()
  const launcher = page.getByRole('button', { name: 'Open Beast page builder', exact: true })
  await expect(launcher).toBeFocused()
  await launcher.click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
  await create(page)
  await expect(name).toHaveValue('PricingPage')
  await expect(label).toHaveValue('Custom <link> & label')
  await expect(source).toHaveValue('main\n  p x my caret\n')
  await page.screenshot({ path: 'test-results/pages-editor-desktop.png' })
  expect(errors).toEqual([])
})

test('templates and repeated section insertion preserve styles; single and missing menus have guidance', async ({ page }) => {
  await setup(page, [targets[0]])
  await create(page)
  await expect(page.locator('.nav-contract')).toHaveText('Item type: MainLink · Declared type')
  const source = page.getByLabel('BTSX page source', { exact: true })
  await page.getByRole('button', { name: 'Landing page', exact: true }).click()
  await expect(source).toHaveValue(templates.landing)
  await page.getByText('Add a section +', { exact: true }).click()
  await page.getByRole('button', { name: 'Hero', exact: true }).click()
  await page.getByRole('button', { name: 'Footer', exact: true }).click()
  const value = await source.inputValue()
  expect(value.match(/h1 Build something remarkable\./g)).toHaveLength(1)
  expect(value.match(/p Built with care\. Made to be shared\./g)).toHaveLength(1)
  expect(value.indexOf('h1 Build something remarkable.')).toBeLessThan(value.indexOf('\nstyle\n'))
  expect(value.indexOf(sections.Footer.trim())).toBeLessThan(value.indexOf('\nstyle\n'))
  expect(value.endsWith(templates.landing.slice(templates.landing.indexOf('\nstyle\n')))).toBe(true)
  await page.getByText('Add a section +', { exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/pages-create-mobile.png' })
  await page.getByRole('button', { name: 'Blank page', exact: true }).click()
  await expect(source).toHaveValue(templates.blank)
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: { ...inventory, navigationTargets: [] } }))
  await page.getByRole('button', { name: 'Close builder', exact: true }).click()
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
  await create(page)
  await expect(page.getByText('No editable menu found. Configure navigation.file for this project.', { exact: true })).toBeVisible()
})

test('review submits once, discards a response after further edits, retries errors, and re-reviews changed source', async ({ page }) => {
  const submitted: PageDraft[] = []
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/__beast-page-builder/preview', async route => {
    const draft = route.request().postDataJSON() as PageDraft
    submitted.push(draft)
    if (submitted.length === 1) await pending
    if (submitted.length === 2) await route.fulfill({ status: 422, json: { error: 'Invalid <source> & retry' } })
    else await route.fulfill({ json: result(draft) })
  })
  try {
    await setup(page)
    await create(page)
    const name = page.getByLabel('Page name', { exact: true })
    const source = page.getByLabel('BTSX page source', { exact: true })
    await name.fill('ReviewPage')
    await name.press('Enter')
    await expect.poll(() => submitted.length).toBe(1)
    const checking = page.getByRole('button', { name: 'Checking…', exact: true })
    await expect(checking).toBeDisabled()
    await expect(checking).toHaveAttribute('aria-busy', 'true')
    await source.fill('main\n  p Changed while pending\n')
    await name.press('Enter')
    expect(submitted).toHaveLength(1)
    release()
    const review = page.getByRole('button', { name: 'Review page', exact: true })
    await expect(review).toBeEnabled()
    await expect(page.getByRole('heading', { name: 'One last look', exact: true })).toHaveCount(0)
    await review.click()
    await expect(page.locator('.message')).toHaveText('Invalid <source> & retry')
    await expect(source).toHaveValue('main\n  p Changed while pending\n')
    await review.click()
    await expect(page.getByRole('heading', { name: 'One last look', exact: true })).toBeVisible()
    expect(submitted[2].source).toBe('main\n  p Changed while pending\n')
    await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
    await source.fill('main\n  p Reviewed again\n')
    await review.click()
    await expect(page.getByRole('heading', { name: 'One last look', exact: true })).toBeVisible()
    expect(submitted[3].source).toBe('main\n  p Reviewed again\n')
    await expect(page.locator('.planned-file')).toContainText('Reviewed again')
  } finally { release() }
})

test('existing page editing keeps source literal and unsaved changes when returning from review or the palette', async ({ page }) => {
  await page.route('**/__beast-page-builder/source?*', route => route.fulfill({ json: { source: 'main\n  p Original <literal> & source\n' } }))
  await page.route('**/__beast-page-builder/preview', route => route.fulfill({ json: result(route.request().postDataJSON()) }))
  await setup(page)
  const edit = async () => {
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
    await page.getByRole('button', { name: /FixturePage src\/pages/ }).click()
    await page.getByRole('button', { name: 'Edit page', exact: true }).click()
  }
  await edit()
  const source = page.getByLabel('BTSX page source', { exact: true })
  await expect(source).toBeFocused()
  await expect(source).toHaveValue('main\n  p Original <literal> & source\n')
  await expect(page.getByLabel('Page name', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Landing page', exact: true })).toHaveCount(0)
  await source.fill('main\n  p Unsaved <edits> & source\n')
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save page', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await expect(source).toHaveValue('main\n  p Unsaved <edits> & source\n')
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await edit()
  await expect(source).toHaveValue('main\n  p Unsaved <edits> & source\n')
  await page.setViewportSize({ width: 390, height: 844 })
  const theme = page.getByRole('button', { name: 'Dark mode', exact: true })
  await theme.click()
  await page.screenshot({ path: 'test-results/pages-editor-mobile.png' })
  const box = (await page.getByRole('dialog').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await create(page)
  await expect(source).toHaveValue(templates.blank)
  await expect(page.getByLabel('Page name', { exact: true })).toHaveValue('UntitledPage')
  await expect(page.getByRole('button', { name: 'Review page', exact: true })).toBeEnabled()
})
