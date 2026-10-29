import { expect, test } from 'bun:test'
import { addStudioStyles, STYLES_MARKER, tailwindSetup, tailwindWarnings, usesTailwind } from '../server/styles.js'
import { sectionTemplates } from '../server/catalog/index.js'

const manifest = (dependencies: Record<string, string>) => JSON.stringify({ devDependencies: dependencies })

test('Tailwind stylesheets are recognised by their import', () => {
  expect(['@import "tailwindcss";', "@import 'tailwindcss/utilities.css' layer(utilities);", '@import url("tailwindcss");'].every(usesTailwind)).toBe(true)
  expect(['@import "./theme.css";', '/* tailwindcss */', '@tailwind utilities;'].some(usesTailwind)).toBe(false)
})

test('setup is ready only with Tailwind v4, an integration, and a stylesheet', () => {
  expect(tailwindSetup(manifest({ tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' }), ['src/style.css'])).toEqual({ version: '^4.1.0', integration: '@tailwindcss/vite', stylesheet: 'src/style.css', ready: true })
  expect(tailwindSetup(manifest({ tailwindcss: 'latest', '@rsbuild/plugin-tailwindcss': '^2.0.0' }), ['a.css', 'b.css'])).toMatchObject({ stylesheet: 'a.css', ready: true })
  expect(tailwindSetup(manifest({ tailwindcss: '^3.4.0', '@tailwindcss/postcss': '^4.0.0' }), ['a.css']).ready).toBe(false)
  expect(tailwindSetup(manifest({ tailwindcss: '^4.0.0' }), ['a.css']).ready).toBe(false)
  expect(tailwindSetup(manifest({ tailwindcss: '^4.0.0', '@tailwindcss/vite': '^4.0.0' }), []).ready).toBe(false)
  expect(tailwindSetup(null, [])).toEqual({ version: null, integration: null, stylesheet: null, ready: false })
  expect(tailwindSetup('{', ['a.css'])).toMatchObject({ version: null, stylesheet: 'a.css', ready: false })
})

test('warnings name each missing piece and nothing for a ready project', () => {
  expect(tailwindWarnings(tailwindSetup(manifest({ tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' }), ['src/style.css']))).toEqual([])
  const missing = tailwindWarnings(tailwindSetup(null, []))
  expect(missing).toHaveLength(2)
  expect(missing[0]).toContain('does not install')
  expect(missing[1]).toContain('@import "tailwindcss"')
  expect(tailwindWarnings(tailwindSetup(manifest({ tailwindcss: '~3.4.0' }), ['a.css']))).toEqual(['Studio sections need Tailwind CSS v4; this project uses tailwindcss ~3.4.0.', expect.stringContaining('bundler integration')])
})

test('the studio block is appended once and covers every keyframe templates animate with', () => {
  const css = '@import "tailwindcss";\n\nbody { margin: 0; }\n'
  const styled = addStudioStyles(css)!
  expect(styled.startsWith(css.trimEnd() + '\n\n' + STYLES_MARKER)).toBe(true)
  expect(addStudioStyles(styled)).toBeNull()
  const used = new Set(sectionTemplates.flatMap(template => [...template.source.matchAll(/animate-\[(studio-[a-z]+)_/g)].map(match => match[1]!)))
  for (const name of used) expect(styled).toContain(`@keyframes ${name} `)
  for (const variable of new Set(sectionTemplates.flatMap(template => [...template.source.matchAll(/var\((--studio-[a-z]+)\)/g)].map(match => match[1]!)))) expect(styled).toContain(`${variable}:`)
})
