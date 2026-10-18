import ts from 'typescript'
import type { BeastDocument, ElementNode } from 'beast-tsrx'
import type { DetectedSection } from '../shared/types.js'

/** Read actual element IDs, excluding selectors in styles, links, and comments. */
export function discoverSections(document: BeastDocument, file: string): DetectedSection[] {
  const sections: DetectedSection[] = []
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const record = value as Record<string, unknown>
    if (record.kind === 'element') {
      const node = value as ElementNode
      let elementId = node.id
      const attr = node.attrs.find(attr => attr.kind === 'attribute' && attr.name === 'id')
      if (attr?.kind === 'attribute') {
        if (attr.value.type === 'string') elementId = attr.value.value
        else if (attr.value.type === 'expr') {
          const expression = ts.createSourceFile('id.ts', `(${attr.value.code})`, ts.ScriptTarget.Latest).statements[0]
          if (expression && ts.isExpressionStatement(expression) && ts.isParenthesizedExpression(expression.expression) && ts.isStringLiteralLike(expression.expression.expression)) elementId = expression.expression.expression.text
        }
      }
      if (elementId) sections.push({ id: `${file}:${node.lineNo}:${elementId}`, elementId, file, line: node.lineNo })
    }
    for (const [key, child] of Object.entries(record)) if (!['span', 'attrs', 'inlineSpans'].includes(key)) visit(child)
  }
  visit(document)
  return sections
}
