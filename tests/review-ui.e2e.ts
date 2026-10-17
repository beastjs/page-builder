import { expect, test, type Page } from '@playwright/test'
import type { PageDraft, PagePreview, ProjectScan, TabsDraft, TabsPreview } from '../shared/types.js'
import type { ReviewMode } from '../client/review/types.js'

const pagePath = 'src/pages/ReviewPage.btsx'
const original = 'main\n  p Original <source> & "quotes"\n'
const proposed = 'main\n  p Proposed <img data-review-injection> & "quotes"\n  p ' + 'Long source '.repeat(40) + '\n'
const component = {
  id: 'src/components/Tabs.btsx', file: 'src/components/Tabs.btsx', name: 'Tabs', itemProp: 'items',
  activeProp: 'active', labelProp: 'label',
  itemType: { name: 'TabItem', origin: 'declared' as const, fields: [
    { name: 'id', type: 'string', optional: false, scalar: 'string' as const },
    { name: 'label', type: 'string', optional: false, scalar: 'string' as const },
    { name: 'href', type: 'string', optional: false, scalar: 'string' as const }
  ] }
}
const tabsDraft: TabsDraft = {
  page: pagePath, routePath: '/', component: component.id, active: 'one', label: 'Existing tabs', instance: 'existing-tabs',
  items: [{ id: 'one', label: 'First', href: '#one' }, { id: 'two', label: 'Second', href: '#two' }]
}
const inventory: ProjectScan = {
  name: 'Review fixture', scannedAt: '', warnings: [], collections: [],
  files: [{ name: 'ReviewPage', path: pagePath, kind: 'page', lines: 3, components: [], error: null }],
  navigationTargets: [{ id: 'menu', file: 'src/Header.btsx', label: 'Main menu' }],
  pageRoutes: [{ file: pagePath, name: 'ReviewPage', routePath: '/' }], tabComponents: [component],
  tabInstances: [{ id: 'existing-tabs', page: pagePath, routePath: '/', component: component.id, line: 2, draft: tabsDraft }]
}
const modes: { mode: ReviewMode; label: string; hint: string; tabs: boolean }[] = [
  { mode: 'create-page', label: 'Create page', hint: 'Creates the page and updates the route and navigation together.', tabs: false },
  { mode: 'edit-page', label: 'Save page', hint: 'Updates the existing page source.', tabs: false },
  { mode: 'add-tabs', label: 'Add Tabs', hint: 'Adds the Tabs component and its items to this page.', tabs: true },
  { mode: 'edit-tabs', label: 'Save tabs', hint: 'Updates this tab group in place.', tabs: true }
]
function preview(mode: ReviewMode, hash = 'a'.repeat(64)): PagePreview {
  const creating = mode === 'create-page'
  return {
    path: pagePath, source: proposed, hash, routePath: creating ? '/review' : '/', navLabel: 'Review',
    files: [
      { path: pagePath, action: creating ? 'create' : 'edit', before: creating ? null : original, source: proposed },
      ...(creating ? [
        { path: 'src/router.ts', action: 'edit' as const, before: original, source: 'const route = "<route> & new"\n' },
        { path: 'src/Header.btsx', action: 'edit' as const, before: '', source: 'nav\n  a(href="/review") Review & more\n' }
      ] : [])
    ]
  }
}
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
  await page.route('**/__beast-page-builder/source?*', route => route.fulfill({ json: { source: original } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
}
async function enterDraft(page: Page, mode: ReviewMode) {
  if (mode === 'create-page') {
    await page.getByRole('button', { name: /Create a new page/ }).click()
    await page.getByLabel('Page name', { exact: true }).fill('ReviewPage')
    await page.getByLabel('BTSX page source', { exact: true }).fill(proposed)
  } else if (mode === 'edit-page') {
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
    await page.getByRole('button', { name: /ReviewPage src\/pages/ }).click()
    await page.getByRole('button', { name: 'Edit page', exact: true }).click()
    await page.getByLabel('BTSX page source', { exact: true }).fill(proposed)
  } else if (mode === 'add-tabs') {
    await page.getByRole('button', { name: /Add Tabs to a page/ }).click()
  } else {
    await page.getByRole('button', { name: /^Edit Existing tabs/ }).click()
  }
}
async function review(page: Page, mode: ReviewMode) {
  await page.getByRole('button', { name: mode.includes('tabs') ? 'Review Tabs' : mode === 'edit-page' ? 'Review changes' : 'Review page', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'One last look', exact: true })).toBeVisible()
}
async function expectSuccess(page: Page, mode: ReviewMode) {
  await expect(page.getByRole('heading', { name: mode.includes('tabs') ? 'Your tabs are ready.' : `ReviewPage is ${mode === 'create-page' ? 'created' : 'updated'}.`, exact: true })).toBeVisible()
}

for (const { mode, label, hint, tabs } of modes) {
  test(`${mode} review preserves literal files, disclosure state, pending protection, and save retry`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const result = preview(mode)
    const saves: (PageDraft | TabsDraft)[] = []
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const endpoint = tabs ? 'tabs/' : ''
    await page.route(`**/__beast-page-builder/${endpoint}preview`, route => route.fulfill({ json: result }))
    await page.route(`**/__beast-page-builder/${endpoint}create`, async route => {
      saves.push(route.request().postDataJSON())
      if (saves.length === 1) {
        await pending
        await route.fulfill({ status: 503, json: { error: 'Save failed <temporarily> & retry' } })
      } else await route.fulfill({ json: result })
    })
    try {
      if (mode === 'edit-tabs') await page.setViewportSize({ width: 390, height: 844 })
      await setup(page)
      await enterDraft(page, mode)
      await review(page, mode)
      await expect(page.getByText(hint, { exact: true })).toBeVisible()
      await expect(page.getByText('Compiles with Beast and Octane', { exact: true })).toBeVisible()
      await expect(page.locator('.planned-file')).toHaveCount(result.files.length)
      await expect(page.locator('.action-footer > span')).toHaveText(`${result.files.length} files · ${result.routePath}`)
      await expect(page.locator('.planned-file > summary small').first()).toHaveText(mode === 'create-page' ? 'New file' : 'Update')
      expect(await page.getByLabel(`Proposed ${pagePath}`, { exact: true }).textContent()).toBe(proposed)
      await expect(page.locator('[data-review-injection]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
      await expect(page.getByLabel(mode === 'create-page' ? 'Page name' : mode === 'edit-page' ? 'BTSX page source' : mode === 'add-tabs' ? 'Page route' : 'Tabs label', { exact: true })).toBeFocused()
      await review(page, mode)
      const existing = page.locator('.planned-file').filter({ has: page.locator('.original-file') }).first()
      await existing.locator('.original-file > summary').click()
      const before = result.files.find(file => file.before !== null)!
      expect(await page.getByLabel(`Current ${before.path}`, { exact: true }).textContent()).toBe(before.before)
      if (mode === 'create-page') {
        const emptyBefore = page.locator('.planned-file').last().locator('.original-file')
        await emptyBefore.locator('summary').click()
        expect(await page.getByLabel('Current src/Header.btsx', { exact: true }).textContent()).toBe('')
      }
      const first = page.locator('.planned-file').first()
      await first.locator(':scope > summary').click()
      await first.evaluate(node => { node.setAttribute('data-retained-review', 'yes') })
      const save = page.getByRole('button', { name: label, exact: true })
      await save.click()
      await expect.poll(() => saves.length).toBe(1)
      const saving = page.getByRole('button', { name: 'Saving…', exact: true })
      await expect(saving).toBeDisabled()
      await expect(saving).toHaveAttribute('aria-busy', 'true')
      await saving.evaluate((node: HTMLButtonElement) => { node.click(); node.click() })
      const theme = page.getByRole('button', { name: 'Dark mode', exact: true })
      await theme.click()
      await expect(theme).toHaveAttribute('aria-pressed', 'true')
      await expect(first).not.toHaveAttribute('open')
      await expect(first).toHaveAttribute('data-retained-review', 'yes')
      await expect(existing.locator('.original-file')).toHaveAttribute('open')
      expect(saves).toHaveLength(1)
      expect(saves[0]).toMatchObject({ hash: result.hash, ...(tabs ? { page: pagePath, component: component.id } : { name: 'ReviewPage', source: proposed }) })
      expect('path' in saves[0] ? saves[0].path : undefined).toBe(mode === 'edit-page' ? pagePath : undefined)
      expect('instance' in saves[0] ? saves[0].instance : undefined).toBe(mode === 'edit-tabs' ? tabsDraft.instance : undefined)
      release()
      await expect(page.locator('.message')).toHaveText('Save failed <temporarily> & retry')
      await expect(save).toBeEnabled()
      await expect(first).not.toHaveAttribute('open')
      await expect(first).toHaveAttribute('data-retained-review', 'yes')
      expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('beast-page-builder:')))).toEqual([])
      if (mode === 'create-page' || mode === 'edit-tabs') {
        await first.locator(':scope > summary').click()
        const source = page.getByLabel(`Proposed ${pagePath}`, { exact: true })
        await source.focus()
        await expect(source).toBeFocused()
        if (mode === 'edit-tabs') expect(await source.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
        await page.screenshot({ path: `test-results/review-${mode}.png` })
        const box = (await page.getByRole('dialog').boundingBox())!
        const viewport = page.viewportSize()!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      }
      await save.click()
      await expectSuccess(page, mode)
      expect(saves).toHaveLength(2)
      expect(saves[1]).toEqual(saves[0])
      expect(errors).toEqual([])
    } finally { release() }
  })
}

for (const mode of ['create-page', 'add-tabs'] as const) {
  test(`${mode} stale save returns to the draft and submits the newly reviewed hash`, async ({ page }) => {
    const endpoint = mode === 'add-tabs' ? 'tabs/' : ''
    const hashes: string[] = []
    let reviews = 0
    let latest: PagePreview | TabsPreview
    await page.route(`**/__beast-page-builder/${endpoint}preview`, async route => {
      latest = preview(mode, (++reviews === 1 ? 'a' : 'b').repeat(64))
      await route.fulfill({ json: latest })
    })
    await page.route(`**/__beast-page-builder/${endpoint}create`, async route => {
      hashes.push(route.request().postDataJSON().hash)
      if (hashes.length === 1) await route.fulfill({ status: 409, json: { error: 'Project files changed. Review again before saving.' } })
      else await route.fulfill({ json: latest })
    })
    await setup(page)
    await enterDraft(page, mode)
    await review(page, mode)
    const save = page.getByRole('button', { name: mode === 'add-tabs' ? 'Add Tabs' : 'Create page', exact: true })
    await save.click()
    await expect(page.locator('.message')).toHaveText('Project files changed. Review again before saving.')
    await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
    if (mode === 'add-tabs') await expect(page.getByLabel('label · Tab 1', { exact: true })).toHaveValue('Tab 1')
    else await expect(page.getByLabel('BTSX page source', { exact: true })).toHaveValue(proposed)
    await review(page, mode)
    await save.click()
    await expectSuccess(page, mode)
    expect(hashes).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })
}

test('tabs review cannot save after leaving its loaded route and requires another review on return', async ({ page }) => {
  let reviews = 0, saves = 0
  await page.route('**/__beast-page-builder/tabs/preview', route => { reviews++; return route.fulfill({ json: preview('add-tabs') }) })
  await page.route('**/__beast-page-builder/tabs/create', route => { saves++; return route.fulfill({ json: preview('add-tabs') }) })
  await setup(page)
  await enterDraft(page, 'add-tabs')
  await review(page, 'add-tabs')
  await page.evaluate(() => {
    history.pushState({}, '', '/not-the-selected-route')
    const button = document.querySelector('#beast-page-builder')!.shadowRoot!.querySelector<HTMLButtonElement>('button.save')!
    button.click()
  })
  await expect(page.getByRole('heading', { name: 'Add Tabs', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review Tabs', exact: true })).toBeDisabled()
  expect(saves).toBe(0)
  await page.evaluate(() => history.pushState({}, '', '/'))
  await expect(page.getByRole('button', { name: 'Review Tabs', exact: true })).toBeEnabled()
  await review(page, 'add-tabs')
  expect(reviews).toBe(2)
  await page.getByRole('button', { name: 'Add Tabs', exact: true }).click()
  await expectSuccess(page, 'add-tabs')
  expect(saves).toBe(1)
})

test('a pending page save cannot reopen a closed review', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let saving = false
  await page.route('**/__beast-page-builder/preview', route => route.fulfill({ json: preview('create-page') }))
  await page.route('**/__beast-page-builder/create', async route => {
    saving = true
    await pending
    await route.fulfill({ json: preview('create-page') })
  })
  try {
    await setup(page)
    await enterDraft(page, 'create-page')
    await review(page, 'create-page')
    await page.getByRole('button', { name: 'Create page', exact: true }).click()
    await expect.poll(() => saving).toBe(true)
    await page.getByRole('button', { name: 'Close builder', exact: true }).click()
    const response = page.waitForResponse('**/__beast-page-builder/create')
    release()
    await response
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open Beast page builder', exact: true })).toBeFocused()
  } finally { release() }
})
