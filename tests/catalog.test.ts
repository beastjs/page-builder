import { expect, test } from 'bun:test'
import { compileBeastResult } from 'beast-tsrx'
import { createOctaneCompiler } from 'octane/compiler/bundler'
import { sectionKinds } from '../shared/catalog/kinds.js'
import { searchTemplates, sectionSummaries, sectionTemplate, sectionTemplates, templatesOf } from '../server/catalog/index.js'

test('catalog ids are unique and every kind is registered and offered', () => {
  expect(new Set(sectionTemplates.map(template => template.id)).size).toBe(sectionTemplates.length)
  const kinds = new Set(sectionKinds.map(kind => kind.id))
  for (const template of sectionTemplates) expect(kinds.has(template.kind)).toBe(true)
  for (const kind of sectionKinds) expect(templatesOf(kind.id).length).toBeGreaterThan(0)
})

test('catalog templates follow page order and mark their root with their kind', () => {
  const order = sectionTemplates.map(template => sectionKinds.findIndex(kind => kind.id === template.kind))
  expect(order).toEqual([...order].sort((a, b) => a - b))
  for (const template of sectionTemplates) {
    expect(template.source).toContain(`data-section='${template.kind}'`)
    expect(template.wireframe.length).toBeGreaterThan(0)
  }
})

test('every catalog template compiles with the bundled Beast and Octane compilers', () => {
  const compiler = createOctaneCompiler({ root: process.cwd(), environment: 'client', hmr: false, dev: true })
  const failures: string[] = []
  for (const template of sectionTemplates) {
    const filename = `${process.cwd()}/src/sections/${template.id}.btsx`
    try {
      const result = compileBeastResult(template.source, { filename })
      compiler.transform(result.code, filename.replace(/\.btsx$/, '.tsrx'), { environment: 'client', dev: true })
    } catch (error) { failures.push(`${template.id}: ${error instanceof Error ? error.message.split('\n')[0] : error}`) }
  }
  expect(failures).toEqual([])
})

test('summaries omit sources and lookups search kinds and template text', () => {
  expect(sectionSummaries).toHaveLength(sectionTemplates.length)
  expect(sectionSummaries.some(summary => 'source' in summary)).toBe(false)
  expect(sectionTemplate('stats-row')?.kind).toBe('stats')
  expect(sectionTemplate('missing')).toBeUndefined()
  expect(searchTemplates('').length).toBe(sectionTemplates.length)
  expect(searchTemplates('pricing plans').every(template => template.kind === 'pricing')).toBe(true)
  expect(searchTemplates('waitlist').length).toBeGreaterThan(0)
})
