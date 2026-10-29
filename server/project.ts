import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, writeFile, unlink, link, rename, stat, chmod } from 'node:fs/promises'
import { basename, dirname, isAbsolute, posix as posixPath, relative, resolve, sep } from 'node:path'
import { compileBeastResult, componentNameFromPath, type BeastNode } from 'beast-tsrx'
import { createOctaneCompiler } from 'octane/compiler/bundler'
import type { BeastPageBuilderOptions, NavigationTarget, PageDraft, PagePreview, PlannedFile, ProjectFile, ProjectScan, SectionInstallDraft, SectionInstallPreview, SectionUse, TabsDraft, TabsPreview } from '../shared/types.js'
import { addNavigation, discoverNavigation, registerRoute } from './integration.js'
import { discoverProjectItems, type DiscoverySource } from './discovery.js'
import { addTabs, discoverPageRoutes, discoverTabInstances } from './tabs.js'
import { componentImports, discoverComponentUses, discoverSections, importedNames, literalAttr } from './sections.js'
import { addSectionUse } from './install.js'
import { addStudioStyles, tailwindSetup, tailwindWarnings, usesTailwind } from './styles.js'
import { BuilderError } from './errors.js'
import { sectionTemplate } from './catalog/index.js'
import { sectionKind } from '../shared/catalog/kinds.js'
import { sectionKindOf } from '../shared/sections.js'

const IGNORED = new Set(['node_modules', '.git', '.beast', 'dist', 'build', 'coverage', '.next'])
export { BuilderError }
const posix = (path: string) => path.split(sep).join('/')
/** Sections sit beside pages by default: src/pages → src/sections. */
export const defaultSectionsDir = (options: BeastPageBuilderOptions) => options.sectionsDir ?? posixPath.join(posixPath.dirname(options.pagesDir ?? 'src/pages'), 'sections')
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) }

export class BuilderProject {
  readonly root: string
  readonly include: string[]
  readonly pagesDir: string
  readonly sectionsDir: string
  readonly routerFile: string
  private compiler: ReturnType<typeof createOctaneCompiler> | undefined
  private mutation: Promise<void> = Promise.resolve()
  private creations = new Map<string, Promise<PagePreview>>()
  private tabCreations = new Map<string, Promise<TabsPreview>>()
  private sectionInstalls = new Map<string, Promise<SectionInstallPreview>>()

  constructor(root: string, private readonly options: BeastPageBuilderOptions = {}) {
    this.root = resolve(root)
    this.pagesDir = options.pagesDir ?? 'src/pages'
    this.sectionsDir = defaultSectionsDir(options)
    this.routerFile = options.routerFile ?? 'src/router.ts'
    this.include = [...new Set([...(options.include ?? ['src']), this.pagesDir, this.sectionsDir])]
    for (const path of [...this.include, this.routerFile, ...(options.navigation ? [options.navigation.file] : [])]) {
      if (isAbsolute(path) || !inside(this.root, resolve(this.root, path))) throw new BuilderError('Scan and page directories must be inside the project.')
    }
    // Files under a pages folder scan as pages, so installed sections would never be treated as components.
    if (inside(resolve(this.root, this.pagesDir), resolve(this.root, this.sectionsDir)) || /(?:^|\/)(pages|routes)(?:\/|$)/.test(posix(relative(this.root, resolve(this.root, this.sectionsDir))))) throw new BuilderError('sectionsDir must be outside pagesDir and any pages or routes folder.')
    if (!this.routerFile.endsWith('.ts')) throw new BuilderError('routerFile must be a TypeScript file.')
    if (options.navigation && !/\.(?:tsx?|btsx)$/.test(options.navigation.file)) throw new BuilderError('navigation.file must be .ts, .tsx, or .btsx.')
  }

  /** Check existing ancestors too, so a configured directory cannot escape through a symlink. */
  private async safe(path: string): Promise<void> {
    const canonicalRoot = await realpath(this.root)
    let current = path
    for (;;) {
      try {
        if (!inside(canonicalRoot, await realpath(current))) throw new BuilderError('Path resolves outside the project.', 403)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        current = dirname(current)
      }
    }
  }

  async scan(): Promise<ProjectScan> {
    const files: ProjectFile[] = []
    const sections: ProjectScan['sections'] = []
    const uses = new Map<string, SectionUse[]>()
    const stylesheets: string[] = []
    const warnings: string[] = []
    let navigationTargets: NavigationTarget[] = []
    const sources = new Map<string, DiscoverySource>()
    const visited = new Set<string>()
    const walk = async (directory: string): Promise<void> => {
      if (visited.has(directory)) return
      visited.add(directory)
      try {
        await this.safe(directory)
        const entries = await readdir(directory, { withFileTypes: true })
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          const path = resolve(directory, entry.name)
          if (entry.isSymbolicLink()) continue
          if (entry.isDirectory() && !IGNORED.has(entry.name) && !entry.name.startsWith('.')) await walk(path)
          else if (entry.isFile() && entry.name.endsWith('.btsx')) {
            if (sources.size >= 5000) throw new BuilderError('Scan limited to 5,000 files. Narrow the include directories.')
            const source = await readFile(path, 'utf8')
            const name = componentNameFromPath(path)
            const filePath = posix(relative(this.root, path))
            let components = [name]
            let error: string | null = null
            try {
              const result = compileBeastResult(source, { filename: path })
              components = [name, ...result.ast.declarations.flatMap(d => d.kind === 'component' ? [d.name] : [])]
              sections.push(...discoverSections(result.ast, filePath))
              for (const [target, found] of discoverComponentUses(result.ast, filePath)) uses.set(target, [...(uses.get(target) ?? []), ...found])
            } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
            files.push({ path: filePath, name, kind: inside(resolve(this.root, this.pagesDir), path) || /(?:^|\/)(pages|routes)\//.test(filePath) || /Page$/.test(name) ? 'page' : 'component', lines: source.split('\n').length, components, error })
            sources.set(filePath, { file: filePath, source, page: files.at(-1)!.kind === 'page' })
          } else if (entry.isFile() && entry.name.endsWith('.css')) {
            const file = posix(relative(this.root, path))
            if (!stylesheets.includes(file) && usesTailwind(await readFile(path, 'utf8'))) stylesheets.push(file)
          } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
            if (sources.size >= 5000) throw new BuilderError('Scan limited to 5,000 files. Narrow the include directories.')
            const file = posix(relative(this.root, path))
            sources.set(file, { file, source: await readFile(path, 'utf8'), page: false })
          }
        }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${posix(relative(this.root, directory))}: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    for (const directory of this.include) await walk(resolve(this.root, directory))
    // A section in its own component file is edited there, but belongs to the pages that render it.
    for (const section of sections) {
      const usedBy = uses.get(section.file)
      if (usedBy && files.find(file => file.path === section.file)?.kind === 'component') section.usedBy = usedBy
    }
    if (this.options.navigation) {
      try {
        const file = posix(relative(this.root, resolve(this.root, this.options.navigation.file)))
        await this.safe(resolve(this.root, file))
        const source = await readFile(resolve(this.root, file), 'utf8')
        sources.set(file, { file, source, page: false })
        navigationTargets.push(...discoverNavigation(source, file, this.options.navigation))
      } catch (cause) { warnings.push(cause instanceof Error ? cause.message : String(cause)) }
    }
    const { collections, tabComponents } = discoverProjectItems(this.root, [...sources.values()])
    let pageRoutes: ProjectScan['pageRoutes'] = []
    try {
      await this.safe(resolve(this.root, this.routerFile))
      pageRoutes = discoverPageRoutes(await readFile(resolve(this.root, this.routerFile), 'utf8'), this.routerFile, files)
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(cause instanceof Error ? cause.message : String(cause)) }
    if (this.options.navigation) {
      navigationTargets = navigationTargets.filter(target => collections.find(collection => collection.id === target.id)?.kind !== 'tabs').map(target => ({ ...target, itemType: collections.find(collection => collection.id === target.id)?.itemType }))
    } else {
      navigationTargets = collections.filter(collection => collection.editable && collection.kind === 'navigation').map(collection => ({ id: collection.id, file: collection.file, label: `${collection.file} · ${collection.name}`, array: collection.array, group: collection.group, itemType: collection.itemType }))
    }
    const tabInstances = pageRoutes.filter((page, index) => pageRoutes.findIndex(other => other.file === page.file) === index).flatMap(page => {
      const source = sources.get(page.file)?.source
      return source ? discoverTabInstances(source, page, tabComponents) : []
    })
    let packageJson: string | null = null
    try { await this.safe(resolve(this.root, 'package.json')); packageJson = await readFile(resolve(this.root, 'package.json'), 'utf8') }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(cause instanceof Error ? cause.message : String(cause)) }
    const tailwind = tailwindSetup(packageJson, stylesheets)
    return { sections, collections, tabComponents, tabInstances, pageRoutes, tailwind, name: basename(this.root), files: files.sort((a, b) => a.path.localeCompare(b.path)), scannedAt: new Date().toISOString(), warnings, navigationTargets }
  }

  async source(path: string): Promise<string> {
    if (typeof path !== 'string' || !path.endsWith('.btsx') || isAbsolute(path)) throw new BuilderError('Expected a project-relative .btsx path.')
    const target = resolve(this.root, path)
    if (!this.include.some(dir => inside(resolve(this.root, dir), target))) throw new BuilderError('File is outside the scan directories.', 403)
    await this.safe(target)
    return readFile(target, 'utf8')
  }

  async preview(draft: PageDraft): Promise<PagePreview> {
    if (draft.path !== undefined) return this.previewPageEdit(draft)
    if (typeof draft.name !== 'string' || !/^[A-Z][A-Za-z0-9]{0,79}$/.test(draft.name)) throw new BuilderError('Use a PascalCase page name, such as PricingPage.')
    if (typeof draft.source !== 'string' || !draft.source.trim() || Buffer.byteLength(draft.source) > 60_000) throw new BuilderError('Page source must contain between 1 and 60,000 bytes.')
    const path = posix(relative(this.root, resolve(this.root, this.pagesDir, `${draft.name}.btsx`)))
    const target = resolve(this.root, path)
    await this.safe(target)
    try {
      await lstat(target)
      throw new BuilderError(`${path} already exists. Choose another name.`, 409)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const source = draft.source.replace(/\r\n/g, '\n').trimEnd() + '\n'
    try {
      const result = compileBeastResult(source, { filename: target, componentName: draft.name })
      this.compiler ??= createOctaneCompiler({ root: this.root, environment: 'client', hmr: false, dev: true })
      this.compiler.transform(result.code, target.replace(/\.btsx$/, '.tsrx'), { environment: 'client', dev: true })
    } catch (cause) { throw new BuilderError(cause instanceof Error ? cause.message : String(cause), 422) }
    const derived = draft.name.replace(/Page$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase()
    const routePath = draft.routePath ?? '/' + (derived || 'page')
    if (typeof routePath !== 'string' || !/^\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(routePath) || routePath.length > 200) throw new BuilderError('Use a static URL such as /about or /company/about.')
    const navLabel = draft.navLabel ?? draft.name.replace(/Page$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    if (typeof navLabel !== 'string' || !navLabel.trim() || navLabel.length > 100 || /[\r\n\x00-\x1f]/.test(navLabel)) throw new BuilderError('Use a navigation label between 1 and 100 characters.')
    const routerPath = posix(relative(this.root, resolve(this.root, this.routerFile)))
    await this.safe(resolve(this.root, routerPath))
    let routerSource: string
    try { routerSource = await readFile(resolve(this.root, routerPath), 'utf8') }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new BuilderError(`${routerPath} is missing. Set up @octanejs/tanstack-router before adding pages.`, 422)
      throw cause
    }
    const routerAfter = registerRoute(routerSource, routerPath, path, draft.name, routePath)
    const { navigationTargets } = await this.scan()
    const navigation = draft.navigationTarget ? navigationTargets.find(target => target.id === draft.navigationTarget) : navigationTargets.length === 1 ? navigationTargets[0] : undefined
    if (!navigation) throw new BuilderError(navigationTargets.length ? 'Choose a navigation menu for the new link.' : 'No editable navigation found. Configure navigation.file with a BTSX nav or a TypeScript menu array.', 422)
    await this.safe(resolve(this.root, navigation.file))
    const navSource = await readFile(resolve(this.root, navigation.file), 'utf8')
    const navAfter = addNavigation(navSource, navigation, routePath, navLabel.trim(), this.options.navigation)
    if (navigation.file.endsWith('.btsx')) {
      const result = compileBeastResult(navAfter, { filename: navigation.file })
      this.compiler!.transform(result.code, navigation.file.replace(/\.btsx$/, '.tsrx'), { environment: 'client', dev: true })
    }
    if (new Set([path, routerPath, navigation.file]).size !== 3) throw new BuilderError('Page, router, and navigation must use separate files.')
    const files: PlannedFile[] = [
      { path, action: 'create', before: null, source },
      { path: routerPath, action: 'edit', before: routerSource, source: routerAfter },
      { path: navigation.file, action: 'edit', before: navSource, source: navAfter },
    ]
    const hash = createHash('sha256').update(JSON.stringify({ routePath, navLabel: navLabel.trim(), files })).digest('hex')
    return { path, source, hash, routePath, navLabel: navLabel.trim(), files }
  }

  private async previewPageEdit(draft: PageDraft): Promise<PagePreview> {
    if (typeof draft.path !== 'string') throw new BuilderError('Choose a page to edit.')
    // Section edits may also target a component containing the detected ID.
    const before = await this.source(draft.path)
    const report = await this.scan()
    if (draft.section !== undefined && (typeof draft.section !== 'string' || !report.sections.some(section => section.file === draft.path && section.elementId === draft.section))) throw new BuilderError('The selected section changed. Rescan the project.', 409)
    const page = report.files.find(file => file.path === draft.path && (file.kind === 'page' || draft.section !== undefined))
    if (!page) throw new BuilderError('Choose a page from the project scan.', 403)
    if (typeof draft.source !== 'string' || !draft.source.trim() || Buffer.byteLength(draft.source) > 60_000) throw new BuilderError('Page source must contain between 1 and 60,000 bytes.')
    const source = draft.source.replace(/\r\n/g, '\n').trimEnd() + '\n'
    try {
      const target = resolve(this.root, draft.path)
      const result = compileBeastResult(source, { filename: target })
      this.compiler ??= createOctaneCompiler({ root: this.root, environment: 'client', hmr: false, dev: true })
      this.compiler.transform(result.code, target.replace(/\.btsx$/, '.tsrx'), { environment: 'client', dev: true })
    } catch (cause) { throw new BuilderError(cause instanceof Error ? cause.message : String(cause), 422) }
    const files: PlannedFile[] = [{ path: page.path, action: 'edit', before, source }]
    const routePath = report.pageRoutes.find(route => route.file === page.path)?.routePath ?? ''
    const section = draft.section
    const hash = createHash('sha256').update(JSON.stringify({ files, routePath, section })).digest('hex')
    return { path: page.path, source, routePath, navLabel: '', files, hash, ...(section === undefined ? {} : { section }) }
  }

  private async writeFiles(files: PlannedFile[]): Promise<void> {
    // Preflight every file before writing anything. Serialize saves through this project instance.
    for (const file of files) {
      const target = resolve(this.root, file.path)
      await this.safe(target)
      if (file.before !== null && await readFile(target, 'utf8') !== file.before) throw new BuilderError(`${file.path} changed. Review again.`, 409)
    }
    const written: PlannedFile[] = []
    const staged: { file: PlannedFile; temporary: string; mode: number }[] = []
    try {
      // Stage every complete file before committing. Replacing edited files by rename
      // avoids truncating them if writing fails, and retains their permission bits.
      for (const file of files) {
        const target = resolve(this.root, file.path)
        await mkdir(dirname(target), { recursive: true })
        await this.safe(target)
        if (file.before !== null && (await lstat(target)).isSymbolicLink()) throw new BuilderError(`${file.path} is a symlink. Configure a regular source file.`, 403)
        const mode = file.before === null ? 0o666 : (await stat(target)).mode & 0o777
        const temporary = resolve(dirname(target), `.beast-page-builder-${randomUUID()}.tmp`)
        staged.push({ file, temporary, mode })
        await writeFile(temporary, file.source, { flag: 'wx', mode })
        if (file.before !== null) await chmod(temporary, mode)
      }
      for (const { file, temporary } of staged) {
        const target = resolve(this.root, file.path)
        await this.safe(target)
        if (file.before !== null && await readFile(target, 'utf8') !== file.before) throw new BuilderError(`${file.path} changed during save. Review again.`, 409)
        if (file.before === null) await link(temporary, target)
        else await rename(temporary, target)
        written.push(file)
      }
    } catch (cause) {
      const failures: string[] = []
      for (const file of written.reverse()) {
        const target = resolve(this.root, file.path)
        try {
          await this.safe(target)
          const current = await readFile(target, 'utf8')
          if (current !== file.source) { failures.push(file.path); continue }
          if (file.before === null) await unlink(target)
          else {
            const stage = staged.find(item => item.file === file)!
            await writeFile(stage.temporary, file.before, { flag: 'wx', mode: stage.mode })
            await rename(stage.temporary, target)
          }
        } catch { failures.push(file.path) }
      }
      if (failures.length) throw new BuilderError(`Save failed; could not restore ${failures.join(', ')}. Inspect these files before retrying.`, 500)
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new BuilderError('A file with this name now exists. Review again.', 409)
      throw cause
    } finally { await Promise.all(staged.map(item => unlink(item.temporary).catch(() => {}))) }
  }

  async create(draft: PageDraft, hash: string): Promise<PagePreview> {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new BuilderError('Review the page before saving.')
    const operation = this.mutation.then(async () => {
      const preview = await this.preview(draft)
      if (hash !== preview.hash) throw new BuilderError('The draft or project files changed. Review again before saving.', 409)
      await this.writeFiles(preview.files)
      return preview
    })
    this.mutation = operation.then(() => {}, () => {})
    this.creations.set(hash, operation)
    if (this.creations.size > 20) this.creations.delete(this.creations.keys().next().value!)
    return operation
  }

  /** A reload can interrupt the browser response while the file transaction finishes. */
  async creation(hash: string): Promise<PagePreview> {
    const result = this.creations.get(hash)
    if (!result) throw new BuilderError('Save result is unavailable. Inspect the project before retrying.', 404)
    return result
  }

  async previewTabs(draft: TabsDraft): Promise<TabsPreview> {
    if (typeof draft.page !== 'string' || typeof draft.routePath !== 'string' || typeof draft.component !== 'string') throw new BuilderError('Choose a page route and a Tabs component.')
    const report = await this.scan()
    if (!report.pageRoutes.some(page => page.file === draft.page && page.routePath === draft.routePath)) throw new BuilderError('The selected page route changed. Rescan the project.', 409)
    const component = report.tabComponents.find(component => component.id === draft.component)
    if (!component) throw new BuilderError('The selected Tabs component changed. Rescan the project.', 409)
    const before = await this.source(draft.page)
    const source = addTabs(before, component, draft)
    try {
      const target = resolve(this.root, draft.page)
      const result = compileBeastResult(source, { filename: target })
      this.compiler ??= createOctaneCompiler({ root: this.root, environment: 'client', hmr: false, dev: true })
      this.compiler.transform(result.code, target.replace(/\.btsx$/, '.tsrx'), { environment: 'client', dev: true })
    } catch (cause) { throw new BuilderError(cause instanceof Error ? cause.message : String(cause), 422) }
    const files: PlannedFile[] = [{ path: draft.page, action: 'edit', before, source }]
    // Include the contract and router snapshot so changed types/routes require a fresh review.
    const router = await readFile(resolve(this.root, this.routerFile), 'utf8')
    const contract = await this.source(component.file)
    const hash = createHash('sha256').update(JSON.stringify({ draft, files, router, contract, itemType: component.itemType })).digest('hex')
    return { path: draft.page, source, routePath: draft.routePath, files, hash }
  }

  async createTabs(draft: TabsDraft, hash: string): Promise<TabsPreview> {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new BuilderError('Review the tabs before saving.')
    const operation = this.mutation.then(async () => {
      const preview = await this.previewTabs(draft)
      if (preview.hash !== hash) throw new BuilderError('The page, tabs, route, or item type changed. Review again before saving.', 409)
      await this.writeFiles(preview.files)
      return preview
    })
    this.mutation = operation.then(() => {}, () => {})
    this.tabCreations.set(hash, operation)
    if (this.tabCreations.size > 20) this.tabCreations.delete(this.tabCreations.keys().next().value!)
    return operation
  }

  async tabCreation(hash: string): Promise<TabsPreview> {
    const result = this.tabCreations.get(hash)
    if (!result) throw new BuilderError('Save result is unavailable. Inspect the page before retrying.', 404)
    return result
  }

  async previewSection(draft: SectionInstallDraft): Promise<SectionInstallPreview> {
    if (typeof draft.page !== 'string' || typeof draft.template !== 'string') throw new BuilderError('Choose a page and a section template.')
    const template = sectionTemplate(draft.template)
    if (!template) throw new BuilderError('Unknown section template.', 404)
    if (draft.name !== undefined && (typeof draft.name !== 'string' || !/^[A-Z][A-Za-z0-9]{0,79}$/.test(draft.name))) throw new BuilderError('Use a PascalCase section name, such as Pricing.')
    if (draft.index !== undefined && typeof draft.index !== 'number') throw new BuilderError('Section position must be a number.')
    const report = await this.scan()
    const page = report.files.find(file => file.path === draft.page && file.kind === 'page')
    if (!page) throw new BuilderError('Choose a page from the project scan.', 403)
    if (page.error) throw new BuilderError(`${page.path} does not compile. Fix it before adding sections.`, 422)
    const before = await this.source(page.path)
    const document = compileBeastResult(before, { filename: resolve(this.root, page.path) }).ast

    // A default name is numbered past anything the page already binds or the sections folder already holds;
    // a chosen name must be free. Either way an existing component file is never overwritten.
    const taken = new Set([...importedNames(document), ...page.components])
    const available = async (name: string) => {
      if (taken.has(name)) return false
      try { await lstat(resolve(this.root, this.sectionsDir, `${name}.btsx`)); return false }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return true }
    }
    let name = draft.name
    if (name !== undefined) {
      if (!await available(name)) throw new BuilderError(`${name} is already used by this page or ${this.sectionsDir}. Choose another name.`, 409)
    } else {
      const base = sectionKind(template.kind).component
      for (let count = 1; name === undefined; count++) {
        if (count > 100) throw new BuilderError(`Too many ${base} sections. Choose a name.`, 409)
        const candidate = count === 1 ? base : `${base}${count}`
        if (await available(candidate)) name = candidate
      }
    }
    const path = posix(relative(this.root, resolve(this.root, this.sectionsDir, `${name}.btsx`)))
    await this.safe(resolve(this.root, path))
    const relativePath = posixPath.relative(posixPath.dirname(page.path), path)
    const specifier = relativePath.startsWith('.') ? relativePath : `./${relativePath}`

    const imports = componentImports(document, page.path)
    const kindOf = (node: BeastNode) => {
      if (node.kind !== 'element') return undefined
      const marker = literalAttr(node, 'data-section') ?? literalAttr(node, 'id') ?? node.id
      const kind = marker ? sectionKindOf(marker) : undefined
      if (kind) return kind
      const target = node.isComponent ? imports.get(node.tag) : undefined
      return target ? report.sections.find(section => section.file === target && section.kind)?.kind : undefined
    }
    const pageSource = addSectionUse(before, document, { name, specifier, kind: template.kind, index: draft.index }, kindOf)
    if (Buffer.byteLength(pageSource) > 60_000) throw new BuilderError('Page source must contain between 1 and 60,000 bytes.')
    const sectionSource = template.source.trimEnd() + '\n'
    try {
      this.compiler ??= createOctaneCompiler({ root: this.root, environment: 'client', hmr: false, dev: true })
      for (const [file, source, componentName] of [[path, sectionSource, name], [page.path, pageSource, undefined]] as const) {
        const target = resolve(this.root, file)
        const result = compileBeastResult(source, { filename: target, ...(componentName ? { componentName } : {}) })
        this.compiler.transform(result.code, target.replace(/\.btsx$/, '.tsrx'), { environment: 'client', dev: true })
      }
    } catch (cause) { throw new BuilderError(cause instanceof Error ? cause.message : String(cause), 422) }
    const files: PlannedFile[] = [
      { path, action: 'create', before: null, source: sectionSource },
      { path: page.path, action: 'edit', before, source: pageSource },
    ]
    // The first install adds the studio base styles to the Tailwind stylesheet; later ones find the marker.
    const tailwind = report.tailwind!
    if (tailwind.stylesheet) {
      const target = resolve(this.root, tailwind.stylesheet)
      await this.safe(target)
      const css = await readFile(target, 'utf8')
      const styled = addStudioStyles(css)
      if (styled !== null) files.push({ path: tailwind.stylesheet, action: 'edit', before: css, source: styled })
    }
    const warnings = tailwindWarnings(tailwind)
    const routePath = report.pageRoutes.find(route => route.file === page.path)?.routePath ?? ''
    const hash = createHash('sha256').update(JSON.stringify({ template: template.id, name, files, routePath })).digest('hex')
    return { path, page: page.path, name, kind: template.kind, template: template.id, routePath, hash, files, warnings }
  }

  async installSection(draft: SectionInstallDraft, hash: string): Promise<SectionInstallPreview> {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new BuilderError('Review the section before saving.')
    const operation = this.mutation.then(async () => {
      const preview = await this.previewSection(draft)
      if (preview.hash !== hash) throw new BuilderError('The page, section, or project files changed. Review again before saving.', 409)
      await this.writeFiles(preview.files)
      return preview
    })
    this.mutation = operation.then(() => {}, () => {})
    this.sectionInstalls.set(hash, operation)
    if (this.sectionInstalls.size > 20) this.sectionInstalls.delete(this.sectionInstalls.keys().next().value!)
    return operation
  }

  async sectionInstall(hash: string): Promise<SectionInstallPreview> {
    const result = this.sectionInstalls.get(hash)
    if (!result) throw new BuilderError('Save result is unavailable. Inspect the page before retrying.', 404)
    return result
  }
}
