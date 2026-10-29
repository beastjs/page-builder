import { expect, test } from 'bun:test'
import { compileBeastResult, type BeastNode } from 'beast-tsrx'
import { addSectionUse } from '../server/install.js'
import { literalAttr } from '../server/sections.js'
import { sectionKindOf } from '../shared/sections.js'
import type { SectionKindId } from '../shared/catalog/types.js'

const kindOf = (node: BeastNode) => {
  if (node.kind !== 'element') return undefined
  const marker = literalAttr(node, 'data-section') ?? node.id
  // Real installs type component tags by the section file they import; here the tag names the kind.
  return marker ? sectionKindOf(marker) : node.isComponent ? sectionKindOf(node.tag) : undefined
}
const add = (source: string, kind: SectionKindId, name: string, index?: number) =>
  addSectionUse(source, compileBeastResult(source, { filename: 'Home.btsx' }).ast, { name, specifier: `../sections/${name}.btsx`, kind, index }, kindOf)

const page = `import Pricing from '../sections/Pricing.btsx'

main.page
  nav#topbar
    a(href="/") Home
  section#hero
    h1 Hi
  Pricing
  footer#footer
    p Bye

style
  .page { color: red; }
`

test('a section lands before the first child of a later kind, with its import after the others', () => {
  expect(add(page, 'stats', 'Stats')).toBe(`import Pricing from '../sections/Pricing.btsx'
import Stats from '../sections/Stats.btsx'

main.page
  nav#topbar
    a(href="/") Home
  section#hero
    h1 Hi
  Stats
  Pricing
  footer#footer
    p Bye

style
  .page { color: red; }
`)
  expect(add(page, 'newsletter', 'Newsletter').split('\n').slice(9, 11)).toEqual(['  Newsletter', '  footer#footer'])
})

test('a section of the last kind goes after the root subtree and before styles', () => {
  const result = add(page.replace('  footer#footer\n    p Bye\n', ''), 'footer', 'Footer')
  expect(result.split('\n').slice(8, 12)).toEqual(['  Pricing', '  Footer', '', 'style'])
})

test('pages without known sections append, except navigation, which goes first', () => {
  const plain = 'main\n    h1 Hello\n    p There\n'
  expect(add(plain, 'faq', 'Faq')).toBe("import Faq from '../sections/Faq.btsx'\n\nmain\n    h1 Hello\n    p There\n    Faq\n")
  expect(add(plain, 'topbar', 'Topbar')).toBe("import Topbar from '../sections/Topbar.btsx'\n\nmain\n    Topbar\n    h1 Hello\n    p There\n")
  expect(add('main.empty\n', 'hero', 'Hero')).toBe("import Hero from '../sections/Hero.btsx'\n\nmain.empty\n  Hero\n")
})

test('an explicit index overrides story order and is range checked', () => {
  expect(add(page, 'footer', 'Footer2', 0).split('\n').slice(3, 5)).toEqual(['main.page', '  Footer2'])
  expect(add(page, 'footer', 'Footer2', 4).split('\n').slice(10, 13)).toEqual(['    p Bye', '  Footer2', ''])
  expect(() => add(page, 'footer', 'Footer2', 5)).toThrow('between 0 and 4')
  expect(() => add(page, 'footer', 'Footer2', 1.5)).toThrow('between 0 and 4')
})

test('pages need exactly one non-void root element', () => {
  expect(() => add('main\n  h1 A\nfooter\n  p B\n', 'faq', 'Faq')).toThrow('one root element')
  expect(() => add('img(src="/a.png")\n', 'faq', 'Faq')).toThrow('<img> root')
})

test('pages with no markup yet get a main root holding the section', () => {
  expect(add("import AtomicHero from '../components/AtomicHero.btsx'\n// AtomicHero\n", 'stats', 'Stats')).toBe(
    "import AtomicHero from '../components/AtomicHero.btsx'\nimport Stats from '../sections/Stats.btsx'\n// AtomicHero\n\nmain\n  Stats\n")
  expect(add('', 'hero', 'Hero')).toBe("import Hero from '../sections/Hero.btsx'\n\nmain\n  Hero\n")
  expect(add('style\n  p { color: red; }\n', 'faq', 'Faq')).toBe("import Faq from '../sections/Faq.btsx'\n\nmain\n  Faq\n\nstyle\n  p { color: red; }\n")
  // The new root takes later sections in story order.
  expect(add(add('', 'footer', 'Footer'), 'hero', 'Hero')).toBe("import Footer from '../sections/Footer.btsx'\nimport Hero from '../sections/Hero.btsx'\n\nmain\n  Hero\n  Footer\n")
  expect(() => add('', 'faq', 'Faq', 1)).toThrow('between 0 and 0')
})
