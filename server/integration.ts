import ts from 'typescript'
import { compileBeastResult, type ElementNode } from 'beast-tsrx'
import { dirname, relative } from 'node:path'
import type { BeastPageBuilderOptions, NavigationTarget } from '../shared/types.js'
import { BuilderError } from './project.js'

type Edit = { start: number; end: number; text: string }
const apply = (source: string, edits: Edit[]) => edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source)
const quote = (value: string) => JSON.stringify(value)
const newline = (source: string) => source.includes('\r\n') ? '\r\n' : '\n'
const property = (node: ts.ObjectLiteralExpression, name: string) => node.properties.find((prop): prop is ts.PropertyAssignment => ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) && prop.name.text === name)?.initializer
const literal = (node: ts.Node | undefined) => node && ts.isStringLiteral(node) ? node.text : undefined
const unwrap = (node: ts.Expression): ts.Expression => ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node

export function parseTypeScript(source: string, file: string): ts.SourceFile {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const diagnostics = (ast as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics.length) throw new BuilderError(`${file}: ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, '\n')}`, 422)
  return ast
}

function appendArray(source: string, array: ts.ArrayLiteralExpression, item: string): Edit[] {
  const close = array.end - 1
  const lineStart = source.lastIndexOf('\n', close - 1) + 1
  const closingIndent = source.slice(lineStart, close)
  const multiline = array.getText().includes('\n') && /^\s*$/.test(closingIndent)
  const edits: Edit[] = []
  const last = array.elements.at(-1)
  if (last && last.end === close && !multiline) return [{ start: close, end: close, text: `, ${item}` }]
  if (last && !array.elements.hasTrailingComma) edits.push({ start: last.end, end: last.end, text: ',' })
  edits.push({ start: multiline ? lineStart : close, end: multiline ? lineStart : close, text: multiline ? `${closingIndent}  ${item},${newline(source)}` : `${last ? ' ' : ''}${item}${array.elements.hasTrailingComma ? ',' : ''}` })
  return edits
}

export function registerRoute(source: string, file: string, pageFile: string, name: string, path: string): string {
  const ast = parseTypeScript(source, file)
  const routerImport = ast.statements.find((statement): statement is ts.ImportDeclaration => ts.isImportDeclaration(statement) && literal(statement.moduleSpecifier) === '@octanejs/tanstack-router')
  const bindings = routerImport?.importClause?.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) throw new BuilderError(`${file} must import createRoute from @octanejs/tanstack-router.`, 422)
  const binding = (name: string) => bindings.elements.find(item => (item.propertyName ?? item.name).text === name && !item.isTypeOnly)?.name.text
  const createRoute = binding('createRoute')
  if (!createRoute) throw new BuilderError(`${file} must import createRoute.`, 422)
  const trees: { statement: ts.VariableStatement; call: ts.CallExpression; array: ts.ArrayLiteralExpression; root: string }[] = []
  const components: string[] = []
  const identifiers = new Set<string>()
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === createRoute) {
      const options = node.arguments[0]
      if (!options || !ts.isObjectLiteralExpression(options)) throw new BuilderError('Computed route options are unsupported. Use a literal createRoute object.', 422)
      const routePath = property(options, 'path')
      if (routePath && !literal(routePath)) throw new BuilderError('Computed route paths cannot be checked for conflicts.', 422)
      const existing = literal(routePath)
      if (existing && ('/' + existing.replace(/^\/+|\/+$/g, '')) === path) throw new BuilderError(`Route ${path} already exists.`, 409)
      const component = property(options, 'component')
      if (component && ts.isCallExpression(component) && ts.isIdentifier(component.expression)) components.push(component.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer
      if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'addChildren' || !ts.isIdentifier(call.expression.expression)) continue
      const array = call.arguments[0]
      if (!array || !ts.isArrayLiteralExpression(array) || array.elements.some(ts.isSpreadElement)) throw new BuilderError('The root route must use addChildren with a literal array of routes.', 422)
      trees.push({ statement, call, array, root: call.expression.expression.text })
    }
  }
  if (trees.length !== 1) throw new BuilderError(`${file} needs one rootRoute.addChildren([...]) route tree.`, 422)
  const tree = trees[0]!
  let lazy = binding('lazyRouteComponent')
  // Preserve the common Beast lazyPage wrapper, which normalizes preload typing.
  if (components.includes('lazyPage') && ast.statements.some(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'lazyPage')) lazy = 'lazyPage'
  const edits: Edit[] = []
  if (!lazy) {
    lazy = 'lazyRouteComponent'
    if (identifiers.has(lazy)) throw new BuilderError('lazyRouteComponent conflicts with an existing binding.', 422)
    const last = bindings.elements.at(-1)
    const at = last && !bindings.elements.hasTrailingComma ? last.end : bindings.end - 1
    edits.push({ start: at, end: at, text: last && !bindings.elements.hasTrailingComma ? ', lazyRouteComponent' : ` lazyRouteComponent${last ? ',' : ''} ` })
  }
  let routeName = name[0]!.toLowerCase() + name.slice(1) + 'Route'
  const baseName = routeName
  for (let suffix = 2; identifiers.has(routeName); suffix++) routeName = baseName + suffix
  let modulePath = relative(dirname(file), pageFile).replaceAll('\\', '/')
  if (!modulePath.startsWith('.')) modulePath = './' + modulePath
  const declaration = `const ${routeName} = ${createRoute}({ getParentRoute: () => ${tree.root}, path: ${quote(path)}, component: ${lazy}(() => import(${quote(modulePath)})) })${newline(source)}${newline(source)}`
  edits.push({ start: tree.statement.getStart(ast), end: tree.statement.getStart(ast), text: declaration }, ...appendArray(source, tree.array, routeName))
  const result = apply(source, edits)
  parseTypeScript(result, file)
  return result
}

interface InlineTarget extends NavigationTarget { node: ElementNode }
function inlineTargets(source: string, file: string): InlineTarget[] {
  const ast = compileBeastResult(source, { filename: file }).ast
  const targets: InlineTarget[] = []
  function walk(value: unknown): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    const object = value as Record<string, unknown>
    if (object.kind === 'element' && object.tag === 'nav') {
      const node = value as ElementNode
      // Dynamic loops/branches belong to their shared menu data, not static markup.
      if (!node.attrs.some(attr => attr.kind === 'attribute' && attr.name === 'role' && attr.value.type === 'string' && attr.value.value === 'tablist') && node.children.every(child => child.kind === 'element' && ['a', 'Link'].includes(child.tag))) {
        const selector = 'nav' + (node.id ? `#${node.id}` : '') + node.classes.map(name => `.${name}`).join('')
        targets.push({ id: `btsx:${file}:${node.lineNo}`, file, label: `${file} · ${selector}`, node })
      }
    }
    for (const [key, child] of Object.entries(object)) if (['children', 'branches', 'declarations'].includes(key)) walk(child)
  }
  walk(ast)
  return targets
}

interface ArrayTarget extends Omit<NavigationTarget, 'array'> { array: ts.ArrayLiteralExpression }
function arrayTargets(source: string, file: string, config?: BeastPageBuilderOptions['navigation']): ArrayTarget[] {
  const ast = parseTypeScript(source, file)
  const targets: ArrayTarget[] = []
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
    if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const name = declaration.name.text
      if (config?.array ? name !== config.array : !/^(navItems|navGroups|navigation|links)$/.test(name)) continue
      const array = unwrap(declaration.initializer)
      if (!ts.isArrayLiteralExpression(array) || array.elements.some(ts.isSpreadElement)) continue
      const objects = array.elements.filter(ts.isObjectLiteralExpression)
      const groups = objects.filter(object => property(object, 'items'))
      if (groups.length) {
        for (const group of groups) {
          const title = literal(property(group, 'title')) ?? literal(property(group, 'label'))
          const items = property(group, 'items')
          if (!title || !items || !ts.isArrayLiteralExpression(unwrap(items)) || (unwrap(items) as ts.ArrayLiteralExpression).elements.some(ts.isSpreadElement) || (config?.group && config.group !== title)) continue
          targets.push({ id: `ts:${file}:${name}:${title}`, file, label: `${file} · ${name} / ${title}`, array: unwrap(items) as ts.ArrayLiteralExpression })
        }
      } else if (!config?.group && objects.length === array.elements.length) targets.push({ id: `ts:${file}:${name}`, file, label: `${file} · ${name}`, array })
    }
  }
  return targets
}

export function discoverNavigation(source: string, file: string, config?: BeastPageBuilderOptions['navigation']): NavigationTarget[] {
  if (file.endsWith('.btsx')) return inlineTargets(source, file).filter(target => !config?.selector || target.label.endsWith(` · ${config.selector}`)).map(({ node, ...target }) => target)
  return arrayTargets(source, file, config).map(({ array, ...target }) => target)
}

export function addNavigation(source: string, target: NavigationTarget, path: string, label: string, config?: BeastPageBuilderOptions['navigation']): string {
  if (target.file.endsWith('.btsx')) {
    const nav = inlineTargets(source, target.file).find(item => item.id === target.id)?.node
    if (!nav) throw new BuilderError('The selected navigation changed. Rescan the project.', 409)
    const links = nav.children as ElementNode[]
    if (links.some(link => link.attrs.some(attr => attr.kind === 'attribute' && ['href', 'to'].includes(attr.name) && attr.value.type === 'string' && attr.value.value.replace(/\/$/, '') === path))) throw new BuilderError(`Navigation already links to ${path}.`, 409)
    const link = links.find(link => link.tag === 'Link')
    const indent = ' '.repeat(nav.span.start.column - 1 + 2)
    // Only carry neutral static classes, not selected/active state or event handlers.
    const classes = (link?.classes ?? links[0]?.classes ?? []).filter(name => !/active|selected/.test(name))
    const classAttr = link?.attrs.find(attr => attr.kind === 'attribute' && attr.name === 'className' && attr.value.type === 'string')
    const classValue = classAttr?.kind === 'attribute' && classAttr.value.type === 'string' ? ` className=${quote(classAttr.value.value)}` : ''
    let lastLine = nav.span.end.line
    function end(node: ElementNode): void { lastLine = Math.max(lastLine, node.span.end.line); for (const child of node.children) if (child.kind === 'element') end(child); else lastLine = Math.max(lastLine, child.span.end.line) }
    links.forEach(end)
    const lines = source.split(/\r?\n/)
    // String interpolation makes labels literal, even if they contain BTSX syntax.
    lines.splice(lastLine, 0, `${indent}${link ? 'Link' : 'a'}${classes.map(name => '.' + name).join('')}(${link ? 'to' : 'href'}=${quote(path)}${classValue}) #{${quote(label)}}`)
    return lines.join(newline(source))
  }
  const array = arrayTargets(source, target.file, { ...config, file: target.file, array: target.array ?? config?.array, group: target.group ?? config?.group }).find(item => item.id === target.id)?.array
  if (!array) throw new BuilderError('The selected navigation changed. Rescan the project.', 409)
  const objects = array.elements.filter(ts.isObjectLiteralExpression)
  if (objects.some(object => [property(object, 'href'), property(object, 'to')].some(value => literal(value)?.replace(/\/$/, '') === path))) throw new BuilderError(`Navigation already links to ${path}.`, 409)
  const template = objects.find(object => property(object, 'href') || property(object, 'to')) ?? objects[0]
  const contract = target.itemType?.variants?.find(variant => variant.fields.some(field => ['href', 'to'].includes(field.name))) ?? target.itemType
  const defaults = config?.itemDefaults ?? {}
  const fields: Record<string, string | number | boolean | string[]> = { ...defaults }
  let keys = template ? template.properties.map(prop => prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : '') : ['href', 'label']
  if (contract?.fields.length) keys = [...new Set([...(template ? keys : []), ...contract.fields.filter(field => !field.optional).map(field => field.name)])]
  if (keys.includes('') || template?.properties.some(prop => !ts.isPropertyAssignment(prop))) throw new BuilderError('Menu items must be literal objects with named fields.', 422)
  for (const key of keys) {
    if (key in defaults) continue
    if (key === 'href' || key === 'to') fields[key] = path
    else if (['label', 'title', 'short', 'description'].includes(key)) fields[key] = label
    else if (key === 'value' || key === 'id') fields[key] = path.slice(1)
    else if (key === 'tags') fields[key] = [label.toLowerCase()]
    else if (key === 'disabled') fields[key] = false
    else if (['kind', 'type'].includes(key) && template && literal(property(template, key))) fields[key] = literal(property(template, key))!
    else if (key === 'icon' && template && literal(property(template, key))) fields[key] = literal(property(template, key))!
    else throw new BuilderError(`Set navigation.itemDefaults.${key} for this menu.`, 422)
  }
  // The generated item always points to the new page, even if defaults contain a URL/label.
  fields[keys.includes('to') ? 'to' : 'href'] = path
  fields[keys.includes('title') && !keys.includes('label') ? 'title' : 'label'] = label
  for (const fieldContract of contract?.origin === 'declared' ? contract.fields : []) {
    if (!(fieldContract.name in fields)) continue
    const value = fields[fieldContract.name]!
    const type = fieldContract.type.replace(/ \| undefined/g, '')
    if (fieldContract.values?.length && !fieldContract.values.includes(value as string | number | boolean) && !/(?:^| \| )(?:string|number|boolean)(?:$| \| )/.test(type)) throw new BuilderError(`navigation.itemDefaults.${fieldContract.name} must match ${fieldContract.type}.`, 422)
    if ((type === 'string' && typeof value !== 'string') || (type === 'number' && typeof value !== 'number') || (type === 'boolean' && typeof value !== 'boolean') || (type === 'string[]' && (!Array.isArray(value) || value.some(item => typeof item !== 'string')))) throw new BuilderError(`navigation.itemDefaults.${fieldContract.name} must be ${type}.`, 422)
  }
  const item = `{ ${Object.entries(fields).map(([key, value]) => `${quote(key)}: ${JSON.stringify(value)}`).join(', ')} }`
  const result = apply(source, appendArray(source, array, item))
  parseTypeScript(result, target.file)
  return result
}
