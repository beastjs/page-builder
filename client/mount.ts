import {
  BASE,
  type ClientConfig,
  type DetectedCollection,
  type ItemType,
  type PageDraft,
  type PagePreview,
  type PageRoute,
  type ProjectFile,
  type ProjectScan,
  type TabComponent,
  type TabInstance,
  type TabsDraft,
  type TabsPreview,
} from '../shared/types.js'
import HexTrace from '../src/components/loaders/HexTrace'
import { createRoot, flushSync, type Root } from 'octane'
import TabsEditor from './tabs/TabsEditor.btsx'
import Palette from './palette/Palette.btsx'
import PageEditor from './pages/PageEditor.btsx'
import type { PageEditorProps } from './pages/types.js'
import { insertSection } from './pages/model.js'
import { paletteActions } from './palette/actions.js'
import type { PaletteProps, PaletteTab } from './palette/types.js'
import { icon } from './icons.js'
import { newTab, tabKey } from './tabs/model.js'
import type { TabsEditorProps } from './tabs/types.js'
import { sectionLibrary, templates } from './templates.js'
import css from './widget.css'

const HOST_ID = 'beast-page-builder'
const defaults: ClientConfig = {
  shortcut: 'Mod+B',
  position: 'center',
  theme: 'light',
  scanDuration: 1600,
  launcher: true,
  pagesDir: 'src/pages',
  routerFile: 'src/router.ts'
}
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

function sonar(): string {
  const cells: string[] = []
  for (let row = 0; row < 9; row++)
    for (let col = 0; col < 15; col++) {
      const x = 12 + col * 22 + (row % 2) * 11
      const y = 12 + row * 19
      const distance = Math.hypot(x - 171, y - 88)
      const opacity = Math.max(0.12, 0.85 - distance / 210)
      cells.push(
        `<polygon points="${x},${y - 12} ${x + 10},${y - 6} ${x + 10},${y + 6} ${x},${y + 12} ${x - 10},${y + 6} ${x - 10},${y - 6}" style="--delay:${Math.round(distance * 5)}ms;--cell-opacity:${opacity}"/>`
      )
    }
  return `<div class="sonar"> <svg viewBox="0 0 344 180" aria-hidden="true">${cells.join('')}</svg><div class="sonar-core hex-frame"></div></div>`
}

function mount(): void {
  if (document.getElementById(HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${css}</style><div class="widget" data-theme="light" data-position="center"><button class="launcher" aria-label="Open Beast page builder">${icon('hex')}<span>Builder</span><kbd>⌘ B</kbd></button><div class="backdrop" hidden></div><section class="panel" role="dialog" aria-modal="true" aria-label="Beast page builder" hidden></section></div>`
  const widget = shadow.querySelector<HTMLElement>('.widget')!
  const panel = shadow.querySelector<HTMLElement>('.panel')!
  const backdrop = shadow.querySelector<HTMLElement>('.backdrop')!
  const launcher = shadow.querySelector<HTMLButtonElement>('.launcher')!
  let panelPosition: { x: number; y: number } | null = null
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null

  function positionPanel(): void {
    if (!panelPosition || panel.hidden) return
    panel.dataset.moved = ''
    const gutter = 8
    panelPosition.x = Math.max(gutter, Math.min(panelPosition.x, innerWidth - panel.offsetWidth - gutter))
    panelPosition.y = Math.max(gutter, Math.min(panelPosition.y, innerHeight - panel.offsetHeight - gutter))
    panel.style.setProperty('--builder-left', `${panelPosition.x}px`)
    panel.style.setProperty('--builder-top', `${panelPosition.y}px`)
  }
  function stopDrag(event?: PointerEvent): void {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    const { pointerId } = drag
    drag = null
    delete panel.dataset.dragging
    if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId)
  }
  // Delegate to the stable panel: switching views replaces the header during a drag.
  panel.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || drag) return
    const target = event.target instanceof Element ? event.target : null
    if (!target?.closest('.searchbar, .scan-header, .topbar')) return
    if (target.closest('button, input, textarea, select, a, summary, [contenteditable]') && !target.closest('.move'))
      return
    event.preventDefault()
    target.closest<HTMLElement>('.move')?.focus({ preventScroll: true })
    const box = panel.getBoundingClientRect()
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top }
    panelPosition = { x: box.left, y: box.top }
    positionPanel()
    panel.dataset.dragging = ''
    panel.setPointerCapture(event.pointerId)
  })
  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    panelPosition = { x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y }
    positionPanel()
  })
  panel.addEventListener('pointerup', stopDrag)
  panel.addEventListener('pointercancel', stopDrag)
  panel.addEventListener('lostpointercapture', stopDrag)
  panel.addEventListener('keydown', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.move')) return
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Home') {
      panelPosition = null
      delete panel.dataset.moved
      panel.style.removeProperty('--builder-left')
      panel.style.removeProperty('--builder-top')
      return
    }
    const box = panel.getBoundingClientRect()
    const step = event.shiftKey ? 40 : 10
    panelPosition = {
      x: box.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      y: box.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
    }
    positionPanel()
  })
  const panelResizeObserver = new ResizeObserver(positionPanel)
  panelResizeObserver.observe(panel)
  window.addEventListener('resize', positionPanel)
  // Vite's script URL carries its base; bundled Rspack/Rsbuild entries use the root endpoint.
  const scriptUrl = new URL(import.meta.url)
  const apiBase = scriptUrl.pathname.endsWith(`${BASE}/client.js`)
    ? scriptUrl.pathname.replace(/\/client\.js$/, '')
    : BASE
  const receiptKey = `beast-page-builder:save:${apiBase}`
  const themeKey = `beast-page-builder:theme:${apiBase}`
  const launcherKey = `beast-page-builder:launcher:${apiBase}`
  const systemTheme = matchMedia('(prefers-color-scheme: dark)')
  let themeOverride: 'light' | 'dark' | null = null
  try {
    const saved = localStorage.getItem(themeKey)
    if (saved === 'light' || saved === 'dark') themeOverride = saved
  } catch {
    /* The toggle still works when browser storage is unavailable. */
  }
  let launcherOverride: boolean | null = null
  try {
    const saved = localStorage.getItem(launcherKey)
    if (saved === 'true' || saved === 'false') launcherOverride = saved === 'true'
  } catch {
    /* Launcher visibility can still be changed for this session. */
  }
  function receipt(value?: string): string | null {
    try {
      if (value === '') sessionStorage.removeItem(receiptKey)
      else if (value) sessionStorage.setItem(receiptKey, value)
      return sessionStorage.getItem(receiptKey)
    } catch {
      return null
    }
  }
  let config = defaults
  let report: ProjectScan | null = null
  let opened = false
  let view:
    | 'scan'
    | 'palette'
    | 'draft'
    | 'page-edit'
    | 'file'
    | 'collection'
    | 'preview'
    | 'success'
    | 'tabs-draft'
    | 'tabs-preview'
    | 'tabs-success'
    | 'error' = 'palette'
  let tab: PaletteTab = 'All'
  let query = ''
  let selected = 0
  let previousFocus: HTMLElement | null = null
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
  let routeTimer: number | undefined
  let tabsDraft: TabsDraft = { page: '', routePath: '', component: '', items: [], active: '', label: 'Tabs' }
  let tabsPreview: TabsPreview | null = null
  let tabsRoot: Root | undefined
  let paletteRoot: Root | undefined
  let pageRoot: Root | undefined
  let draftRevision = 0
  let resumeTabs = false
  const routePrefix = apiBase.slice(0, -BASE.length)
  const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/'
  const currentPath = () => normalizePath(location.pathname.slice(routePrefix.length))
  const tabsComponent = () => report?.tabComponents.find((component) => component.id === tabsDraft.component)
  const tabsPage = () =>
    report?.pageRoutes.find((page) => page.file === tabsDraft.page && page.routePath === tabsDraft.routePath)
  const tabsReady = () =>
    !!tabsPage() &&
    currentPath() === normalizePath(tabsDraft.routePath) &&
    !!tabsComponent() &&
    !tabsComponent()!.reason
  const tabsReceiptKey = `beast-page-builder:tabs:${apiBase}`
  function tabsReceipt(value?: { draft: TabsDraft; hash?: string } | null): { draft: TabsDraft; hash?: string } | null {
    try {
      if (value === null) sessionStorage.removeItem(tabsReceiptKey)
      else if (value) sessionStorage.setItem(tabsReceiptKey, JSON.stringify(value))
      return JSON.parse(sessionStorage.getItem(tabsReceiptKey) ?? 'null')
    } catch {
      return null
    }
  }
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const shortcutLabel = () =>
    config.shortcut
      .replace('Mod', isMac ? '⌘' : 'Ctrl')
      .replace('Meta', '⌘')
      .replaceAll('+', ' ')

  async function request<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${apiBase}${route}`, {
      signal,
      ...(body === undefined
        ? {}
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
    return data as T
  }

  const isDark = () =>
    (themeOverride ?? config.theme) === 'dark' || ((themeOverride ?? config.theme) === 'auto' && systemTheme.matches)
  function applyTheme(): void {
    widget.dataset.theme = themeOverride ?? config.theme
    if ((view === 'draft' || view === 'page-edit') && pageRoot) {
      renderPageEditor()
      return
    }
    if (view === 'tabs-draft' && tabsRoot) {
      renderTabsForm()
      return
    }
    if (view === 'palette' && paletteRoot) {
      renderPalette()
      return
    }
    const button = panel.querySelector<HTMLButtonElement>('.theme-toggle')
    if (button) {
      button.setAttribute('aria-pressed', String(isDark()))
      button.title = isDark() ? 'Switch to light mode' : 'Switch to dark mode'
      button.innerHTML = icon(isDark() ? 'sun' : 'moon')
    }
  }
  panel.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.theme-toggle')) return
    themeOverride = isDark() ? 'light' : 'dark'
    try {
      localStorage.setItem(themeKey, themeOverride)
    } catch {
      /* Keep the in-memory preference. */
    }
    applyTheme()
  })
  systemTheme.addEventListener('change', applyTheme)

  function toggleLauncher(): void {
    launcherOverride = launcher.hidden
    launcher.hidden = !launcherOverride
    try {
      localStorage.setItem(launcherKey, String(launcherOverride))
    } catch {
      /* Keep the in-memory preference. */
    }
    query = ''
    selected = 0
    message = launcher.hidden ? `Launcher hidden. Open the builder with ${shortcutLabel()}.` : 'Launcher shown.'
    render()
    focusSearch()
  }

  function applyConfig(): void {
    applyTheme()
    widget.dataset.position = config.position
    launcher.hidden = !(launcherOverride ?? config.launcher)
    launcher.querySelector('kbd')!.textContent = shortcutLabel()
  }
  const configuration = request<ClientConfig>('/config').then((value) => {
    config = value
    applyConfig()
  })
  // Keep the shortcut and launcher usable if the development server is temporarily restarting.
  void configuration.catch(() => {})
  applyConfig()

  const projectName = () => escape(report?.name ?? 'initializing')
  const closeButton = () => `<button class="icon-button close" aria-label="Close builder">${icon('close')}</button>`
  const moveHandle = () =>
    `<button class="icon-button move" aria-label="Move builder" title="Drag to move. Arrow keys move; Home resets position.">${icon('grip')}</button>`
  const header = (title: string, subtitle = '') =>
    `<header class="topbar"><button class="icon-button back" aria-label="Back to builder">${icon('back')}</button><div class="header-text"><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${moveHandle()}${closeButton()}</header>`
  const themeToggle = () =>
    `<button type="button" class="icon-button-small theme-toggle" aria-label="Dark mode" aria-pressed="${isDark()}" title="${isDark() ? 'Switch to light mode' : 'Switch to dark mode'}">${icon(isDark() ? 'sun' : 'moon')}</button>`
  const footer = () =>
    `<footer class="footer"><span class="project-chip">${icon('logo')}${projectName()}</span><span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Select</span>${themeToggle()}</footer>`
  const notify = (text: string) => {
    message = text
    if (view === 'palette' && paletteRoot) {
      renderPalette()
      return
    }
    if ((view === 'draft' || view === 'page-edit') && pageRoot) {
      renderPageEditor()
      return
    }
    const target = panel.querySelector<HTMLElement>('.message')
    if (target) target.textContent = text
  }

  function enter(elements: NodeListOf<HTMLElement>, delay = 0): void {
    elements.forEach((element, index) => {
      element.classList.add('builder-enter')
      element.style.setProperty('--enter-delay', `${delay + Math.min(index, 5) * 24}ms`)
    })
  }

  function render(): void {
    if (view !== 'palette' && paletteRoot) {
      paletteRoot.unmount()
      paletteRoot = undefined
    }
    if (view !== 'tabs-draft' && tabsRoot) {
      tabsRoot.unmount()
      tabsRoot = undefined
    }
    if (view !== 'draft' && view !== 'page-edit' && pageRoot) {
      pageRoot.unmount()
      pageRoot = undefined
    }
    const entering = panel.dataset.view !== view
    panel.dataset.view = view
    if (view === 'scan') {
      panel.innerHTML = `<header class="scan-header"><span class="brand">${icon('hex')} Beast <span class="muted">/ Page builder</span></span>${moveHandle()}${closeButton()}</header><div class="scan-body">${sonar()}<span class="eyebrow">CONNECTING THE DOTS</span><h2>Getting to know your project</h2><p class="scan-label" role="status">Looking for pages, menus, and tabs…</p><div class="scan-progress"><i></i></div><span class="scan-note">A little scan. A lot of possibilities.</span></div>${footer()}`
      panel.querySelector('.sonar-core')!.append(HexTrace({ size: 32 }, shadow))
    } else if (view === 'palette') {
      renderPalette()
    } else if (view === 'draft' || view === 'page-edit') {
      renderPageEditor()
    } else if (view === 'tabs-draft') {
      renderTabsForm()
    } else if (view === 'preview' || view === 'tabs-preview') {
      const isTabs = view === 'tabs-preview'
      const proposed = isTabs ? tabsPreview! : preview!
      panel.innerHTML = `${header('One last look', escape(proposed.path))}<div class="preview-body"><div class="validation">${icon('check')} Compiles with Beast and Octane</div>${proposed.files.map((file) => `<details class="planned-file" open><summary>${icon(file.action === 'create' ? 'plus' : 'page')}<span>${escape(file.path)}</span><small>${file.action === 'create' ? 'New file' : 'Update'}</small></summary><pre class="source-preview" tabindex="0" aria-label="Proposed ${escape(file.path)}"><code>${escape(file.source)}</code></pre>${file.before !== null ? `<details class="original-file"><summary>Current source</summary><pre class="source-preview" tabindex="0"><code>${escape(file.before)}</code></pre></details>` : ''}</details>`).join('')}<div class="message" role="status">${escape(message)}</div><p class="hint">${isTabs ? (tabsDraft.instance ? 'Updates this tab group in place.' : 'Adds the Tabs component and its items to this page.') : draft.path ? 'Updates the existing page source.' : 'Creates the page and updates the route and navigation together.'}</p></div><footer class="action-footer"><span>${proposed.files.length} files · ${escape(proposed.routePath)}</span><button class="primary save" ${busy || (isTabs && !tabsReady()) ? 'disabled' : ''}>${busy ? 'Saving…' : isTabs ? (tabsDraft.instance ? 'Save tabs' : 'Add Tabs') : draft.path ? 'Save page' : 'Create page'} ${icon('plus')}</button></footer>`
      panel.querySelector('.save')!.addEventListener('click', () => void (isTabs ? saveTabs() : save()))
    } else if (view === 'file') {
      panel.innerHTML = `${header(escape(currentFile!.name), escape(currentFile!.path))}<div class="preview-body">${renderFileTabs()}${currentFile!.error ? `<p class="error-note">${escape(currentFile!.error)}</p>` : ''}<pre class="source-preview" tabindex="0"><code>${escape(currentSource)}</code></pre><div class="message" role="status"></div></div><footer class="action-footer"><span>${currentFile!.lines} lines · ${currentFile!.components.length} component${currentFile!.components.length === 1 ? '' : 's'}</span><div class="file-actions"><button class="secondary copy">Copy source</button>${currentFile!.kind === 'page' ? '<button class="primary edit-page">Edit page</button>' : ''}</div></footer>`
      panel.querySelector('.copy')!.addEventListener('click', () => {
        void navigator.clipboard
          .writeText(currentSource)
          .then(() => notify('Source copied.'))
          .catch(() => notify('Could not access the clipboard. Select the source to copy it.'))
      })
      panel.querySelector('.edit-page')?.addEventListener('click', startPageEdit)
      panel
        .querySelectorAll<HTMLButtonElement>('[data-edit-tabs]')
        .forEach((button) =>
          button.addEventListener('click', () =>
            startEditingTabs(report!.tabInstances.find((instance) => instance.id === button.dataset.editTabs)!)
          )
        )
    } else if (view === 'collection') {
      const collection = currentCollection!
      panel.innerHTML = `${header(escape(collection.name), escape(collection.file) + ':' + collection.line)}<div class="preview-body collection-body"><div class="collection-meta"><span class="type-badge">${collection.kind === 'tabs' ? 'Tabs' : 'Navigation'}</span><span>${collection.source === 'data' ? 'Shared data' : 'Rendered markup'} · ${collection.items.length} items</span></div><h3>Item type</h3>${renderType(collection.itemType)}${collection.bindings.length ? `<p class="hint">Data binding: <code>${escape(collection.bindings.join(', '))}</code></p>` : ''}${collection.reason ? `<p class="hint">${escape(collection.reason)}</p>` : ''}${collection.consumers.length ? `<h3>Used by</h3><ul class="consumer-list">${collection.consumers.map((consumer) => `<li><code>${escape(consumer.file)}:${consumer.line}</code> · ${escape(consumer.name)}</li>`).join('')}</ul>` : ''}<h3>Items</h3>${collection.items.map((item) => `<details class="detected-item"><summary><span>${escape(item.label)}</span><span class="type-badge">${escape(item.kind.replaceAll('-', ' '))}</span></summary><div class="item-body"><p class="hint">${item.component ? `Component: <code>${escape(item.component)}</code> · ` : ''}Line ${item.line}${item.destination ? ` · Destination: <code>${escape(item.destination)}</code>` : ''}${item.value ? ` · Value: <code>${escape(item.value)}</code>` : ''}</p>${renderType(item.itemType)}</div></details>`).join('') || '<p class="hint">No literal items found. The group may populate its items at runtime.</p>'}</div><footer class="action-footer"><span>${collection.editable && collection.kind === 'navigation' ? 'Available for new page links' : 'Inspect item types and source bindings'}</span></footer>`
    } else if (view === 'tabs-success') {
      panel.innerHTML = `${header(tabsDraft.instance ? 'Tabs updated' : 'Tabs added', escape(tabsPreview!.path))}<div class="success-body"><div class="success-icon">${icon('check')}</div><h2>Your tabs are ready.</h2><p>${tabsDraft.items.length} tabs ${tabsDraft.instance ? 'updated on' : 'added to'} <strong>${escape(tabsPreview!.routePath)}</strong>.</p><button class="secondary done">Back to builder ${icon('arrow')}</button></div>${footer()}`
      panel.querySelector('.done')!.addEventListener('click', () => {
        tabsReceipt(null)
        tabsPreview = null
        tabsDraft.items = []
        delete tabsDraft.instance
        void scan()
      })
    } else if (view === 'success') {
      panel.innerHTML = `${header(draft.path ? 'Page updated' : 'Your idea has a home', escape(preview!.path))}<div class="success-body"><div class="success-icon">${icon('check')}</div><span class="eyebrow">READY FOR WHAT’S NEXT</span><h2>${escape(draft.name)} is ${draft.path ? 'updated' : 'created'}.</h2><p>${draft.path ? 'Your page changes are saved.' : 'Your route and navigation link are ready.'}${preview!.routePath ? '<br>Find it at <strong>' + escape(preview!.routePath) + '</strong>.' : ''}</p>${preview!.routePath ? `<a class="primary visit" href="${escape(apiBase.slice(0, -BASE.length) + preview!.routePath)}">Open page ${icon('arrow')}</a>` : ''}<button class="secondary edit-saved-page">Edit page</button><button class="secondary done">Back to builder ${icon('arrow')}</button></div>${footer()}`
      panel.querySelector('.visit')?.addEventListener('click', () => {
        receipt('')
      })
      panel.querySelector('.edit-saved-page')!.addEventListener('click', () => {
        receipt('')
        currentFile = {
          path: preview!.path,
          name: draft.name,
          kind: 'page',
          lines: preview!.source.split('\n').length,
          components: [draft.name],
          error: null
        }
        currentSource = preview!.source
        startPageEdit()
      })
      panel.querySelector('.done')!.addEventListener('click', () => {
        receipt('')
        draft = { name: 'UntitledPage', source: templates.blank }
        preview = null
        void scan()
      })
    } else {
      panel.innerHTML = `${header('Couldn’t connect to your project')}<div class="error-body">${icon('scan')}<h2>Let’s try that again.</h2><p class="error-note" role="alert">${escape(message)}</p><button class="primary retry">Scan project ${icon('scan')}</button></div>${footer()}`
      panel.querySelector('.retry')!.addEventListener('click', () => void scan())
    }
    if (view !== 'tabs-draft' && view !== 'draft' && view !== 'page-edit') panel.querySelector('.action-footer')?.insertAdjacentHTML('beforeend', themeToggle())
    if (entering) {
      enter(panel.querySelectorAll<HTMLElement>(':scope > header, :scope > nav, :scope > footer'))
      enter(
        panel.querySelectorAll<HTMLElement>(
          '.scan-body > *, .draft-body > :not(.message), .preview-body > :not(.message), .success-body > *, .error-body > *'
        ),
        36
      )
    }
    positionPanel()
    if (view === 'tabs-draft' || view === 'palette' || view === 'draft' || view === 'page-edit') return
    panel.querySelector('.close')?.addEventListener('click', close)
    panel.querySelector('.back')?.addEventListener('click', () => {
      message = ''
      if (view === 'tabs-draft' || view === 'tabs-success') tabsReceipt(null)
      view =
        view === 'preview' ? (draft.path ? 'page-edit' : 'draft') : view === 'tabs-preview' ? 'tabs-draft' : 'palette'
      if (!report) {
        void scan()
        return
      }
      render()
      focusSearch()
    })
  }

  function startPageEdit(): void {
    if (draft.path !== currentFile!.path) {
      draft = { name: currentFile!.name, path: currentFile!.path, source: currentSource }
      draftRevision++
    }
    preview = null
    message = ''
    view = 'page-edit'
    render()
    panel.querySelector<HTMLTextAreaElement>('#edit-page-source')!.focus()
  }
  function renderFileTabs(): string {
    const instances = report?.tabInstances.filter((instance) => instance.page === currentFile!.path) ?? []
    if (!instances.length) return ''
    return `<div class="existing-tabs"><h3>Tabs on this page</h3>${instances.map((instance) => (instance.draft ? `<button class="secondary" data-edit-tabs="${escape(instance.id)}">Edit tabs · ${escape(instance.draft.label || 'Tabs')} · Line ${instance.line}</button>` : `<p class="hint">Line ${instance.line}: ${escape(instance.reason ?? 'Edit these tabs in the page source.')}</p>`)).join('')}</div>`
  }
  function startEditingTabs(instance: TabInstance): void {
    if (!instance.draft) return
    tabsDraft = structuredClone(instance.draft)
    tabsPreview = null
    message = ''
    view = 'tabs-draft'
    const page = tabsPage()
    if (page && currentPath() !== normalizePath(page.routePath)) {
      choosePage(page)
      return
    }
    render()
    panel.querySelector<HTMLInputElement>('[data-field]')?.focus()
  }

  function renderType(type: ItemType): string {
    return `<div class="type-contract"><div class="type-title"><code>${escape(type.name)}</code><span class="type-badge">${type.origin === 'declared' ? 'Declared type' : 'Inferred shape'}</span></div>${type.fields.length ? `<div class="fields-scroll"><table class="type-fields"><thead><tr><th>Field</th><th>Type</th><th>Presence</th></tr></thead><tbody>${type.fields.map((field) => `<tr><td><code>${escape(field.name)}</code></td><td><code>${escape(field.type)}</code></td><td>${field.optional ? 'Optional' : 'Required'}</td></tr>`).join('')}</tbody></table></div>` : ''}${type.variants?.length ? `<details class="type-variants"><summary>${type.variants.length} item variants</summary>${type.variants.map((variant) => renderType(variant)).join('')}</details>` : ''}</div>`
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
    view = 'tabs-draft'
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
    location.assign(routePrefix + page.routePath)
  }
  function renderTabsForm(): void {
    if (!tabsRoot) {
      panel.replaceChildren()
      tabsRoot = createRoot(panel)
    }
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
          renderTabsForm()
        }
      },
      onChoosePage: choosePage,
      onReview: reviewTabs,
      onBack() {
        message = ''
        tabsReceipt(null)
        view = 'palette'
        render()
        focusSearch()
      },
      onClose: close
    }
    // The shell positions, animates, and focuses the view immediately after render.
    flushSync(() => tabsRoot!.render(TabsEditor, props))
  }

  async function reviewTabs(): Promise<void> {
    if (busy || !tabsReady() || !panel.querySelector<HTMLFormElement>('.tabs-form')?.reportValidity()) return
    const turn = generation
    busy = true
    message = ''
    render()
    try {
      const result = await request<TabsPreview>('/tabs/preview', tabsDraft)
      if (!opened || turn !== generation || !tabsReady()) return
      tabsPreview = result
      view = 'tabs-preview'
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened && turn === generation) {
        render()
        focusSearch()
      }
    }
  }
  async function saveTabs(): Promise<void> {
    if (busy || !tabsPreview || !tabsReady()) return
    const turn = generation
    busy = true
    message = ''
    render()
    tabsReceipt({ draft: tabsDraft, hash: tabsPreview.hash })
    try {
      tabsPreview = await request<TabsPreview>('/tabs/create', { ...tabsDraft, hash: tabsPreview.hash })
      if (opened && turn === generation) view = 'tabs-success'
    } catch (error) {
      tabsReceipt(null)
      message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened && turn === generation) {
        render()
        focusSearch()
      }
    }
  }

  function renderPageEditor(): void {
    if (!pageRoot) {
      panel.replaceChildren()
      pageRoot = createRoot(panel)
    }
    const props: PageEditorProps = {
      draft, pagesDir: config.pagesDir, targets: report?.navigationTargets ?? [], dark: isDark(), busy, message,
      onDraftChange(next) {
        if (next === draft) return
        draftRevision++
        draft = next
        preview = null
        // Commit controlled values before native input restoration, even just after mounting.
        renderPageEditor()
      },
      onReview: review,
      onClearMessage() { message = ''; renderPageEditor() },
      onBack() {
        message = ''
        view = 'palette'
        render()
        focusSearch()
      },
      onClose: close
    }
    flushSync(() => pageRoot!.render(PageEditor, props))
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
    view = 'draft'
    message = ''
    render()
    panel.querySelector<HTMLInputElement>('#page-name')!.focus()
  }

  function renderPalette(): void {
    if (!paletteRoot) {
      panel.replaceChildren()
      paletteRoot = createRoot(panel)
    }
    const actions = paletteActions({
      report, tab, query, launcherHidden: launcher.hidden, shortcut: shortcutLabel(), sections: sectionLibrary,
      handlers: {
        createPage() {
          createPage()
          panel.querySelector<HTMLInputElement>('#page-name')!.select()
        },
        addTabs: startTabs,
        scan: () => void scan(),
        toggleLauncher,
        editTabs: startEditingTabs,
        openFile: (file) => void openFile(file),
        addSection(snippet) {
          if (draft.path) draft = { name: 'UntitledPage', source: templates.blank }
          appendSection(snippet)
          createPage()
        },
        openCollection(collection) {
          currentCollection = collection
          view = 'collection'
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
        renderPalette()
      },
      onTabChange(next) {
        tab = next
        selected = 0
        renderPalette()
        focusSearch()
      },
      onSelect(index) {
        selected = index
        renderPalette()
      },
      onCreate: createPage,
      onClose: close
    }
    flushSync(() => paletteRoot!.render(Palette, props))
    positionPanel()
  }

  function focusSearch(): void {
    ;(panel.querySelector<HTMLElement>('.search') ?? panel.querySelector<HTMLElement>('button'))?.focus()
  }
  async function scan(): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const turn = ++generation
    view = 'scan'
    message = ''
    render()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const timer = window.setTimeout(() => {
      if (view === 'scan' && turn === generation)
        panel.querySelector('.scan-label')!.textContent = 'Resolving menus, tabs, and item types…'
    }, 650)
    scanTimer = timer
    try {
      config = await request<ClientConfig>('/config', undefined, signal)
      applyConfig()
      const next = await request<ProjectScan>('/scan', undefined, signal)
      const duration = reduced ? 0 : config.scanDuration
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, Math.max(0, duration - (performance.now() - start)))
      )
      if (!opened || turn !== generation) return
      report = next
      view = 'palette'
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
      view = 'error'
      render()
      focusSearch()
    } finally {
      window.clearTimeout(timer)
    }
  }

  async function openFile(file: ProjectFile): Promise<void> {
    if (busy) return
    const turn = generation
    busy = true
    try {
      const result = await request<{ source: string }>(`/source?path=${encodeURIComponent(file.path)}`)
      if (!opened || turn !== generation) return
      currentFile = file
      currentSource = result.source
      view = 'file'
      render()
      focusSearch()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally {
      busy = false
    }
  }

  async function review(): Promise<void> {
    if (busy || (view !== 'draft' && view !== 'page-edit')) return
    const turn = generation
    const revision = draftRevision
    const editorView = view
    const editorRoot = pageRoot
    busy = true
    message = ''
    render()
    try {
      const result = await request<PagePreview>('/preview', draft)
      if (!opened || turn !== generation || pageRoot !== editorRoot || view !== editorView || revision !== draftRevision) return
      preview = result
      view = 'preview'
    } catch (error) {
      if (opened && turn === generation && pageRoot === editorRoot && view === editorView && revision === draftRevision)
        message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened && turn === generation) {
        render()
        if (view === 'preview') focusSearch()
      }
    }
  }

  async function save(): Promise<void> {
    if (busy || !preview) return
    const turn = generation
    busy = true
    message = ''
    render()
    receipt(preview.hash)
    try {
      preview = await request<PagePreview>('/create', { ...draft, hash: preview.hash })
      if (opened && turn === generation) view = 'success'
    } catch (error) {
      receipt('')
      message = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      if (opened && turn === generation) {
        render()
        focusSearch()
      }
    }
  }

  function open(): void {
    if (opened) return
    const active = shadow.activeElement ?? document.activeElement
    previousFocus = active instanceof HTMLElement ? active : null
    opened = true
    delete panel.dataset.view
    panel.hidden = false
    backdrop.hidden = false
    launcher.setAttribute('aria-expanded', 'true')
    let path = currentPath()
    window.clearInterval(routeTimer)
    routeTimer = window.setInterval(() => {
      const next = currentPath()
      if (next === path) return
      path = next
      if (view !== 'tabs-draft' && view !== 'tabs-preview') return
      if (tabsDraft.instance) {
        tabsPreview = null
        view = 'tabs-draft'
        render()
        return
      }
      const page = report?.pageRoutes.find((page) => normalizePath(page.routePath) === next)
      tabsDraft.page = page?.file ?? ''
      tabsDraft.routePath = page?.routePath ?? ''
      tabsPreview = null
      message = ''
      view = 'tabs-draft'
      render()
    }, 250)
    void scan()
    panel.focus()
  }
  function close(): void {
    stopDrag()
    if (view === 'success') receipt('')
    if (view.startsWith('tabs-') && !busy) tabsReceipt(null)
    opened = false
    generation++
    controller?.abort()
    window.clearTimeout(scanTimer)
    window.clearInterval(routeTimer)
    panel.hidden = true
    backdrop.hidden = true
    launcher.setAttribute('aria-expanded', 'false')
    previousFocus?.focus()
  }
  panel.tabIndex = -1
  launcher.setAttribute('aria-expanded', 'false')
  launcher.addEventListener('click', open)
  backdrop.addEventListener('click', close)
  function keydown(event: KeyboardEvent): void {
    const [modifier, ...parts] = config.shortcut.split('+')
    const key = parts.at(-1)!.toLowerCase()
    const mod =
      modifier === 'Meta'
        ? event.metaKey && !event.ctrlKey
        : modifier === 'Ctrl'
          ? event.ctrlKey && !event.metaKey
          : isMac
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey
    if (event.key.toLowerCase() === key && mod && event.shiftKey === parts.includes('Shift') && !event.altKey) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat) opened ? close() : open()
      return
    }
    if (!opened) return
    if (event.key === 'Escape' && view === 'tabs-draft') {
      const picker = panel.querySelector<HTMLInputElement>('#tabs-page')
      if (picker?.getAttribute('aria-expanded') === 'true') {
        event.preventDefault()
        event.stopImmediatePropagation()
        picker.dispatchEvent(new Event('builder:close-picker'))
        return
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
      return
    }
    if (event.key === 'Tab') {
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, textarea, select, a[href], summary, [tabindex="0"]'
        )
      ].filter((element) => element.getClientRects().length)
      const current = shadow.activeElement
      const first = focusable[0],
        last = focusable.at(-1)
      if (event.shiftKey && (current === first || current === panel)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (current === last || current === panel)) {
        event.preventDefault()
        first?.focus()
      }
    }
  }
  window.addEventListener('keydown', keydown, true)
  // Clean up if an app's DOM ownership removes the mount during HMR or navigation.
  const observer = new MutationObserver(() => {
    if (host.isConnected) return
    pageRoot?.unmount()
    pageRoot = undefined
    tabsRoot?.unmount()
    tabsRoot = undefined
    paletteRoot?.unmount()
    paletteRoot = undefined
    controller?.abort()
    generation++
    window.clearTimeout(scanTimer)
    window.clearInterval(routeTimer)
    window.removeEventListener('keydown', keydown, true)
    window.removeEventListener('resize', positionPanel)
    systemTheme.removeEventListener('change', applyTheme)
    panelResizeObserver.disconnect()
    stopDrag()
    observer.disconnect()
  })
  observer.observe(document.body, { childList: true })
  const pendingTabs = tabsReceipt()
  if (pendingTabs?.draft && Array.isArray(pendingTabs.draft.items)) {
    tabsDraft = pendingTabs.draft
    if (pendingTabs.hash && /^[a-f0-9]{64}$/.test(pendingTabs.hash)) {
      void configuration
        .catch(() => {})
        .then(async () => {
          try {
            const result = await request<TabsPreview>(`/tabs/creation?hash=${pendingTabs.hash}`)
            if (tabsReceipt()?.hash !== pendingTabs.hash || opened) return
            tabsPreview = result
            opened = true
            view = 'tabs-success'
            panel.hidden = false
            backdrop.hidden = false
            launcher.setAttribute('aria-expanded', 'true')
            render()
            focusSearch()
          } catch {
            tabsReceipt(null)
          }
        })
    } else {
      resumeTabs = true
      open()
    }
  }
  const pendingHash = receipt()
  if (pendingHash && /^[a-f0-9]{64}$/.test(pendingHash)) {
    void configuration
      .catch(() => {})
      .then(async () => {
        try {
          const result = await request<PagePreview>(`/creation?hash=${pendingHash}`)
          if (receipt() !== pendingHash || opened) return
          preview = result
          draft = {
            name: result.path
              .split('/')
              .at(-1)!
              .replace(/\.btsx$/, ''),
            source: result.source,
            routePath: result.routePath,
            navLabel: result.navLabel,
            ...(result.files.length === 1 && result.files[0]?.action === 'edit' ? { path: result.path } : {})
          }
          opened = true
          view = 'success'
          panel.hidden = false
          backdrop.hidden = false
          launcher.setAttribute('aria-expanded', 'true')
          render()
          focusSearch()
        } catch {
          receipt('')
        }
      })
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
