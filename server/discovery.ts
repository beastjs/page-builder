import ts from 'typescript'
import { resolve } from 'node:path'
import { compileBeastResult, type BeastDocument, type ElementNode } from 'beast-tsrx'
import type { CollectionConsumer, DetectedCollection, DetectedItem, ItemField, ItemType } from '../shared/types.js'

export interface DiscoverySource { file: string; source: string; page: boolean }
interface Input extends DiscoverySource { virtual: string; text: string; lines?: number[]; document?: BeastDocument }
interface Reference { collection: DetectedCollection; binding: string; input: Input }
const unbox = (node: ts.Expression): ts.Expression => ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unbox(node.expression) : node
const nameOf = (node: ts.PropertyName | undefined) => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined
const field = (node: ts.ObjectLiteralExpression, name: string) => node.properties.find((prop): prop is ts.PropertyAssignment => ts.isPropertyAssignment(prop) && nameOf(prop.name) === name)?.initializer
const textOf = (node: ts.Node | undefined) => node && (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : undefined
const attribute = (node: ElementNode, name: string) => node.attrs.find(attr => attr.kind === 'attribute' && attr.name === name)
const attrText = (node: ElementNode, name: string) => { const attr = attribute(node, name); return attr?.kind === 'attribute' && attr.value.type === 'string' ? attr.value.value : undefined }
const itemKind = (destination?: string): DetectedItem['kind'] => !destination ? 'unknown' : destination.startsWith('#') ? 'anchor' : /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination) ? 'external-link' : 'internal-link'
const inferExpression = (code: string) => /^['"`]/.test(code.trim()) ? 'string' : /^(?:true|false)$/.test(code.trim()) ? 'boolean' : /^-?\d+(?:\.\d+)?$/.test(code.trim()) ? 'number' : /=>|^function\b/.test(code.trim()) ? 'function' : 'unknown'

function virtualBeast(input: DiscoverySource, root: string): Input {
  const document = compileBeastResult(input.source, { filename: input.file }).ast
  const code: string[] = [], lines: number[] = []
  function add(text: string, line = 1): void { text.split('\n').forEach((text, index) => { code.push(text); lines.push(line + index) }) }
  for (const declaration of document.declarations) {
    if (declaration.kind === 'import') add(declaration.code, declaration.lineNo)
    else if (declaration.kind === 'module') add(declaration.code, declaration.codeStart.line)
  }
  const props = document.declarations.find(declaration => declaration.kind === 'props')
  add(`declare function __BeastComponent(${props?.kind === 'props' ? props.parameter.replace(/;$/, '') : 'props: unknown'}): unknown;\nexport default __BeastComponent;`)
  add('function __beastSetup() {')
  for (const declaration of document.declarations) if (declaration.kind === 'setup') add(declaration.code, declaration.codeStart.line)
  add('}')
  for (const declaration of document.declarations) if (declaration.kind === 'component') {
    add(`function ${declaration.name}(${declaration.props?.parameter.replace(/;$/, '') ?? ''}) {`, declaration.lineNo)
    for (const setup of declaration.setup) add(setup.code, setup.codeStart.line)
    add('}')
  }
  return { ...input, document, virtual: resolve(root, input.file + '.ts'), text: code.join('\n'), lines }
}

/** Inspect source and types without importing or executing the project's modules. */
export function discoverCollections(root: string, sources: DiscoverySource[]): DetectedCollection[] {
  const inputs: Input[] = sources.flatMap(source => {
    try { return [source.file.endsWith('.btsx') ? virtualBeast(source, root) : { ...source, virtual: resolve(root, source.file), text: source.source }] }
    catch { return [] }
  })
  const collections: DetectedCollection[] = []
  const references: Reference[] = []
  const byVirtual = new Map(inputs.map(input => [input.virtual, input]))
  let options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true }
  const configPath = ts.findConfigFile(root, ts.sys.fileExists)
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    if (!config.error) options = { ...options, ...ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(configPath, '..')).options, noEmit: true }
  }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host)
  host.readFile = file => byVirtual.get(resolve(file))?.text ?? read(file)
  host.fileExists = file => byVirtual.has(resolve(file)) || exists(file)
  const program = ts.createProgram(inputs.map(input => input.virtual), options, host)
  const checker = program.getTypeChecker()
  const lineOf = (input: Input, node: ts.Node) => {
    const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line
    return input.lines?.[line] ?? line + 1
  }
  function typeSchema(type: ts.Type, at: ts.Node, declared: boolean, variants = true): ItemType {
    const flags = ts.TypeFormatFlags.NoTruncation
    const typeName = (type: ts.Type) => checker.typeToString(type, at, flags).replace(/import\("[^"]+"\)\./g, '')
    const members = type.isUnion() ? type.types : [type]
    if (members.every(member => member.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Any | ts.TypeFlags.Unknown))) return { name: typeName(type), origin: declared && !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) ? 'declared' : 'inferred', fields: [] }
    const symbols = new Map(members.flatMap(member => member.getProperties().map(symbol => [symbol.name, symbol] as const)))
    const fields: ItemField[] = [...symbols].filter(([name]) => !name.startsWith('__@')).map(([name]) => {
      const properties = members.map(member => member.getProperty(name))
      const types = properties.flatMap(symbol => symbol ? [checker.getTypeOfSymbolAtLocation(symbol, at)] : [])
      const values = types.flatMap(type => (type.isUnion() ? type.types : [type]).flatMap<string | number | boolean>(value => value.isStringLiteral() || value.isNumberLiteral() ? [value.value] : value.flags & ts.TypeFlags.BooleanLiteral ? [checker.typeToString(value) === 'true'] : []))
      return { name, type: [...new Set(types.map(type => typeName(type)))].join(' | '), optional: properties.some(symbol => !symbol || !!(symbol.flags & ts.SymbolFlags.Optional)), ...(values.length ? { values: [...new Set(values)] } : {}) }
    })
    const known = !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) && fields.length > 0
    return { name: typeName(type), origin: declared && known ? 'declared' : 'inferred', fields, ...(variants && type.isUnion() && type.types.every(type => type.getProperties().length) ? { variants: type.types.map(member => typeSchema(member, at, declared, false)) } : {}) }
  }
  function elementType(array: ts.ArrayLiteralExpression): ts.Type | undefined {
    const contextual = checker.getContextualType(array)
    return contextual && checker.getIndexTypeOfType(contextual, ts.IndexKind.Number) || checker.getIndexTypeOfType(checker.getTypeAtLocation(array), ts.IndexKind.Number)
  }
  function declaredType(array: ts.ArrayLiteralExpression): boolean {
    let node: ts.Node = array
    while (!ts.isSourceFile(node)) {
      if (ts.isVariableDeclaration(node)) return !!node.type || !!(node.initializer && (ts.isSatisfiesExpression(node.initializer) || ts.isAsExpression(node.initializer) && node.initializer.type.getText() !== 'const'))
      node = node.parent
    }
    return false
  }
  function narrowedType(object: ts.ObjectLiteralExpression, context?: ts.Type): ts.Type {
    if (context?.isUnion()) {
      const candidates = context.types.filter(member => object.properties.every(prop => {
        if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteralLike(prop.initializer)) return true
        const symbol = member.getProperty(nameOf(prop.name) ?? '')
        if (!symbol) return false
        const type = checker.getTypeOfSymbolAtLocation(symbol, object)
        return !type.isStringLiteral() || type.value === prop.initializer.text
      }))
      if (candidates.length === 1) return candidates[0]!
    }
    return context && !context.isUnion() && context.getProperties().length ? context : checker.getTypeAtLocation(object)
  }

  // Markup reveals semantic roles and the data bindings that render its items.
  for (const input of inputs) if (input.document) {
    const file = program.getSourceFile(input.virtual)!
    const aliases = new Map<string, string>()
    for (const statement of file.statements) if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const binding of statement.importClause.namedBindings.elements) aliases.set(binding.name.text, (binding.propertyName ?? binding.name).text)
    }
    const tagOf = (node: ElementNode) => aliases.get(node.tag) ?? node.tag
    const containerKind = (node: ElementNode): DetectedCollection['kind'] | undefined => attrText(node, 'role') === 'tablist' || /^(?:Tabs?|TabGroup|Tabs?Root|Tabs?List|Tabs?\.List)$/.test(tagOf(node)) ? 'tabs' : node.tag === 'nav' || ['navigation', 'menu'].includes(attrText(node, 'role') ?? '') || /^(?:Nav|Navigation|NavigationMenu|NavMenu|SidebarNav|MenuList)$/.test(tagOf(node)) ? 'navigation' : undefined
    function schemaOfControl(node: ElementNode): ItemType {
      const symbol = checker.resolveName(node.tag, file, ts.SymbolFlags.Value, false)
      if (symbol) {
        const callable = checker.getTypeOfSymbolAtLocation(symbol, file).getCallSignatures()[0]
        const parameter = callable?.parameters[0]
        if (parameter) {
          const type = checker.getTypeOfSymbolAtLocation(parameter, file)
          if (type.getProperties().length) return typeSchema(type, file, true)
        }
      }
      const fields: ItemField[] = node.attrs.flatMap(attr => attr.kind !== 'attribute' ? [] : [{ name: attr.name, optional: false, type: attr.value.type === 'string' ? 'string' : attr.value.type === 'bool' ? 'boolean' : inferExpression(attr.value.code) }])
      return { name: tagOf(node), origin: 'inferred', fields }
    }
    function visit(value: unknown, active?: DetectedCollection, bindings = new Map<string, string>()): void {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(child => visit(child, active, bindings)); return }
      const node = value as Record<string, unknown>
      if (node.kind === 'element') {
        const element = value as ElementNode
        const kind = containerKind(element)
        if (kind) {
          const name = element.tag + (element.id ? '#' + element.id : '') + element.classes.map(name => '.' + name).join('')
          active = { id: `btsx:${input.file}:${element.lineNo}`, file: input.file, line: element.lineNo, name, kind, source: 'markup', itemType: { name: 'Unknown', origin: 'inferred', fields: [] }, items: [], editable: false, bindings: [], consumers: [], dataSources: [] }
          collections.push(active)
        }
        if (active) {
          for (const name of ['items', 'tabs', 'links']) {
            const attr = attribute(element, name)
            if (attr?.kind === 'attribute' && attr.value.type === 'expr') {
              const binding = attr.value.code.match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/)?.[0]
              if (binding) references.push({ collection: active, binding: bindings.get(binding.split('.')[0]!) ?? binding, input })
            }
          }
          const tag = tagOf(element)
          const isTab = active.kind === 'tabs' && ['button', 'a', 'Link'].includes(tag) || attrText(element, 'role') === 'tab' || /^(?:Tabs?Trigger|Tabs?\.Trigger)$/.test(tag)
          if (isTab || element.tag === 'a' || tag === 'Link' || /(?:Nav|Menu|Sidebar)Item$/.test(tag) || (['menuitem', 'button'].includes(attrText(element, 'role') ?? '') || element.tag === 'button') && active.kind === 'navigation') {
            const destination = attrText(element, 'href') ?? attrText(element, 'to')
            const label = labelOf(element) || attrText(element, 'aria-label') || attrText(element, 'label') || tag
            active.items.push({ label, component: tag, line: element.lineNo, kind: isTab ? 'tab' : destination ? itemKind(destination) : attribute(element, 'onClick') ? 'action' : 'unknown', itemType: schemaOfControl(element), ...(destination ? { destination } : {}), ...(attrText(element, 'value') ? { value: attrText(element, 'value') } : {}) })
          }
        }
      }
      if (node.kind === 'each') {
        const iterable = String(node.iterable)
        const rootBinding = iterable.match(/^[A-Za-z_$][\w$]*/)?.[0]
        if (rootBinding) {
          const binding = bindings.get(rootBinding) ?? iterable
          if (active) references.push({ collection: active, binding, input })
          bindings = new Map(bindings); bindings.set(String(node.itemName), binding)
        }
      }
      for (const key of ['children', 'branches', 'declarations', 'emptyChildren']) visit(node[key], active, bindings)
    }
    visit(input.document)
  }

  interface Definition { declaration: ts.VariableDeclaration; collection: DetectedCollection; input: Input }
  const definitions: Definition[] = []
  const usedDeclarations = new Set<ts.Node>()
  for (const reference of references) {
    const file = program.getSourceFile(reference.input.virtual)!
    let symbol = checker.resolveName(reference.binding.split('.')[0]!, file, ts.SymbolFlags.Value, false)
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    if (symbol?.valueDeclaration) usedDeclarations.add(symbol.valueDeclaration)
  }
  for (const input of inputs) {
    const file = program.getSourceFile(input.virtual)
    if (!file) continue
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const array = unbox(node.initializer)
        const name = node.name.text
        const used = usedDeclarations.has(node) || references.some(reference => reference.input.file === input.file && reference.binding.split('.')[0] === name)
        if (!ts.isArrayLiteralExpression(array)) {
          const type = checker.getIndexTypeOfType(checker.getTypeAtLocation(node), ts.IndexKind.Number)
          if (type && (used || /nav|menu|links|tabs|panels/i.test(name) || type.getProperty('href') || type.getProperty('to'))) {
            const collection: DetectedCollection = { id: `ts:${input.file}:${name}:${lineOf(input, node)}`, file: input.file, line: lineOf(input, node), name, kind: /tabs|panels/i.test(name) ? 'tabs' : 'navigation', source: 'data', itemType: typeSchema(type, node, !!node.type), items: [], editable: false, reason: 'Items are computed at runtime. The declared contract is available; values are not executed during scanning.', array: name, bindings: [], consumers: [], dataSources: [] }
            collections.push(collection); definitions.push({ declaration: node, collection, input })
          }
        }
        if (ts.isArrayLiteralExpression(array)) {
          const objects = array.elements.filter(ts.isObjectLiteralExpression)
          const arrayType = elementType(array)
          const links = !!(arrayType?.getProperty('href') || arrayType?.getProperty('to')) || objects.some(object => field(object, 'href') || field(object, 'to') || field(object, 'items'))
          const hint = /nav|menu|links|tabs|panels/i.test(name)
          if (links || hint || used) {
            const kind: DetectedCollection['kind'] = /tabs|panels/i.test(name) && !links ? 'tabs' : 'navigation'
            const groups = objects.filter(object => field(object, 'items'))
            const arrays: Array<{ array: ts.ArrayLiteralExpression; group?: string }> = groups.length ? groups.flatMap(group => {
              const items = field(group, 'items')
              const label = textOf(field(group, 'title')) ?? textOf(field(group, 'label'))
              return items && ts.isArrayLiteralExpression(unbox(items)) && label ? [{ array: unbox(items) as ts.ArrayLiteralExpression, group: label }] : []
            }) : [{ array }]
            for (const entry of arrays) {
              const declared = declaredType(entry.array)
              const context = elementType(entry.array)
              const itemType = context ? typeSchema(context, entry.array, declared) : { name: 'Unknown', origin: 'inferred' as const, fields: [] }
              const statement = node.parent.parent
              const exported = ts.isVariableStatement(statement) && !!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
              const linkShape = !!(context?.getProperty('href') || context?.getProperty('to')) || entry.array.elements.some(item => ts.isObjectLiteralExpression(item) && (field(item, 'href') || field(item, 'to')))
              const editable = kind === 'navigation' && linkShape && exported && !input.file.endsWith('.btsx') && entry.array.elements.every(ts.isObjectLiteralExpression) && (!groups.length || groups.length === array.elements.length)
              const id = `ts:${input.file}:${name}${entry.group ? ':' + entry.group : ''}${exported ? '' : ':' + lineOf(input, node)}`
              const collection: DetectedCollection = { id, file: input.file, line: lineOf(input, node), name: name + (entry.group ? ' / ' + entry.group : ''), kind, source: 'data', itemType, items: [], editable, ...(editable ? {} : { reason: kind === 'tabs' ? 'Tab item types and values are available for inspection.' : 'This data is local, computed, or contains spreads; inspect it before editing.' }), array: name, ...(entry.group ? { group: entry.group } : {}), bindings: [], consumers: [], dataSources: [] }
              for (const item of entry.array.elements) {
                if (ts.isObjectLiteralExpression(item)) {
                  const destination = textOf(field(item, 'href')) ?? textOf(field(item, 'to'))
                  const label = textOf(field(item, 'label')) ?? textOf(field(item, 'title')) ?? textOf(field(item, 'id')) ?? textOf(field(item, 'value')) ?? 'Unnamed item'
                  collection.items.push({ label, line: lineOf(input, item), kind: kind === 'tabs' ? 'tab' : destination ? itemKind(destination) : ['onClick', 'onSelect', 'action'].some(name => field(item, name)) ? 'action' : 'unknown', itemType: typeSchema(narrowedType(item, context), item, declared), ...(destination ? { destination } : {}), ...(textOf(field(item, 'value')) ?? textOf(field(item, 'id')) ? { value: textOf(field(item, 'value')) ?? textOf(field(item, 'id')) } : {}) })
                } else {
                  const primitive = textOf(item)
                  collection.items.push({ label: primitive ?? item.getText(), line: lineOf(input, item), kind: kind === 'tabs' ? 'tab' : 'unknown', itemType: typeSchema(checker.getTypeAtLocation(item), item, false), ...(primitive ? { value: primitive } : {}) })
                }
              }
              definitions.push({ declaration: node, collection, input }); collections.push(collection)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }

  for (const reference of references) {
    const file = program.getSourceFile(reference.input.virtual)!
    const rootName = reference.binding.split('.')[0]!
    let symbol = checker.resolveName(rootName, file, ts.SymbolFlags.Value, false)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) { try { symbol = checker.getAliasedSymbol(symbol) } catch { symbol = undefined } }
    const matches = definitions.filter(definition => symbol?.valueDeclaration === definition.declaration || definition.input.file === reference.input.file && definition.declaration.name.getText() === rootName)
    if (!reference.collection.bindings.includes(reference.binding)) reference.collection.bindings.push(reference.binding)
    if (!matches.length) {
      let at: ts.Node = file
      if (!symbol) {
        const local: ts.Identifier[] = []
        function visit(node: ts.Node): void {
          if ((ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) && node.name.text === rootName) local.push(node.name)
          ts.forEachChild(node, visit)
        }
        visit(file)
        at = local[0] ?? file
        symbol = checker.getSymbolAtLocation(at)
      }
      let type = symbol && checker.getTypeOfSymbolAtLocation(symbol, at)
      for (const part of reference.binding.split('.').slice(1)) {
        const property = type?.getProperty(part)
        type = property && checker.getTypeOfSymbolAtLocation(property, at)
      }
      const item = type && checker.getIndexTypeOfType(type, ts.IndexKind.Number)
      if (item) {
        reference.collection.itemType = typeSchema(item, at, true)
        reference.collection.reason = 'The item contract is resolved from the binding; values are supplied at runtime.'
      }
    }
    for (const { collection } of matches) {
      const consumer: CollectionConsumer = { file: reference.collection.file, line: reference.collection.line, name: reference.collection.name }
      if (!collection.consumers.some(item => item.file === consumer.file && item.line === consumer.line)) collection.consumers.push(consumer)
      if (!reference.collection.dataSources.includes(collection.id)) reference.collection.dataSources.push(collection.id)
      if (!reference.collection.bindings.includes(reference.binding)) reference.collection.bindings.push(reference.binding)
    }
  }
  for (const collection of collections.filter(collection => collection.source === 'data')) {
    if (collection.consumers.length && collection.consumers.every(consumer => collections.some(rendered => rendered.source === 'markup' && rendered.file === consumer.file && rendered.line === consumer.line && rendered.kind === 'tabs'))) {
      collection.kind = 'tabs'; collection.editable = false; collection.items.forEach(item => { item.kind = 'tab' })
      if (collection.reason === 'This data is local, computed, or contains spreads; inspect it before editing.') collection.reason = 'Tab item types and values are available for inspection.'
    }
  }
  for (const collection of collections.filter(collection => collection.source === 'markup')) {
    const data = collections.filter(data => collection.dataSources.includes(data.id))
    if (data.length) {
      collection.items = data.flatMap(data => data.items.map(item => collection.kind === 'tabs' ? { ...item, kind: 'tab' as const } : item))
      collection.itemType = data.length === 1 ? data[0]!.itemType : { name: [...new Set(data.map(data => data.itemType.name))].join(' | '), origin: data.every(data => data.itemType.origin === 'declared') ? 'declared' : 'inferred', fields: [], variants: data.map(data => data.itemType) }
      collection.reason = `Renders shared data in ${[...new Set(data.map(data => data.file))].join(', ')}.`
    } else {
      const types = [...new Map(collection.items.map(item => [JSON.stringify(item.itemType), item.itemType])).values()]
      if (!collection.reason) collection.itemType = types.length > 1 ? { name: types.map(type => type.name).join(' | '), origin: types.every(type => type.origin === 'declared') ? 'declared' : 'inferred', fields: [], variants: types } : types[0] ?? collection.itemType
      // Only simple, static navs are supported by the page writer.
      const targetNode = findElement(inputDocument(collection.file), collection.line)
      collection.editable = collection.kind === 'navigation' && !sources.find(input => input.file === collection.file)?.page && !!targetNode && targetNode.tag === 'nav' && targetNode.children.every(child => child.kind === 'element' && ['a', 'Link'].includes(child.tag))
      if (!collection.editable && !collection.reason) collection.reason = collection.kind === 'tabs' ? 'Tab controls are detected for inspection; they are not page navigation targets.' : 'This menu uses a custom layout or belongs to a page.'
    }
  }
  function inputDocument(file: string): BeastDocument | undefined { return inputs.find(input => input.file === file)?.document }
  return collections.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name))
}

function labelOf(node: ElementNode): string {
  return [(node.inlineSpans ?? []).map(span => span.type === 'literal' ? span.text : `#{${span.code}}`).join(''), ...node.children.flatMap(child => child.kind === 'element' ? [labelOf(child)] : child.kind === 'text' ? [child.spans.map(span => span.type === 'literal' ? span.text : `#{${span.code}}`).join('')] : [])].filter(Boolean).join(' ')
}

function findElement(value: unknown, line: number): ElementNode | undefined {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) return value.map(child => findElement(child, line)).find(Boolean)
  const node = value as Record<string, unknown>
  if (node.kind === 'element' && node.lineNo === line) return value as ElementNode
  for (const key of ['children', 'branches', 'declarations']) { const found = findElement(node[key], line); if (found) return found }
}
