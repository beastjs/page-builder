import { expect, test } from 'bun:test'
import { compileBeastResult } from 'beast-tsrx'
import { discoverSections } from '../server/sections.js'
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

test('palette offers every detected match for editing and creates only missing section names before search filtering', () => {
  const report: ProjectScan = {
    name: 'Fixture', scannedAt: '', warnings: [], files: [], navigationTargets: [], collections: [], pageRoutes: [], tabComponents: [], tabInstances: [],
    sections: [
      { id: 'one', file: 'Header.btsx', line: 2, elementId: 'topbar' },
      { id: 'two', file: 'OtherHeader.btsx', line: 3, elementId: 'TOPBAR' },
      { id: 'three', file: 'Home.btsx', line: 4, elementId: 'partners-marquee' },
      { id: 'four', file: 'Home.btsx', line: 7, elementId: 'custom-section' }
    ]
  }
  const runs: string[] = []
  const noop = () => {}
  const options = {
    report, tab: 'Sections' as const, query: '', launcherHidden: false, shortcut: 'Mod+B', sections: sectionLibrary,
    handlers: { createPage: noop, addTabs: noop, scan: noop, toggleLauncher: noop, editTabs: noop, openFile: noop, openCollection: noop,
      editSection: (section: ProjectScan['sections'][number]) => { runs.push(section.id) }, addSection: (snippet: string) => { runs.push(snippet) } }
  }
  const actions = paletteActions(options)
  expect(actions.filter(action => action.group === 'Existing sections').map(action => action.name)).toEqual(['Edit Topbar', 'Edit Topbar', 'Edit Partners marquee', 'Edit custom-section'])
  expect(actions.filter(action => action.group === 'Create sections').map(action => action.name)).toEqual(['Create Sidebar', 'Create Hero', 'Create Stats', 'Create Footer'])
  actions[1]!.run()
  actions.find(action => action.name === 'Create Sidebar')!.run()
  expect(runs).toEqual(['two', sectionLibrary.Sidebar!])
  expect(paletteActions({ ...options, query: '#topbar' })).toHaveLength(2)
  expect(paletteActions({ ...options, query: 'Create Topbar' })).toEqual([])
  expect(paletteActions({ ...options, tab: 'All' }).some(action => action.name === 'Edit Topbar')).toBe(true)
  expect(paletteActions({ ...options, tab: 'Components' })).toEqual([])
  expect(paletteActions({ ...options, report: null }).filter(action => action.group === 'Create sections')).toHaveLength(6)
})

test('section templates provide matching IDs for the next project scan', () => {
  for (const [name, snippet] of Object.entries(sectionLibrary)) {
    const ast = compileBeastResult('main\n' + snippet, { filename: 'Template.btsx' }).ast
    expect(discoverSections(ast, 'Template.btsx').map(section => section.elementId)).toContain(name.toLowerCase().replaceAll(' ', '-'))
  }
})
