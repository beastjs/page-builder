import {
  BASE,
  type ClientConfig,
  type DetectedCollection,
  type DetectedSection,
  type PageDraft,
  type PagePreview,
  type PageRoute,
  type ProjectFile,
  type ProjectScan,
  type SectionInstallPreview,
  type SectionSummary,
  type TabComponent,
  type TabInstance,
  type TabsDraft,
  type TabsPreview,
} from '../shared/types.js'
import type { StatusScreen, StatusViewProps } from './status/types.js'
import type { FileInspectorProps, CollectionInspectorProps } from './inspect/types.js'
import type { ReviewViewProps } from './review/types.js'
import type { PageEditorProps } from './pages/types.js'
import { insertSection } from './pages/model.js'
import { paletteActions } from './palette/actions.js'
import type { PaletteProps, PaletteTab } from './palette/types.js'
import { newTab, tabKey } from './tabs/model.js'
import type { TabsEditorProps } from './tabs/types.js'
import type { SectionLibraryProps } from './sections/types.js'
import { kindsOnPage } from './sections/model.js'
import type { SectionKindId } from '../shared/catalog/types.js'
import { sectionKind } from '../shared/catalog/kinds.js'
import { sectionLibrary, templates } from './templates.js'
import type { BuilderProps, BuilderScreen, BuilderView } from './state.js'
import { defaultConfig, createApi } from './api.js'
import { createPersistence } from './persistence.js'
import { createPreferences, shortcutLabel as formatShortcut } from './browser/preferences.js'
import { createNavigation, normalizePath } from './browser/navigation.js'
import { createPanelBehavior } from './browser/panel.js'
import { animateScreen, waitForScan } from './browser/animation.js'

interface ControllerOptions {
  host: HTMLElement
  shadow: ShadowRoot
  panel: HTMLElement
  apiBase: string
  commit: (props: BuilderProps) => void
}

/** Owns drafts and async operations; views receive typed snapshots and actions. */
export function createBuilderController({ host, shadow, panel, apiBase, commit }: ControllerOptions): () => void {
  const request = createApi(apiBase)
  const storage = createPersistence(apiBase)
  const { receipt, tabsReceipt, installReceipt } = storage
  let disposed = false
  let config = defaultConfig
  let report: ProjectScan | null = null
  let opened = false
  let view: BuilderView = 'palette'
  let screenVersion = 0
  function setView(next: BuilderView): void {
    if (next !== view) screenVersion++
    view = next
  }
  const atView = (expected: BuilderView) => view === expected
  let tab: PaletteTab = 'All'
  let query = ''
  let selected = 0
  let controller: AbortController | null = null
  let generation = 0
  let draft: PageDraft = { name: 'UntitledPage', source: templates.blank }
  let preview: PagePreview | null = null
  let currentCollection: DetectedCollection | null = null
  let currentFile: ProjectFile | null = null
  let currentSource = ''
  let busy = false
  let message = ''
  let scanTimer: number | undefined
  let scanLabel = 'Looking for pages, menus, and tabs…'
  let tabsDraft: TabsDraft = { page: '', routePath: '', component: '', items: [], active: '', label: 'Tabs' }
  let tabsPreview: TabsPreview | null = null
  let draftRevision = 0
  let sectionSummaries: SectionSummary[] | null = null
  let sectionPage = ''
  let sectionQuery = ''
  let sectionKindOpen: SectionKindId | undefined
  let sectionTemplate: string | undefined
  let sectionPreview: SectionInstallPreview | null = null
  let resumeTabs = false
  const routePrefix = apiBase.slice(0, -BASE.length)
  const navigation = createNavigation(routePrefix)
  const { currentPath } = navigation
  const tabsComponent = () => report?.tabComponents.find((component) => component.id === tabsDraft.component)
  const tabsPage = () =>
    report?.pageRoutes.find((page) => page.file === tabsDraft.page && page.routePath === tabsDraft.routePath)
  const tabsReady = () =>
    !!tabsPage() &&
    currentPath() === normalizePath(tabsDraft.routePath) &&
    !!tabsComponent() &&
    !tabsComponent()!.reason
  const shortcutLabel = () => formatShortcut(config.shortcut)
  const preferences = createPreferences(storage, () => render())
  const isDark = () => preferences.dark(config)
  const behavior = createPanelBehavior({
    shadow, panel, storage, opened: () => opened, shortcut: () => config.shortcut,
    onToggle: () => opened ? close() : open(), onClose: close
  })
  const focusSearch = () => behavior.focusSearch()
  function onThemeToggle(event: MouseEvent): void {
    if (!(event.target instanceof Element) || !event.target.closest('.theme-toggle')) return
    preferences.toggleTheme(config)
    render()
  }
  function toggleLauncher(): void {
    preferences.toggleLauncher(config)
    query = ''
    selected = 0
    message = !preferences.launcher(config) ? `Launcher hidden. Open the builder with ${shortcutLabel()}.` : 'Launcher shown.'
    render()
    focusSearch()
  }
  const configuration = request<ClientConfig>('/config').then(value => {
    if (!disposed && generation === 0) { config = value; render() }
  })
  // The default shortcut and launcher remain usable while the dev server restarts.
  void configuration.catch(() => {})
  render()
  const notify = (text: string) => { message = text; render() }

  function render(): void {
    if (disposed) return
    const entering = opened && panel.dataset.view !== view
    const screen = !opened ? null : view === 'palette' ? paletteScreen()
      : view === 'draft' || view === 'page-edit' ? pageScreen()
      : view === 'tabs-draft' ? tabsScreen()
      : view === 'sections' ? libraryScreen()
      : view === 'preview' || view === 'tabs-preview' || view === 'section-preview' ? reviewScreen()
      : view === 'file' || view === 'collection' ? inspectorScreen() : statusScreen()
    behavior.updateContent(() => commit({
      opened, screen, theme: preferences.mode(config), position: config.position,
      launcherVisible: preferences.launcher(config), shortcut: shortcutLabel(),
      onOpen: open, onClose: close, onThemeToggle
    }))
    if (entering) animateScreen(panel)
    behavior.position()
  }

  function startPageEdit(): void {
    if (draft.path !== currentFile!.path) {
      draft = { name: currentFile!.name, path: currentFile!.path, source: currentSource }
      draftRevision++
    }
    preview = null
    message = ''
    setView('page-edit')
    render()
    panel.querySelector<HTMLTextAreaElement>('#edit-page-source')!.focus()
  }
  function startEditingTabs(instance: TabInstance): void {
    if (!instance.draft) return
    tabsDraft = structuredClone(instance.draft)
    tabsPreview = null
    message = ''
    setView('tabs-draft')
    const page = tabsPage()
    if (page && currentPath() !== normalizePath(page.routePath)) {
      choosePage(page)
      return
    }
    render()
    panel.querySelector<HTMLInputElement>('[data-field]')?.focus()
  }

  function selectComponent(component: TabComponent): void {
    tabsDraft.component = component.id
    tabsDraft.items = []
    tabsDraft.items.push(newTab(component, [], 0), newTab(component, [], 1))
    const key = tabKey(component)
    tabsDraft.active = key ? tabsDraft.items[0]![key]! : ''
    tabsPreview = null
  }
  function startTabs(preserve = false): void {
    if (!preserve && tabsDraft.instance) {
      delete tabsDraft.instance
      tabsDraft.items = []
    }
    const page =
      preserve && tabsDraft.instance
        ? tabsPage()
        : report?.pageRoutes.find((page) => normalizePath(page.routePath) === currentPath())
    tabsDraft.page = page?.file ?? ''
    tabsDraft.routePath = page?.routePath ?? ''
    if (!tabsComponent() && report?.tabComponents.length)
      selectComponent(report.tabComponents.find((component) => !component.reason) ?? report.tabComponents[0]!)
    if (!tabsDraft.items.length && tabsComponent()) selectComponent(tabsComponent()!)
    message = ''
    tabsPreview = null
    setView('tabs-draft')
    render()
    panel.querySelector<HTMLInputElement>('#tabs-page')?.focus()
  }
  function choosePage(page: PageRoute): void {
    tabsDraft.page = page.file
    tabsDraft.routePath = page.routePath
    tabsPreview = null
    if (currentPath() === normalizePath(page.routePath)) {
      message = ''
      render()
      return
    }
    // A real navigation lets every host router load the selected page before insertion is enabled.
    tabsReceipt({ draft: tabsDraft })
    message = `Opening ${page.routePath}…`
    render()
    navigation.go(page.routePath)
  }
  function tabsScreen(): BuilderScreen {
    const props: TabsEditorProps = {
      draft: tabsDraft,
      pages: report?.pageRoutes ?? [],
      components: report?.tabComponents ?? [],
      ready: tabsReady(),
      dark: isDark(),
      busy,
      message,
      onDraftChange(next) {
        const changedComponent = next.component !== tabsDraft.component
        // Navigation belongs to the shell; preserve route changes while the form is mounted.
        tabsDraft = { ...next, page: tabsDraft.page, routePath: tabsDraft.routePath }
        tabsPreview = null
        if (changedComponent) {
          message = ''
          render()
        }
      },
      onChoosePage: choosePage,
      onReview: reviewTabs,
      onBack() {
        message = ''
        tabsReceipt(null)
        setView('palette')
        render()
        focusSearch()
      },
      onClose: close
    }
    return { type: 'tabs', key: screenVersion, view, props }
  }

  async function reviewTabs(): Promise<void> {
    if (busy || view !== 'tabs-draft' || !tabsReady() || !panel.querySelector<HTMLFormElement>('.tabs-form')?.reportValidity()) return
    const turn = generation
    const owner = screenVersion
    const submitted = structuredClone(tabsDraft)
    const current = () => opened && turn === generation && view === 'tabs-draft' && screenVersion === owner && tabsReady() && JSON.stringify(tabsDraft) === JSON.stringify(submitted)
    busy = true
    message = ''
    render()
    try {
      const result = await request<TabsPreview>('/tabs/preview', submitted)
      if (!current()) return
      tabsPreview = result
      setView('tabs-preview')
    } catch (error) {
      if (current()) message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened) {
        render()
        if (turn === generation && atView('tabs-preview')) focusSearch()
      }
    }
  }
  async function saveTabs(): Promise<void> {
    if (busy || view !== 'tabs-preview' || !tabsPreview || !tabsReady()) return
    const turn = generation
    const owner = screenVersion
    const proposed = tabsPreview
    const current = () => opened && turn === generation && view === 'tabs-preview' && screenVersion === owner && tabsPreview === proposed && tabsReady()
    busy = true
    message = ''
    render()
    tabsReceipt({ draft: tabsDraft, hash: proposed.hash })
    try {
      const result = await request<TabsPreview>('/tabs/create', { ...tabsDraft, hash: proposed.hash })
      if (!current()) return
      tabsPreview = result
      setView('tabs-success')
    } catch (error) {
      if (turn === generation && tabsReceipt()?.hash === proposed.hash) tabsReceipt(null)
      if (current()) message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened) {
        render()
        if (turn === generation && atView('tabs-success')) focusSearch()
      }
    }
  }

  function statusScreen(): BuilderScreen {
    let screen: StatusScreen
    if (view === 'scan') screen = { type: 'scan', label: scanLabel }
    else if (view === 'error') screen = { type: 'error', message, onRetry: () => void scan() }
    else if (view === 'tabs-success') screen = {
      type: 'tabs-success', editing: !!tabsDraft.instance, preview: tabsPreview!, count: tabsDraft.items.length,
      onDone() {
        tabsReceipt(null)
        tabsPreview = null
        tabsDraft.items = []
        delete tabsDraft.instance
        void scan()
      }
    }
    else if (view === 'section-success') {
      const installed = sectionPreview!
      screen = {
        type: 'section-success', label: sectionKind(installed.kind).label, preview: installed, href: routePrefix + installed.routePath,
        onVisit: () => { installReceipt('') },
        onAddAnother() {
          installReceipt('')
          sectionPreview = null
          void scan().then(() => { if (opened && atView('palette')) openLibrary(installed.page) })
        },
        onDone() {
          installReceipt('')
          sectionPreview = null
          void scan()
        }
      }
    }
    else screen = {
      type: 'page-success', editing: !!draft.path, section: draft.section, name: draft.name, preview: preview!, href: routePrefix + preview!.routePath,
      onVisit: () => { receipt('') },
      onEdit() {
        receipt('')
        currentFile = report?.files.find(file => file.path === preview!.path) ?? { path: preview!.path, name: draft.name, kind: 'page', lines: preview!.source.split('\n').length, components: [draft.name], error: null }
        currentSource = preview!.source
        startPageEdit()
      },
      onDone() {
        receipt('')
        draft = { name: 'UntitledPage', source: templates.blank }
        preview = null
        void scan()
      }
    }
    const props: StatusViewProps = {
      screen, projectName: report?.name ?? 'initializing', dark: isDark(), onClose: close,
      onBack() {
        message = ''
        if (view === 'success') receipt('')
        if (view === 'tabs-success') tabsReceipt(null)
        if (view === 'section-success') installReceipt('')
        if (!report) { void scan(); return }
        setView('palette')
        render()
        focusSearch()
      }
    }
    return { type: 'status', key: screenVersion, view, props }
  }

  function inspectorScreen(): BuilderScreen {
    const controls = {
      dark: isDark(),
      onBack() {
        message = ''
        if (!report) { void scan(); return }
        setView('palette')
        render()
        focusSearch()
      },
      onClose: close
    }
    if (view === 'file') {
      const props: FileInspectorProps = {
        ...controls, file: currentFile!, source: currentSource, message,
        instances: report?.tabInstances.filter(instance => instance.page === currentFile!.path) ?? [],
        onCopy: copySource, onEditPage: startPageEdit, onEditTabs: startEditingTabs
      }
      return { type: 'file', key: screenVersion, view, props }
    } else {
      const props: CollectionInspectorProps = { ...controls, collection: currentCollection! }
      return { type: 'collection', key: screenVersion, view, props }
    }
  }

  async function copySource(): Promise<void> {
    if (view !== 'file') return
    const owner = screenVersion
    const turn = generation
    const source = currentSource
    let result = 'Source copied.'
    try {
      await navigator.clipboard.writeText(source)
    } catch {
      result = 'Could not access the clipboard. Select the source to copy it.'
    }
    if (opened && turn === generation && view === 'file' && screenVersion === owner) notify(result)
  }

  function reviewScreen(): BuilderScreen {
    const controls = {
      busy, dark: isDark(), message,
      onBack() {
        message = ''
        if (view === 'section-preview') {
          sectionPreview = null
          setView('sections')
          render()
          panel.querySelector<HTMLElement>(`[data-template="${CSS.escape(sectionTemplate ?? '')}"]`)?.focus()
          return
        }
        setView(view === 'tabs-preview' ? 'tabs-draft' : draft.path ? 'page-edit' : 'draft')
        render()
        panel.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus()
      },
      onClose: close
    }
    const props: ReviewViewProps = view === 'tabs-preview'
      ? { ...controls, mode: tabsDraft.instance ? 'edit-tabs' : 'add-tabs', preview: tabsPreview!, ready: tabsReady(), onSave: saveTabs }
      : view === 'section-preview'
      ? { ...controls, mode: 'add-section', preview: sectionPreview!, onSave: saveSection }
      : { ...controls, mode: draft.section ? 'edit-section' : draft.path ? 'edit-page' : 'create-page', preview: preview!, onSave: save }
    return { type: 'review', key: screenVersion, view, props }
  }

  function pageScreen(): BuilderScreen {
    const detected = draft.section ? report?.sections.find(section => section.file === draft.path && section.elementId === draft.section) : undefined
    const savedPage = !!draft.path && !draft.section && !!report?.files.some(file => file.path === draft.path && file.kind === 'page')
    const props: PageEditorProps = {
      draft, pagesDir: config.pagesDir, targets: report?.navigationTargets ?? [], dark: isDark(), busy, message,
      sectionTitle: detected?.marker === 'data-section' && detected.kind ? sectionKind(detected.kind).label : undefined,
      library: savedPage ? { onOpen: draft.source === currentSource ? () => openLibrary(draft.path) : undefined } : undefined,
      onDraftChange(next) {
        if (next === draft) return
        draftRevision++
        draft = next
        preview = null
        // Commit controlled values before native input restoration, even just after mounting.
        render()
      },
      onReview: review,
      onClearMessage() { message = ''; render() },
      onBack() {
        message = ''
        if (!report) { void scan(); return }
        setView('palette')
        render()
        focusSearch()
      },
      onClose: close
    }
    return { type: 'page', key: screenVersion, view, props }
  }

  function appendSection(snippet: string): void {
    draft = { ...draft, source: insertSection(draft.source, snippet) }
    draftRevision++
    preview = null
  }

  function createPage(): void {
    if (draft.path) {
      draft = { name: 'UntitledPage', source: templates.blank }
      draftRevision++
      preview = null
    }
    setView('draft')
    message = ''
    render()
    panel.querySelector<HTMLInputElement>('#page-name')!.focus()
  }

  function openLibrary(page?: string): void {
    const pages = report?.files.filter(file => file.kind === 'page') ?? []
    const routed = report?.pageRoutes.find(route => normalizePath(route.routePath) === currentPath())?.file
    sectionPage = [page, sectionPage, routed].find(candidate => candidate && pages.some(file => file.path === candidate)) ?? pages[0]?.path ?? ''
    sectionTemplate = undefined
    sectionPreview = null
    message = ''
    setView('sections')
    render()
    panel.querySelector<HTMLInputElement>('#section-search')?.focus()
    if (!sectionSummaries) void loadSummaries()
  }
  async function loadSummaries(): Promise<void> {
    const turn = generation
    try {
      const result = await request<SectionSummary[]>('/sections')
      sectionSummaries = result
      if (opened && turn === generation) render()
    } catch (error) {
      if (opened && turn === generation && view === 'sections') notify(error instanceof Error ? error.message : String(error))
    }
  }
  function libraryScreen(): BuilderScreen {
    const props: SectionLibraryProps = {
      summaries: sectionSummaries, pages: report?.files.filter(file => file.kind === 'page') ?? [], page: sectionPage,
      routes: Object.fromEntries((report?.pageRoutes ?? []).map(route => [route.file, route.routePath])),
      currentPage: report?.pageRoutes.find(route => normalizePath(route.routePath) === currentPath())?.file,
      pageKinds: kindsOnPage(report?.sections ?? [], sectionPage), sectionsDir: config.sectionsDir,
      query: sectionQuery, openKind: sectionKindOpen, pending: busy ? sectionTemplate : undefined, dark: isDark(), message,
      onPageChange(page) { sectionPage = page; message = ''; render() },
      onQueryChange(next) { sectionQuery = next; render() },
      onOpenKind(kind) { sectionKindOpen = kind; render() },
      onInstall: (template) => void reviewSection(template),
      onBack() {
        message = ''
        if (!report) { void scan(); return }
        setView('palette')
        render()
        focusSearch()
      },
      onClose: close
    }
    return { type: 'sections', key: screenVersion, view, props }
  }
  async function reviewSection(template: string): Promise<void> {
    if (busy || view !== 'sections' || !sectionPage) return
    const turn = generation
    const owner = screenVersion
    const page = sectionPage
    const current = () => opened && turn === generation && view === 'sections' && screenVersion === owner && sectionPage === page && sectionTemplate === template
    busy = true
    sectionTemplate = template
    message = ''
    render()
    try {
      const result = await request<SectionInstallPreview>('/install/preview', { page, template })
      if (!current()) return
      sectionPreview = result
      setView('section-preview')
    } catch (error) {
      if (current()) message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened) {
        render()
        if (turn === generation && atView('section-preview')) focusSearch()
      }
    }
  }
  async function saveSection(): Promise<void> {
    if (busy || view !== 'section-preview' || !sectionPreview) return
    const turn = generation
    const owner = screenVersion
    const proposed = sectionPreview
    const current = () => opened && turn === generation && view === 'section-preview' && screenVersion === owner && sectionPreview === proposed
    busy = true
    message = ''
    render()
    installReceipt(proposed.hash)
    try {
      const result = await request<SectionInstallPreview>('/install/create', { page: proposed.page, template: proposed.template, hash: proposed.hash })
      if (!current()) return
      sectionPreview = result
      // A page draft opened before the install no longer matches the file it would save over.
      if (draft.path === result.page) {
        draft = { name: 'UntitledPage', source: templates.blank }
        draftRevision++
        preview = null
      }
      setView('section-success')
    } catch (error) {
      if (turn === generation && installReceipt() === proposed.hash) installReceipt('')
      if (current()) message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened) {
        render()
        if (turn === generation && atView('section-success')) focusSearch()
      }
    }
  }

  function paletteScreen(): BuilderScreen {
    const actions = paletteActions({
      report, tab, query, launcherHidden: !preferences.launcher(config), shortcut: shortcutLabel(), sections: sectionLibrary,
      handlers: {
        createPage() {
          createPage()
          panel.querySelector<HTMLInputElement>('#page-name')!.select()
        },
        addTabs: startTabs,
        openLibrary: () => openLibrary(),
        scan: () => void scan(),
        toggleLauncher,
        editTabs: startEditingTabs,
        openFile: (file) => void openFile(file),
        editSection(section) {
          const file = report?.files.find(file => file.path === section.file)
          if (file) void openFile(file, section)
        },
        addSection(snippet) {
          if (draft.path) draft = { name: 'UntitledPage', source: templates.blank }
          appendSection(snippet)
          createPage()
        },
        openCollection(collection) {
          currentCollection = collection
          setView('collection')
          render()
          focusSearch()
        }
      }
    })
    selected = Math.min(selected, Math.max(0, actions.length - 1))
    const errors = report?.files.filter((file) => file.error).length ?? 0
    const props: PaletteProps = {
      actions, tab, query, selected, dark: isDark(), projectName: report?.name ?? 'initializing',
      message: message || report?.warnings.join(' · ') ||
        (errors ? `${errors} file${errors === 1 ? '' : 's'} with compiler errors. Open the source to inspect.` : ''),
      onQueryChange(next) {
        query = next
        selected = 0
        render()
      },
      onTabChange(next) {
        if (tab === next) return
        tab = next
        selected = 0
        render()
        focusSearch()
      },
      onSelect(index) {
        selected = index
        render()
      },
      onCreate: createPage,
      onClose: close
    }
    return { type: 'palette', key: screenVersion, view, props }
  }

  async function scan(): Promise<void> {
    controller?.abort()
    window.clearTimeout(scanTimer)
    controller = new AbortController()
    const signal = controller.signal
    const turn = ++generation
    setView('scan')
    scanLabel = 'Looking for pages, menus, and tabs…'
    message = ''
    render()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const timer = window.setTimeout(() => {
      if (opened && view === 'scan' && turn === generation) {
        scanLabel = 'Resolving menus, tabs, and item types…'
        render()
      }
    }, 650)
    scanTimer = timer
    try {
      const nextConfig = await request<ClientConfig>('/config', undefined, signal)
      if (signal.aborted || !opened || turn !== generation) return
      config = nextConfig
      render()
      const next = await request<ProjectScan>('/scan', undefined, signal)
      const duration = reduced ? 0 : config.scanDuration
      await waitForScan(duration - (performance.now() - start), signal)
      if (signal.aborted || !opened || turn !== generation) return
      report = next
      setView('palette')
      selected = 0
      if (resumeTabs) {
        resumeTabs = false
        startTabs(true)
      } else {
        render()
        focusSearch()
      }
    } catch (error) {
      if (signal.aborted || !opened || turn !== generation) return
      message = error instanceof Error ? error.message : String(error)
      setView('error')
      render()
      focusSearch()
    } finally {
      window.clearTimeout(timer)
    }
  }

  async function openFile(file: ProjectFile, section?: DetectedSection): Promise<void> {
    if (busy) return
    const turn = generation
    const owner = screenVersion
    busy = true
    try {
      const result = await request<{ source: string }>(`/source?path=${encodeURIComponent(file.path)}`)
      if (!opened || turn !== generation || screenVersion !== owner) return
      currentFile = file
      currentSource = result.source
      message = ''
      if (section) {
        if (draft.path !== file.path || draft.section !== section.elementId) {
          draft = { name: file.name, path: file.path, source: result.source, section: section.elementId }
          draftRevision++
        }
        startPageEdit()
        const editor = panel.querySelector<HTMLTextAreaElement>('#edit-page-source')!
        const offset = draft.source.split('\n').slice(0, section.line - 1).reduce((offset, line) => offset + line.length + 1, 0)
        editor.setSelectionRange(offset, offset)
        return
      }
      if (draft.path === file.path && draft.section) {
        draft = { ...draft, section: undefined }
        draftRevision++
      }
      setView('file')
      render()
      focusSearch()
    } catch (error) {
      if (opened && turn === generation && screenVersion === owner) notify(error instanceof Error ? error.message : String(error))
    } finally {
      busy = false
      if (opened) render()
    }
  }

  async function review(): Promise<void> {
    if (busy || (view !== 'draft' && view !== 'page-edit')) return
    const turn = generation
    const revision = draftRevision
    const editorView = view
    const editorVersion = screenVersion
    busy = true
    message = ''
    render()
    try {
      const result = await request<PagePreview>('/preview', draft)
      if (!opened || turn !== generation || screenVersion !== editorVersion || view !== editorView || revision !== draftRevision) return
      preview = result
      setView('preview')
    } catch (error) {
      if (opened && turn === generation && screenVersion === editorVersion && view === editorView && revision === draftRevision)
        message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened) {
        render()
        if (turn === generation && atView('preview')) focusSearch()
      }
    }
  }

  async function save(): Promise<void> {
    if (busy || view !== 'preview' || !preview) return
    const turn = generation
    const owner = screenVersion
    const proposed = preview
    const current = () => opened && turn === generation && view === 'preview' && screenVersion === owner && preview === proposed
    busy = true
    message = ''
    render()
    receipt(proposed.hash)
    try {
      const result = await request<PagePreview>('/create', { ...draft, hash: proposed.hash })
      if (!current()) return
      preview = result
      setView('success')
    } catch (error) {
      if (turn === generation && receipt() === proposed.hash) receipt('')
      if (current()) message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened) {
        render()
        if (turn === generation && atView('success')) focusSearch()
      }
    }
  }

  function showPanel(): void {
    behavior.captureFocus()
    opened = true
    navigation.watch(next => {
      if (view !== 'tabs-draft' && view !== 'tabs-preview') return
      if (tabsDraft.instance) {
        tabsPreview = null
        setView('tabs-draft')
        render()
        return
      }
      const page = report?.pageRoutes.find(page => normalizePath(page.routePath) === next)
      tabsDraft = { ...tabsDraft, page: page?.file ?? '', routePath: page?.routePath ?? '' }
      tabsPreview = null
      message = ''
      setView('tabs-draft')
      render()
    })
  }
  function open(): void {
    if (opened || disposed) return
    showPanel()
    void scan()
    panel.focus()
  }
  function close(): void {
    behavior.stopDrag()
    if (view === 'success') receipt('')
    if (view === 'section-success') installReceipt('')
    if (view.startsWith('tabs-') && !busy) tabsReceipt(null)
    opened = false
    generation++
    controller?.abort()
    window.clearTimeout(scanTimer)
    navigation.stop()
    render()
    behavior.restoreFocus()
  }
  const recoveryTurn = generation
  const pendingTabs = tabsReceipt()
  if (pendingTabs?.draft && Array.isArray(pendingTabs.draft.items)) {
    tabsDraft = pendingTabs.draft
    if (pendingTabs.hash && /^[a-f0-9]{64}$/.test(pendingTabs.hash)) {
      void configuration
        .catch(() => {})
        .then(async () => {
          if (generation !== recoveryTurn || opened || !host.isConnected) return
          try {
            const result = await request<TabsPreview>(`/tabs/creation?hash=${pendingTabs.hash}`)
            if (tabsReceipt()?.hash !== pendingTabs.hash || opened || generation !== recoveryTurn || !host.isConnected) return
            tabsPreview = result
            setView('tabs-success')
            showPanel()
            render()
            focusSearch()
          } catch {
            if (generation === recoveryTurn && tabsReceipt()?.hash === pendingTabs.hash) tabsReceipt(null)
          }
        })
    } else {
      resumeTabs = true
      open()
    }
  }
  const pendingInstall = installReceipt()
  if (pendingInstall && /^[a-f0-9]{64}$/.test(pendingInstall)) {
    void configuration
      .catch(() => {})
      .then(async () => {
        if (generation !== recoveryTurn || opened || !host.isConnected) return
        try {
          const result = await request<SectionInstallPreview>(`/install/creation?hash=${pendingInstall}`)
          if (installReceipt() !== pendingInstall || opened || generation !== recoveryTurn || !host.isConnected) return
          sectionPreview = result
          setView('section-success')
          showPanel()
          render()
          focusSearch()
        } catch {
          if (generation === recoveryTurn && installReceipt() === pendingInstall) installReceipt('')
        }
      })
  }
  const pendingHash = receipt()
  if (pendingHash && /^[a-f0-9]{64}$/.test(pendingHash)) {
    void configuration
      .catch(() => {})
      .then(async () => {
        if (generation !== recoveryTurn || opened || !host.isConnected) return
        try {
          const result = await request<PagePreview>(`/creation?hash=${pendingHash}`)
          if (receipt() !== pendingHash || opened || generation !== recoveryTurn || !host.isConnected) return
          preview = result
          draft = {
            name: result.path
              .split('/')
              .at(-1)!
              .replace(/\.btsx$/, ''),
            source: result.source,
            routePath: result.routePath,
            navLabel: result.navLabel,
            section: result.section,
            ...(result.files.length === 1 && result.files[0]?.action === 'edit' ? { path: result.path } : {})
          }
          setView('success')
          showPanel()
          render()
          focusSearch()
        } catch {
          if (generation === recoveryTurn && receipt() === pendingHash) receipt('')
        }
      })
  }
  return () => {
    if (disposed) return
    disposed = true
    opened = false
    generation++
    controller?.abort()
    window.clearTimeout(scanTimer)
    navigation.stop()
    preferences.dispose()
    behavior.dispose()
  }
}
