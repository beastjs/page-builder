import { expect, test, type Page } from '@playwright/test'
import type { ClientConfig, ProjectScan, SectionInstallPreview, SectionSummary } from '../shared/types.js'

// These fixtures intercept the catalog, scans, and every install; project source is untouched.
const home = 'src/pages/Home.btsx'
const about = 'src/pages/AboutPage.btsx'
const config: ClientConfig = { shortcut: 'Mod+B', position: 'center', theme: 'light', scanDuration: 0, launcher: true, pagesDir: 'src/pages', sectionsDir: 'src/sections', routerFile: 'src/router.ts' }
const inventory: ProjectScan = {
  name: 'Library fixture', scannedAt: '', warnings: [], navigationTargets: [], collections: [], tabComponents: [], tabInstances: [],
  pageRoutes: [{ file: home, name: 'Home', routePath: '/' }, { file: about, name: 'AboutPage', routePath: '/about' }],
  files: [
    { path: about, name: 'AboutPage', kind: 'page', lines: 3, components: ['AboutPage'], error: null },
    { path: home, name: 'Home', kind: 'page', lines: 6, components: ['Home'], error: null },
    { path: 'src/sections/Stats.btsx', name: 'Stats', kind: 'component', lines: 3, components: ['Stats'], error: null },
  ],
  sections: [{ id: 'src/sections/Stats.btsx:1:stats', elementId: 'stats', file: 'src/sections/Stats.btsx', line: 1, marker: 'data-section', kind: 'stats', usedBy: [{ file: home, line: 5 }] }],
}
const summaries: SectionSummary[] = [
  { id: 'hero-split', kind: 'hero', title: 'Split hero', description: 'Headline beside a product shot.', wireframe: ['head gap media', 'long gap media', 'btn ghost gap media'] },
  { id: 'stats-row', kind: 'stats', title: 'Metric row', description: 'Four headline numbers.', wireframe: ['num gap num gap num', 'line gap line gap line'] },
  { id: 'faq-accordion', kind: 'faq', title: 'Accordion FAQ', description: 'Questions that open in place.', wireframe: ['^ title', 'row', 'row'] },
]
const hash = 'd'.repeat(64)
const installed = (template: string, page = home): SectionInstallPreview => ({
  path: 'src/sections/Faq.btsx', page, name: 'Faq', kind: 'faq', template, routePath: page === home ? '/' : '/about', hash,
  warnings: ['No stylesheet in the scanned folders imports tailwindcss.'],
  files: [
    { path: 'src/sections/Faq.btsx', action: 'create', before: null, source: "section(data-section='faq')\n  h2 Questions\n" },
    { path: page, action: 'edit', before: 'main\n', source: "import Faq from '../sections/Faq.btsx'\n\nmain\n  Faq\n" },
  ],
})

async function setup(page: Page) {
  await page.route('**/__beast-page-builder/config', route => route.fulfill({ json: config }))
  await page.route('**/__beast-page-builder/scan', route => route.fulfill({ json: inventory }))
  await page.route('**/__beast-page-builder/sections', route => route.fulfill({ json: summaries }))
}
async function openLibrary(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await expect(page.getByText('Builder ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Browse the section library/ }).click()
  await expect(page.getByRole('heading', { name: 'Section library', exact: true })).toBeVisible()
}

test('library browses by stage, searches, marks kinds on the page, and follows the chosen page', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await openLibrary(page)
  await expect(page.getByRole('searchbox', { name: 'Search sections' })).toBeFocused()
  await expect(page.getByLabel('Add to page')).toHaveValue(home)
  await expect(page.getByText('3 designs · installed as components in src/sections')).toBeVisible()
  const stats = page.locator('[data-kind="stats"]')
  await expect(stats).toContainText('On page')
  await expect(page.locator('[data-kind="faq"]')).not.toContainText('On page')
  await stats.click()
  await expect(stats).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Add another Stats: Metric row' })).toBeVisible()
  await expect(page.locator('.section-card .wireframe .wf-num')).toHaveCount(3)

  await page.getByRole('searchbox', { name: 'Search sections' }).fill('questions')
  await expect(page.getByText('1 design for “questions”')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add FAQ: Accordion FAQ' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search sections' }).fill('nothing-like-this')
  await expect(page.getByText(/No sections match/)).toBeVisible()

  await page.getByLabel('Add to page').selectOption(about)
  await expect(page.getByText(`Adds to ${about}`)).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search sections' }).fill('')
  await expect(page.locator('[data-kind="stats"]')).not.toContainText('On page')
  await page.screenshot({ path: 'test-results/section-library.png' })
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Browse the section library/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('choosing a design reviews, saves, and returns to the library for another section', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  const previews: unknown[] = [], saves: unknown[] = []
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/__beast-page-builder/install/preview', async route => {
    previews.push(route.request().postDataJSON())
    await held
    return route.fulfill({ json: installed('faq-accordion') })
  })
  await page.route('**/__beast-page-builder/install/create', route => {
    saves.push(route.request().postDataJSON())
    return route.fulfill({ status: 201, json: installed('faq-accordion') })
  })
  await openLibrary(page)
  await page.locator('[data-kind="faq"]').click()
  const card = page.getByRole('button', { name: 'Add FAQ: Accordion FAQ' })
  await card.click()
  await expect(card).toHaveAttribute('aria-busy', 'true')
  await expect(card).toContainText('Checking…')
  await expect(page.locator('.section-card').first()).toBeDisabled()
  release()
  await expect(page.getByRole('heading', { name: 'One last look', exact: true })).toBeVisible()
  expect(previews).toEqual([{ page: home, template: 'faq-accordion' }])
  await expect(page.getByRole('list', { name: 'Before this section looks right' })).toContainText('imports tailwindcss')
  await expect(page.locator('.planned-file')).toHaveCount(2)

  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Section library', exact: true })).toBeVisible()
  await expect(card).toBeFocused()
  await card.click()
  await page.getByRole('button', { name: 'Add section', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Section added', exact: true })).toBeVisible()
  expect(saves).toEqual([{ page: home, template: 'faq-accordion', hash }])
  await expect(page.getByRole('heading', { name: 'FAQ is on the page.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open page' })).toHaveAttribute('href', '/')
  expect(await page.evaluate(() => sessionStorage.getItem('beast-page-builder:install:/__beast-page-builder'))).toBe(hash)

  await page.getByRole('button', { name: 'Add another section', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Section library', exact: true })).toBeVisible()
  await expect(page.getByLabel('Add to page')).toHaveValue(home)
  expect(await page.evaluate(() => sessionStorage.getItem('beast-page-builder:install:/__beast-page-builder'))).toBeNull()
  expect(errors).toEqual([])
})

test('a failed review keeps the library and its message; a reload after saving restores the result', async ({ page }) => {
  await setup(page)
  await page.route('**/__beast-page-builder/install/preview', route => route.fulfill({ status: 422, json: { error: 'Wrap the page in one root element before adding sections.' } }))
  await openLibrary(page)
  await page.locator('[data-kind="faq"]').click()
  await page.getByRole('button', { name: 'Add FAQ: Accordion FAQ' }).click()
  await expect(page.getByText('Wrap the page in one root element before adding sections.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Section library', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add FAQ: Accordion FAQ' })).toBeEnabled()

  await page.route('**/__beast-page-builder/install/creation?*', route => route.fulfill({ json: installed('faq-accordion', about) }))
  await page.evaluate(value => sessionStorage.setItem('beast-page-builder:install:/__beast-page-builder', value), hash)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Section added', exact: true })).toBeVisible()
  await expect(page.getByText(`Faq is in src/sections/Faq.btsx and renders on ${about}.`)).toBeVisible()
  await page.locator('.success-body .done').click()
  expect(await page.evaluate(() => sessionStorage.getItem('beast-page-builder:install:/__beast-page-builder'))).toBeNull()
})

test('page editing offers the library for saved pages and names studio sections by kind', async ({ page }) => {
  await setup(page)
  const sources: Record<string, string> = { [home]: 'main\n  h1 Home\n  Stats\n', 'src/sections/Stats.btsx': "section(data-section='stats')\n  p Numbers\n" }
  await page.route('**/__beast-page-builder/source?*', route => route.fulfill({ json: { source: sources[new URL(route.request().url()).searchParams.get('path')!] } }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
  await page.getByRole('button', { name: 'Sections', exact: true }).click()
  await page.getByRole('button', { name: /^Edit Stats/ }).click()
  await expect(page.getByRole('heading', { name: 'Edit Stats', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Add from section library/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Back to builder', exact: true }).click()
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: /^Home/ }).click()
  await page.getByRole('button', { name: 'Edit page', exact: true }).click()
  const library = page.getByRole('button', { name: /Add from section library/ })
  await expect(library).toBeEnabled()
  const editor = page.getByLabel('BTSX page source', { exact: true })
  await editor.fill(sources[home] + '  p Unsaved\n')
  await expect(library).toBeDisabled()
  await editor.fill(sources[home]!)
  await library.click()
  await expect(page.getByRole('heading', { name: 'Section library', exact: true })).toBeVisible()
  await expect(page.getByLabel('Add to page')).toHaveValue(home)
})
