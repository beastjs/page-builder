import { expect, test } from 'bun:test'
import { insertSection, suggestLabel, suggestPath } from '../client/pages/model.js'
import { sections, templates } from '../client/templates.js'

test('page suggestions keep acronym boundaries, trailing Page suffixes, and empty route fallback', () => {
  expect(suggestPath('AboutPage')).toBe('/about')
  expect(suggestPath('HTTPSettingsPage')).toBe('/http-settings')
  expect(suggestPath('Version2Page')).toBe('/version2')
  expect(suggestPath('Page')).toBe('/page')
  expect(suggestLabel('AboutUsPage')).toBe('About Us')
  expect(suggestLabel('Home')).toBe('Home')
})

test('sections precede a style block and preserve the complete existing styles', () => {
  const style = templates.landing.slice(templates.landing.indexOf('\nstyle\n'))
  const source = insertSection(templates.landing, sections.Hero)
  expect(source.indexOf('h1 Build something remarkable.')).toBeLessThan(source.indexOf('\nstyle\n'))
  expect(source.endsWith(style)).toBe(true)
  expect(insertSection(templates.blank, sections.Footer)).toBe(templates.blank.trimEnd() + sections.Footer)
})
