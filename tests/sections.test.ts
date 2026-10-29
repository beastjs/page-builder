import { expect, test } from 'bun:test'
import { compileBeastResult } from 'beast-tsrx'
import { discoverComponentUses, discoverSections } from '../server/sections.js'
import { sectionTemplates } from '../server/catalog/index.js'
import { sectionKindOf } from '../shared/sections.js'
import { paletteActions } from '../client/palette/actions.js'
import { sectionLibrary } from '../client/templates.js'
import type { ProjectScan } from '../shared/types.js'

test('section discovery reads IDs in nested markup and local components, excluding references and computed IDs', () => {
  const source = `component Local
  aside(id="sidebar")

setup
  const dynamic = 'stats'
  const show = true

main#hero
  // section#comment
  a(href="#footer") Footer
  if show
    header#topbar
  section(id={'partners-marquee'})
  section(id={dynamic})
  footer(id={\`footer\`})

style
  #stats { color: red; }
`
  const sections = discoverSections(compileBeastResult(source, { filename: 'Example.btsx' }).ast, 'Example.btsx')
  expect(sections.map(section => section.elementId)).toEqual(['sidebar', 'hero', 'topbar', 'partners-marquee', 'footer'])
  expect(sections.find(section => section.elementId === 'topbar')).toMatchObject({ file: 'Example.btsx', line: 12 })
})

test('section discovery reads studio data-section roots and resolves catalog kinds', () => {
  const source = `setup
  const kind = 'faq'

div(data-page='home')
  section(data-section='stats')
  section(data-section={'partners'})
  section(data-section={kind})
  section#pricing-table(data-section='pricing')
  section#partners-marquee
  aside#sidebar
`
  const sections = discoverSections(compileBeastResult(source, { filename: 'Page.btsx' }).ast, 'Page.btsx')
  expect(sections.map(({ elementId, marker, kind }) => ({ elementId, marker, kind }))).toEqual([
    { elementId: 'stats', marker: 'data-section', kind: 'stats' },
    { elementId: 'partners', marker: 'data-section', kind: 'partners' },
    { elementId: 'pricing-table', marker: undefined, kind: 'pricing' },
    { elementId: 'partners-marquee', marker: undefined, kind: 'partners' },
    { elementId: 'sidebar', marker: undefined, kind: undefined },
  ])
  expect(['cta', 'Call to action', 'CallToAction', 'FAQ', 'faq'].map(sectionKindOf)).toEqual(['cta', 'cta', 'cta', 'faq', 'faq'])
  expect(sectionKindOf('sidebar')).toBeUndefined()
})

test('every catalog template is discovered as its own kind', () => {
  for (const template of sectionTemplates) {
    const sections = discoverSections(compileBeastResult(template.source, { filename: 'Template.btsx' }).ast, 'Template.btsx')
    expect(sections.filter(section => section.marker === 'data-section').map(section => section.kind)).toEqual([template.kind])
  }
})

test('component uses follow relative default .btsx imports to rendered tags only', () => {
  const source = `import Stats from './sections/Stats.btsx'
import Faq from '../shared/Faq.btsx'
import type Hero from './sections/Hero.btsx'
import { Footer } from './sections/Footer.btsx'
import Remote from 'package/Remote.btsx'
import Unused from './sections/Unused.btsx'

main
  Stats
  if true
    Faq
  Stats
  Footer
  Remote
`
  const uses = discoverComponentUses(compileBeastResult(source, { filename: 'Home.btsx' }).ast, 'src/pages/Home.btsx')
  expect(Object.fromEntries(uses)).toEqual({
    'src/pages/sections/Stats.btsx': [{ file: 'src/pages/Home.btsx', line: 9 }, { file: 'src/pages/Home.btsx', line: 12 }],
    'src/shared/Faq.btsx': [{ file: 'src/pages/Home.btsx', line: 11 }],
  })
})

test('palette offers every detected match for editing and creates only missing section names before search filtering', () => {
  const report: ProjectScan = {
    name: 'Fixture', scannedAt: '', warnings: [], files: [], navigationTargets: [], collections: [], pageRoutes: [], tabComponents: [], tabInstances: [],
    sections: [
      { id: 'one', file: 'Header.btsx', line: 2, elementId: 'topbar' },
      { id: 'two', file: 'OtherHeader.btsx', line: 3, elementId: 'TOPBAR' },
      { id: 'three', file: 'Home.btsx', line: 4, elementId: 'partners-marquee' },
      { id: 'four', file: 'Home.btsx', line: 7, elementId: 'custom-section' },
      { id: 'five', file: 'sections/Stats.btsx', line: 1, elementId: 'stats', marker: 'data-section', kind: 'stats', usedBy: [{ file: 'Home.btsx', line: 9 }] },
      { id: 'six', file: 'sections/Faq.btsx', line: 1, elementId: 'faq', marker: 'data-section', kind: 'faq' }
    ]
  }
  const runs: string[] = []
  const noop = () => {}
  const options = {
    report, tab: 'Sections' as const, query: '', launcherHidden: false, shortcut: 'Mod+B', sections: sectionLibrary,
    handlers: { createPage: noop, addTabs: noop, openLibrary: () => { runs.push('library') }, scan: noop, toggleLauncher: noop, editTabs: noop, openFile: noop, openCollection: noop,
      editSection: (section: ProjectScan['sections'][number]) => { runs.push(section.id) }, addSection: (snippet: string) => { runs.push(snippet) } }
  }
  const actions = paletteActions(options)
  expect(actions.filter(action => action.group === 'Existing sections').map(action => action.name)).toEqual(['Edit Topbar', 'Edit Topbar', 'Edit Partners marquee', 'Edit custom-section', 'Edit Stats', 'Edit FAQ'])
  expect(actions.find(action => action.id === 'section:edit:five')?.detail).toBe('data-section=stats · sections/Stats.btsx:1 · on Home.btsx')
  expect(actions.filter(action => action.group === 'Create sections').map(action => action.name)).toEqual(['Browse the section library', 'Create Sidebar', 'Create Hero', 'Create Footer'])
  actions[1]!.run()
  actions.find(action => action.name === 'Create Sidebar')!.run()
  actions.find(action => action.id === 'action:section-library')!.run()
  expect(runs).toEqual(['two', sectionLibrary.Sidebar!, 'library'])
  expect(paletteActions({ ...options, query: '#topbar' })).toHaveLength(2)
  expect(paletteActions({ ...options, query: 'Create Topbar' })).toEqual([])
  expect(paletteActions({ ...options, tab: 'All' }).some(action => action.name === 'Edit Topbar')).toBe(true)
  expect(paletteActions({ ...options, tab: 'Components' })).toEqual([])
  expect(paletteActions({ ...options, report: null }).filter(action => action.group === 'Create sections')).toHaveLength(7)
})

test('section templates provide matching IDs for the next project scan', () => {
  for (const [name, snippet] of Object.entries(sectionLibrary)) {
    const ast = compileBeastResult('main\n' + snippet, { filename: 'Template.btsx' }).ast
    expect(discoverSections(ast, 'Template.btsx').map(section => section.elementId)).toContain(name.toLowerCase().replaceAll(' ', '-'))
  }
})
