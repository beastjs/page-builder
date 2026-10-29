import ts from 'typescript'
import { posix } from 'node:path'
import type { BeastDocument, ElementNode } from 'beast-tsrx'
import type { DetectedSection, SectionUse } from '../shared/types.js'
import { sectionKindOf } from '../shared/sections.js'

/** Visit every element, skipping spans and attributes so selectors in styles, links, and comments never match. */
function visitElements(document: BeastDocument, callback: (node: ElementNode) => void): void {
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const record = value as Record<string, unknown>
    if (record.kind === 'element') callback(value as ElementNode)
    for (const [key, child] of Object.entries(record)) if (!['span', 'attrs', 'inlineSpans'].includes(key)) visit(child)
  }
  visit(document)
}

/** A literal attribute value: a string, or an expression that is only a string literal. */
export function literalAttr(node: ElementNode, name: string): string | undefined {
  const attr = node.attrs.find(attr => attr.kind === 'attribute' && attr.name === name)
  if (attr?.kind !== 'attribute') return undefined
  if (attr.value.type === 'string') return attr.value.value
  if (attr.value.type === 'expr') {
    const expression = ts.createSourceFile('attr.ts', `(${attr.value.code})`, ts.ScriptTarget.Latest).statements[0]
    if (expression && ts.isExpressionStatement(expression) && ts.isParenthesizedExpression(expression.expression) && ts.isStringLiteralLike(expression.expression.expression)) return expression.expression.expression.text
  }
  return undefined
}

/** Read actual element IDs and studio `data-section` roots, excluding computed values. */
export function discoverSections(document: BeastDocument, file: string): DetectedSection[] {
  const sections: DetectedSection[] = []
  visitElements(document, node => {
    const elementId = literalAttr(node, 'id') ?? node.id ?? undefined
    const dataSection = literalAttr(node, 'data-section')
    const name = elementId ?? dataSection
    if (!name) return
    const kind = (dataSection && sectionKindOf(dataSection)) || sectionKindOf(name)
    sections.push({
      id: `${file}:${node.lineNo}:${name}`, elementId: name, file, line: node.lineNo,
      ...(elementId ? {} : { marker: 'data-section' as const }), ...(kind ? { kind } : {}),
    })
  })
  return sections
}

/** Every name a file's imports bind, so new imports never shadow one. */
export function importedNames(document: BeastDocument): Set<string> {
  const names = new Set<string>()
  for (const statement of importStatements(document)) {
    const clause = statement.importClause
    if (clause?.name) names.add(clause.name.text)
    const bindings = clause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text)
    else if (bindings) for (const element of bindings.elements) names.add(element.name.text)
  }
  return names
}

function importStatements(document: BeastDocument): ts.ImportDeclaration[] {
  return document.declarations.flatMap(declaration => declaration.kind !== 'import' ? []
    : ts.createSourceFile('import.ts', declaration.code, ts.ScriptTarget.Latest).statements.filter(ts.isImportDeclaration))
}

/** Local names of relative, default, non-type `.btsx` imports, mapped to the imported file's project-relative path. */
export function componentImports(document: BeastDocument, file: string): Map<string, string> {
  const imports = new Map<string, string>()
  for (const statement of importStatements(document)) {
    if (statement.importClause?.isTypeOnly || !statement.importClause?.name) continue
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
    if (!specifier.startsWith('.') || !specifier.endsWith('.btsx')) continue
    imports.set(statement.importClause.name.text, posix.join(posix.dirname(file), specifier))
  }
  return imports
}

/**
 * Where this file renders components default-imported from other project `.btsx` files, keyed by the imported
 * file's project-relative path. Section components are linked to their pages through these.
 */
export function discoverComponentUses(document: BeastDocument, file: string): Map<string, SectionUse[]> {
  const imports = componentImports(document, file)
  const uses = new Map<string, SectionUse[]>()
  if (!imports.size) return uses
  visitElements(document, node => {
    const target = node.isComponent ? imports.get(node.tag) : undefined
    if (target) uses.set(target, [...(uses.get(target) ?? []), { file, line: node.lineNo }])
  })
  return uses
}
