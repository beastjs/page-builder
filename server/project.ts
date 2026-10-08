import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, writeFile, unlink, link, rename, stat, chmod } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { compileBeastResult, componentNameFromPath } from 'beast-tsrx'
import { createOctaneCompiler } from 'octane/compiler/bundler'
import type { BeastPageBuilderOptions, NavigationTarget, PageDraft, PagePreview, PlannedFile, ProjectFile, ProjectScan } from '../shared/types.js'
import { addNavigation, discoverNavigation, registerRoute } from './integration.js'
import { discoverCollections, type DiscoverySource } from './discovery.js'

const IGNORED = new Set(['node_modules', '.git', '.beast', 'dist', 'build', 'coverage', '.next'])
export class BuilderError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
const posix = (path: string) => path.split(sep).join('/')
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) }

export class BuilderProject {
  readonly root: string
  readonly include: string[]
  readonly pagesDir: string
  readonly routerFile: string
  private compiler: ReturnType<typeof createOctaneCompiler> | undefined
  private mutation: Promise<void> = Promise.resolve()
  private creations = new Map<string, Promise<PagePreview>>()

  constructor(root: string, private readonly options: BeastPageBuilderOptions = {}) {
    this.root = resolve(root)
    this.pagesDir = options.pagesDir ?? 'src/pages'
    this.routerFile = options.routerFile ?? 'src/router.ts'
    this.include = [...new Set([...(options.include ?? ['src']), this.pagesDir])]
    for (const path of [...this.include, this.routerFile, ...(options.navigation ? [options.navigation.file] : [])]) {
      if (isAbsolute(path) || !inside(this.root, resolve(this.root, path))) throw new BuilderError('Scan and page directories must be inside the project.')
    }
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
            let components = [name]
            let error: string | null = null
            try {
              const result = compileBeastResult(source, { filename: path })
              components = [name, ...result.ast.declarations.flatMap(d => d.kind === 'component' ? [d.name] : [])]
            } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
            const filePath = posix(relative(this.root, path))
            files.push({ path: filePath, name, kind: inside(resolve(this.root, this.pagesDir), path) || /(?:^|\/)(pages|routes)\//.test(filePath) || /Page$/.test(name) ? 'page' : 'component', lines: source.split('\n').length, components, error })
            sources.set(filePath, { file: filePath, source, page: files.at(-1)!.kind === 'page' })
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
    if (this.options.navigation) {
      try {
        const file = posix(relative(this.root, resolve(this.root, this.options.navigation.file)))
        await this.safe(resolve(this.root, file))
        const source = await readFile(resolve(this.root, file), 'utf8')
        sources.set(file, { file, source, page: false })
        navigationTargets.push(...discoverNavigation(source, file, this.options.navigation))
      } catch (cause) { warnings.push(cause instanceof Error ? cause.message : String(cause)) }
    }
    const collections = discoverCollections(this.root, [...sources.values()])
    if (this.options.navigation) {
      navigationTargets = navigationTargets.filter(target => collections.find(collection => collection.id === target.id)?.kind !== 'tabs').map(target => ({ ...target, itemType: collections.find(collection => collection.id === target.id)?.itemType }))
    } else {
      navigationTargets = collections.filter(collection => collection.editable && collection.kind === 'navigation').map(collection => ({ id: collection.id, file: collection.file, label: `${collection.file} · ${collection.name}`, array: collection.array, group: collection.group, itemType: collection.itemType }))
    }
    return { collections, name: basename(this.root), files: files.sort((a, b) => a.path.localeCompare(b.path)), scannedAt: new Date().toISOString(), warnings, navigationTargets }
  }

  async source(path: string): Promise<string> {
    if (typeof path !== 'string' || !path.endsWith('.btsx') || isAbsolute(path)) throw new BuilderError('Expected a project-relative .btsx path.')
    const target = resolve(this.root, path)
    if (!this.include.some(dir => inside(resolve(this.root, dir), target))) throw new BuilderError('File is outside the scan directories.', 403)
    await this.safe(target)
    return readFile(target, 'utf8')
  }

  async preview(draft: PageDraft): Promise<PagePreview> {
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

  async create(draft: PageDraft, hash: string): Promise<PagePreview> {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new BuilderError('Review the page before saving.')
    const operation = this.mutation.then(async () => {
      const preview = await this.preview(draft)
      if (hash !== preview.hash) throw new BuilderError('The draft, router, or navigation changed. Review again before saving.', 409)
      // Preflight every file before writing anything. Serialize saves through this project instance.
      for (const file of preview.files) {
        const target = resolve(this.root, file.path)
        await this.safe(target)
        if (file.before !== null && await readFile(target, 'utf8') !== file.before) throw new BuilderError(`${file.path} changed. Review again.`, 409)
      }
      const written: PlannedFile[] = []
      const staged: { file: PlannedFile; temporary: string; mode: number }[] = []
      try {
        // Stage every complete file before committing. Replacing edited files by rename
        // avoids truncating them if writing fails, and retains their permission bits.
        for (const file of preview.files) {
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
}
