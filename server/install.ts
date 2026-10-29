import type { BeastDocument, BeastNode, ElementNode } from 'beast-tsrx'
import type { SectionKindId } from '../shared/catalog/types.js'
import { kindOrder, sectionKind } from '../shared/catalog/kinds.js'
import { BuilderError } from './errors.js'

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

export interface SectionPlacement {
  /** Component name to import and render. */
  name: string
  /** Import specifier, relative to the page. */
  specifier: string
  kind: SectionKindId
  /** Position among the root's children; defaults to the kind's place in the page's story. */
  index?: number
}

/** The page's single root element, which installed sections become children of; null for a page with no markup yet. */
export function pageRoot(document: BeastDocument): ElementNode | null {
  const roots = document.children.filter(node => node.kind !== 'style')
  if (!roots.length) return null
  if (roots.length > 1 || roots[0]!.kind !== 'element') throw new BuilderError('Wrap the page in one root element before adding sections.', 422)
  const root = roots[0] as ElementNode
  if (VOID.has(root.tag)) throw new BuilderError(`A <${root.tag}> root cannot contain sections.`, 422)
  return root
}

/**
 * Adds `import <name> from '<specifier>'` after the page's imports and renders `<name>` as a child of the root.
 *
 * Without an index the section goes before the first child of a later kind, so a footer lands last and a topbar
 * first. Spans cover only a node's head, so a subtree is taken to end where the next top-level node begins.
 */
export function addSectionUse(source: string, document: BeastDocument, placement: SectionPlacement, kindOf: (node: BeastNode) => SectionKindId | undefined): string {
  const root = pageRoot(document)
  const lines = source.split('\n')
  if (!root) {
    // A page with no markup yet gets a root, so this and later sections have somewhere to go.
    if (placement.index !== undefined && placement.index !== 0) throw new BuilderError('Choose a position between 0 and 0.')
    const style = document.children.find(node => node.kind === 'style')
    if (style) lines.splice(style.lineNo - 1, 0, 'main', `  ${placement.name}`, '')
    else {
      let at = lines.length
      while (at > 0 && !lines[at - 1]!.trim()) at--
      lines.splice(at, lines.length - at, ...(at ? [''] : []), 'main', `  ${placement.name}`, '')
    }
    return addImport(lines, document, placement)
  }
  const children = root.children
  const indent = children.length ? lines[children[0]!.lineNo - 1]!.match(/^\s*/)![0] : lines[root.lineNo - 1]!.match(/^\s*/)![0] + '  '

  let before: BeastNode | undefined
  if (placement.index !== undefined) {
    if (!Number.isInteger(placement.index) || placement.index < 0 || placement.index > children.length) throw new BuilderError(`Choose a position between 0 and ${children.length}.`)
    before = children[placement.index]
  } else {
    const order = kindOrder(placement.kind)
    const kinds = children.map(kindOf)
    before = children.find((_, index) => kinds[index] !== undefined && kindOrder(kinds[index]!) > order)
    if (!before && kinds.every(kind => kind === undefined) && sectionKind(placement.kind).stage === 'navigate') before = children[0]
  }

  let at: number
  if (before) at = before.lineNo - 1
  else {
    const next = document.children.find(node => node.lineNo > root.lineNo)
    at = next ? next.lineNo - 1 : lines.length
    while (at > root.lineNo && !lines[at - 1]!.trim()) at--
  }
  lines.splice(at, 0, `${indent}${placement.name}`)
  return addImport(lines, document, placement)
}

/** Adds the section's import after the page's last import, or at the top with a blank line after it. */
function addImport(lines: string[], document: BeastDocument, placement: SectionPlacement): string {
  const imports = document.declarations.filter(declaration => declaration.kind === 'import')
  const statement = `import ${placement.name} from '${placement.specifier}'`
  if (imports.length) lines.splice(Math.max(...imports.map(declaration => declaration.span.end.line)), 0, statement)
  else lines.splice(0, 0, statement, '')
  return lines.join('\n')
}
