import ts from 'typescript'
import { dirname, relative, resolve } from 'node:path'
import { compileBeastResult } from 'beast-tsrx'
import type { PageRoute, ProjectFile, TabComponent, TabsDraft } from '../shared/types.js'
import { parseTypeScript } from './integration.js'
import { BuilderError } from './project.js'

const property = (node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  const prop = node.properties.find(prop => (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) && prop.name.text === name)
  return prop && (ts.isPropertyAssignment(prop) ? prop.initializer : ts.isShorthandPropertyAssignment(prop) ? prop.name : undefined)
}

/** Resolve registered page files and parent paths without executing the router. */
export function discoverPageRoutes(source: string, file: string, files: ProjectFile[]): PageRoute[] {
  const ast = parseTypeScript(source, file)
  const imports = new Map<string, string>()
  const factories = new Map<string, string>()
  for (const statement of ast.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    if (statement.importClause?.name) imports.set(statement.importClause.name.text, statement.moduleSpecifier.text)
    if (statement.moduleSpecifier.text === '@octanejs/tanstack-router' && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const binding of statement.importClause.namedBindings.elements) factories.set(binding.name.text, (binding.propertyName ?? binding.name).text)
    }
  }
  const routes = new Map<string, { path: string; parent?: string; component?: ts.Expression }>()
  const aliases = new Map<string, string>()
  const declarations = new Map<string, ts.Expression>()
  const trees: ts.Expression[] = []
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue
    const call = declaration.initializer
    declarations.set(declaration.name.text, call)
    if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) && call.expression.name.text === 'addChildren') {
      aliases.set(declaration.name.text, call.expression.expression.text); continue
    }
    if (!ts.isIdentifier(call.expression)) continue
    const factory = factories.get(call.expression.text)
    const options = call.arguments[0]
    if (factory === 'createRouter' && options && ts.isObjectLiteralExpression(options)) {
      const tree = property(options, 'routeTree')
      if (tree) trees.push(tree)
    }
    if (!['createRoute', 'createRootRoute'].includes(factory ?? '') || !options || !ts.isObjectLiteralExpression(options)) continue
    const path = property(options, 'path')
    if (factory === 'createRoute' && path && !ts.isStringLiteral(path)) continue
    const parent = property(options, 'getParentRoute')
    routes.set(declaration.name.text, { path: path && ts.isStringLiteral(path) ? path.text : '', parent: parent && ts.isArrowFunction(parent) && ts.isIdentifier(parent.body) ? parent.body.text : undefined, component: property(options, 'component') })
  }
  const registered = new Set<string>()
  const visited = new Set<string>()
  function register(node: ts.Expression): void {
    if (ts.isIdentifier(node)) {
      registered.add(node.text)
      if (visited.has(node.text)) return
      visited.add(node.text)
      const declaration = declarations.get(node.text)
      if (declaration) register(declaration)
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addChildren') {
      register(node.expression.expression)
      const children = node.arguments[0]
      if (children && ts.isArrayLiteralExpression(children)) for (const child of children.elements) if (!ts.isSpreadElement(child)) register(child)
    }
  }
  trees.forEach(register)
  function routePath(name: string, seen = new Set<string>()): string | undefined {
    if (seen.has(name)) return
    seen.add(name)
    if (aliases.has(name)) return routePath(aliases.get(name)!, seen)
    const route = routes.get(name)
    if (!route) return
    const parent = route.parent ? routePath(route.parent, seen) : ''
    if (parent === undefined) return
    return '/' + [parent, route.path].map(part => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')
  }
  function componentPath(component: ts.Expression | undefined): string | undefined {
    if (!component) return
    if (ts.isIdentifier(component)) return imports.get(component.text)
    const paths: string[] = []
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) paths.push(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(component)
    return paths.length === 1 ? paths[0] : undefined
  }
  const result: PageRoute[] = []
  for (const [name, route] of routes) {
    if (!registered.has(name)) continue
    const path = routePath(name)
    const module = componentPath(route.component)
    if (!path || /[$*?#]/.test(path) || !module?.startsWith('.')) continue
    const pageFile = relative('.', resolve(dirname(file), module)).replaceAll('\\', '/')
    const page = files.find(page => page.kind === 'page' && (page.path === pageFile || page.path.replace(/\.btsx$/, '') === pageFile))
    if (page && !result.some(item => item.routePath === path && item.file === page.path)) result.push({ file: page.path, name: page.name, routePath: path })
  }
  return result.sort((a, b) => a.routePath.localeCompare(b.routePath))
}

export function addTabs(source: string, component: TabComponent, draft: TabsDraft): string {
  if (component.reason) throw new BuilderError(component.reason, 422)
  if (!Array.isArray(draft.items) || !draft.items.length || draft.items.length > 50) throw new BuilderError('Add between 1 and 50 tabs.')
  const fields = component.itemType.fields
  for (const [index, item] of draft.items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BuilderError(`Tab ${index + 1} must be an object.`)
    if (Object.keys(item).some(name => !fields.some(field => field.name === name))) throw new BuilderError(`Tab ${index + 1} contains an unknown field.`)
    for (const field of fields) {
      const value = item[field.name]
      if (value === undefined && field.optional) continue
      if (typeof value !== field.scalar || typeof value === 'string' && (!value.trim() || value.length > 1000) || typeof value === 'number' && !Number.isFinite(value) || field.values?.length && !field.values.includes(value!)) throw new BuilderError(`Tab ${index + 1}: ${field.name} must match ${field.type}.`)
    }
  }
  const key = fields.find(field => field.name === 'id') ?? fields.find(field => field.name === 'value')
  if (key && new Set(draft.items.map(item => item[key.name])).size !== draft.items.length) throw new BuilderError(`Each tab needs a unique ${key.name}.`)
  if (component.activeProp && (!key || !draft.items.some(item => item[key.name] === draft.active))) throw new BuilderError('Choose an active tab from the tab items.')
  if (draft.label !== undefined && (typeof draft.label !== 'string' || draft.label.length > 100)) throw new BuilderError('The tabs label must be at most 100 characters.')
  const ast = compileBeastResult(source, { filename: draft.page }).ast
  let modulePath = relative(dirname(draft.page), component.file).replaceAll('\\', '/')
  if (!modulePath.startsWith('.')) modulePath = './' + modulePath
  let name: string | undefined
  for (const declaration of ast.declarations) if (declaration.kind === 'import') {
    const statement = parseTypeScript(declaration.code, draft.page).statements[0]
    if (statement && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause?.name && !statement.importClause.isTypeOnly && resolve(dirname(draft.page), statement.moduleSpecifier.text) === resolve(component.file)) name = statement.importClause.name.text
  }
  const needsImport = !name
  if (!name) {
    name = 'PageTabs'
    for (let suffix = 2; new RegExp(`\\b${name}\\b`).test(source); suffix++) name = `PageTabs${suffix}`
  }
  const attrs = [`${component.itemProp}={${JSON.stringify(draft.items)}}`, ...(component.activeProp ? [`${component.activeProp}={${JSON.stringify(draft.active)}}`] : []), ...(component.labelProp && draft.label ? [`${component.labelProp}=${JSON.stringify(draft.label)}`] : [])]
  const root = ast.children.find(node => node.kind !== 'style')
  const lines = source.split(/\r?\n/)
  // Place the tabs first in an existing native container, or before a component/branch root.
  const container = root?.kind === 'element' && !root.isComponent && !['input', 'img', 'br', 'hr', 'meta', 'link'].includes(root.tag) ? root : undefined
  const at = container ? container.span.end.line : root ? root.span.start.line - 1 : lines.length
  const indent = container ? ' '.repeat(container.span.start.column - 1 + 2) : ''
  lines.splice(at, 0, `${indent}${name}(${attrs.join(' ')})`)
  if (needsImport) lines.unshift(`import ${name} from ${JSON.stringify(modulePath)}`)
  return lines.join(source.includes('\r\n') ? '\r\n' : '\n').trimEnd() + (source.includes('\r\n') ? '\r\n' : '\n')
}
