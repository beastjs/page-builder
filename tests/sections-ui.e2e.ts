import { expect, test, type Page } from '@playwright/test'
import type { PageDraft, PagePreview, ProjectScan } from '../shared/types.js'

const path = 'src/components/SectionHeader.btsx'
const source = 'header#topbar\n  p Original topbar\n'
const inventory: ProjectScan = {
  name: 'Sections fixture', scannedAt: '', warnings: [], navigationTargets: [], collections: [], pageRoutes: [], tabComponents: [], tabInstances: [],
  files: [{ path, name: 'SectionHeader', kind: 'component', lines: 3, components: ['SectionHeader'], error: null }],
  sections: [{ id: `${path}:1:topbar`, elementId: 'topbar', file: path, line: 1 }]
}

async function open(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sections', exact: true }).click()
}

test('real scan replaces matching section templates with edits and keeps creation for missing IDs', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: /^Edit Topbar #topbar/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edit Hero #hero/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edit Footer #footer/ })).toBeVisible()
  await expect(page.locator('[data-action="section:Topbar"], [data-action="section:Hero"], [data-action="section:Footer"]')).toHaveCount(0)
  await expect(page.locator('[data-action="section:Sidebar"]')).toBeVisible()
  await page.getByRole('button', { name: /^Edit Topbar #topbar/ }).click()
  await expect(page.getByRole('heading', { name: 'Edit #topbar', exact: true })).toBeVisible()
  expect(await page.getByLabel('BTSX section source', { exact: true }).inputValue()).toContain('header.workspace-header#topbar')
})

test('detected component sections support search, editing, review and save; missing sections create a draft', async ({ page }) => {
  const errors: string[] = []
  const reviews: PageDraft[] = [], saves: PageDraft[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
  await page.route('**/__beast-page-builder/source?*', route => route.fulfill({ json: { source } }))
  const result = (draft: PageDraft): PagePreview => ({
    path, source: draft.source, section: draft.section, hash: 'a'.repeat(64), routePath: '', navLabel: '',
    files: [{ path, source: draft.source, before: source, action: 'edit' }]
  })
  await page.route('**/__beast-page-builder/preview', route => {
    const draft = route.request().postDataJSON() as PageDraft
    reviews.push(draft)
    return route.fulfill({ json: result(draft) })
  })
  await page.route('**/__beast-page-builder/create', route => {
    const draft = route.request().postDataJSON() as PageDraft
    saves.push(draft)
    return route.fulfill({ json: result(draft) })
  })
  await open(page)
  const search = page.getByRole('textbox', { name: /Search pages/ })
  await search.fill('#topbar')
  await expect(page.locator('.result')).toHaveCount(1)
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: 'Edit #topbar', exact: true })).toBeVisible()
  const editor = page.getByLabel('BTSX section source', { exact: true })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue(source)
  await expect(page.getByLabel('Page name', { exact: true })).toHaveCount(0)
  const updated = source.replace('Original', 'Updated')
  await editor.fill(updated)
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'One last look', exact: true })).toBeVisible()
  expect(reviews).toEqual([{ name: 'SectionHeader', path, section: 'topbar', source: updated }])
  await expect(page.locator('.planned-file')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save section', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Section updated', exact: true })).toBeVisible()
  expect(saves[0]).toEqual({ ...reviews[0]!, hash: 'a'.repeat(64) })
  await page.getByRole('button', { name: 'Edit section', exact: true }).click()
  await expect(editor).toHaveValue(updated)
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await search.fill('Topbar')
  await expect(page.locator('[data-action="section:Topbar"]')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/sections-detected.png' })
  await search.fill('Sidebar')
  await page.getByRole('button', { name: /^Create Sidebar/ }).click()
  await expect(page.getByLabel('BTSX page source', { exact: true })).toHaveValue(/aside.sidebar#sidebar/)
  expect(errors).toEqual([])
})
