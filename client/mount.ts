import css from './widget.css'
import { BASE, type DetectedCollection, type ItemType, type ItemField, type ClientConfig, type PageDraft, type PagePreview, type ProjectFile, type ProjectScan, type PageRoute, type TabComponent, type TabsDraft, type TabsPreview, type TabValue } from '../shared/types.js'
import { sections, templates } from './templates.js'

const HOST_ID = 'beast-page-builder'
const suggestPath = (name: string) => '/' + (name.replace(/Page$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase() || 'page')
const suggestLabel = (name: string) => name.replace(/Page$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
const defaults: ClientConfig = { shortcut: 'Mod+B', position: 'center', theme: 'light', scanDuration: 1600, launcher: true, pagesDir: 'src/pages', routerFile: 'src/router.ts' }
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const icons: Record<string, string> = {
  hex: '<path d="m12 2 8.7 5v10L12 22l-8.7-5V7Z"/><path d="m3.3 7 8.7 5 8.7-5M12 12v10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  page: '<path d="M14 3H6v18h12V7Zm0 0v5h5M9 12h6M9 16h6"/>',
  component: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  scan: '<path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M4 12h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
}
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.hex}</svg>`

function sonar(): string {
  const cells: string[] = []
  for (let row = 0; row < 9; row++) for (let col = 0; col < 15; col++) {
    const x = 12 + col * 22 + (row % 2) * 11
    const y = 12 + row * 19
    const distance = Math.hypot(x - 171, y - 88)
    const opacity = Math.max(.12, .85 - distance / 210)
    cells.push(`<polygon points="${x},${y - 12} ${x + 10},${y - 6} ${x + 10},${y + 6} ${x},${y + 12} ${x - 10},${y + 6} ${x - 10},${y - 6}" style="--delay:${Math.round(distance * 5)}ms;--cell-opacity:${opacity}"/>`)
  }
  return `<div class="sonar"> <svg viewBox="0 0 344 180" aria-hidden="true">${cells.join('')}</svg><div class="sonar-core">${icon('hex')}</div></div>`
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
  // Vite's script URL carries its base; bundled Rspack/Rsbuild entries use the root endpoint.
  const scriptUrl = new URL(import.meta.url)
  const apiBase = scriptUrl.pathname.endsWith(`${BASE}/client.js`) ? scriptUrl.pathname.replace(/\/client\.js$/, '') : BASE
  const receiptKey = `beast-page-builder:save:${apiBase}`
  function receipt(value?: string): string | null {
    try {
      if (value === '') sessionStorage.removeItem(receiptKey)
      else if (value) sessionStorage.setItem(receiptKey, value)
      return sessionStorage.getItem(receiptKey)
    } catch { return null }
  }
  let config = defaults
  let report: ProjectScan | null = null
  let opened = false
  let view: 'scan' | 'palette' | 'draft' | 'file' | 'collection' | 'preview' | 'success' | 'tabs-draft' | 'tabs-preview' | 'tabs-success' | 'error' = 'palette'
  let tab = 'All'
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
  let pageQuery = ''
  let pickerOpen = false
  let pickerIndex = 0
  let resumeTabs = false
  const routePrefix = apiBase.slice(0, -BASE.length)
  const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/'
  const currentPath = () => normalizePath(location.pathname.slice(routePrefix.length))
  const tabsComponent = () => report?.tabComponents.find(component => component.id === tabsDraft.component)
  const tabsPage = () => report?.pageRoutes.find(page => page.file === tabsDraft.page && page.routePath === tabsDraft.routePath)
  const tabsReady = () => !!tabsPage() && currentPath() === normalizePath(tabsDraft.routePath) && !!tabsComponent() && !tabsComponent()!.reason
  const tabsReceiptKey = `beast-page-builder:tabs:${apiBase}`
  function tabsReceipt(value?: { draft: TabsDraft; hash?: string } | null): { draft: TabsDraft; hash?: string } | null {
    try {
      if (value === null) sessionStorage.removeItem(tabsReceiptKey)
      else if (value) sessionStorage.setItem(tabsReceiptKey, JSON.stringify(value))
      return JSON.parse(sessionStorage.getItem(tabsReceiptKey) ?? 'null')
    } catch { return null }
  }
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const shortcutLabel = () => config.shortcut.replace('Mod', isMac ? '⌘' : 'Ctrl').replace('Meta', '⌘').replaceAll('+', ' ')

  async function request<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${apiBase}${route}`, { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
    return data as T
  }

  function applyConfig(): void {
    widget.dataset.theme = config.theme
    widget.dataset.position = config.position
    launcher.hidden = !config.launcher
    launcher.querySelector('kbd')!.textContent = shortcutLabel()
  }
  const configuration = request<ClientConfig>('/config').then(value => { config = value; applyConfig() })
  // Keep the shortcut and launcher usable if the development server is temporarily restarting.
  void configuration.catch(() => {})
  applyConfig()

  const projectName = () => escape(report?.name ?? 'Your project')
  const closeButton = () => `<button class="icon-button close" aria-label="Close builder">${icon('close')}</button>`
  const header = (title: string, subtitle = '') => `<header class="topbar"><button class="icon-button back" aria-label="Back to builder">${icon('back')}</button><div class="header-text"><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${closeButton()}</header>`
  const footer = () => `<footer class="footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Select</span><span>Close <kbd>Esc</kbd></span></footer>`
  const notify = (text: string) => { message = text; const target = panel.querySelector<HTMLElement>('.message'); if (target) target.textContent = text }

  function render(): void {
    panel.dataset.view = view
    if (view === 'scan') {
      panel.innerHTML = `<header class="scan-header"><span class="brand">${icon('hex')} Beast <span class="muted">/ Page builder</span></span>${closeButton()}</header><div class="scan-body">${sonar()}<span class="eyebrow">CONNECTING THE DOTS</span><h2>Getting to know your project</h2><p class="scan-label" role="status">Looking for pages, menus, and tabs…</p><div class="scan-progress"><i></i></div><span class="scan-note">A little scan. A lot of possibilities.</span></div>${footer()}`
    } else if (view === 'palette') {
      panel.innerHTML = `<header class="searchbar">${icon('search')}<span class="project-chip">${icon('hex')}${projectName()}</span><input class="search" aria-label="Search pages, components, navigation, tabs, and actions" placeholder="What would you like to build?" value="${escape(query)}" autocomplete="off" spellcheck="false">${closeButton()}</header><nav class="tabs" aria-label="Filter builder results">${['All', 'Pages', 'Components', 'Navs', 'Tabs'].map(name => `<button class="tab ${tab === name ? 'active' : ''}" aria-pressed="${tab === name}">${name}</button>`).join('')}<span class="ready-status"><i></i> Builder ready</span></nav><div class="results"></div><div class="message" role="status"></div>${footer()}`
      renderResults()
      panel.querySelector<HTMLInputElement>('.search')!.addEventListener('input', event => { query = (event.target as HTMLInputElement).value; selected = 0; renderResults() })
      panel.querySelectorAll<HTMLButtonElement>('.tab').forEach(button => button.addEventListener('click', () => { tab = button.textContent!; selected = 0; render(); focusSearch() }))
    } else if (view === 'draft') {
      panel.innerHTML = `${header('Make room for a new idea', 'Create a page in ' + escape(config.pagesDir))}<div class="draft-body"><label class="field-label" for="page-name">Page name</label><div class="name-field"><input id="page-name" value="${escape(draft.name)}" spellcheck="false" autocomplete="off" aria-describedby="name-hint"><span>.btsx</span></div><p class="hint" id="name-hint">PascalCase, like AboutPage or PricingPage.</p><div class="route-fields"><div><label class="field-label" for="route-path">Page URL</label><input id="route-path" class="text-field" value="${escape(draft.routePath ?? suggestPath(draft.name))}" placeholder="/pricing" spellcheck="false"></div><div><label class="field-label" for="nav-label">Navigation label</label><input id="nav-label" class="text-field" value="${escape(draft.navLabel ?? suggestLabel(draft.name))}" maxlength="100"></div></div><label class="field-label" for="nav-target">Add link to</label><select id="nav-target" class="text-field"><option value="">${report?.navigationTargets.length === 1 ? escape(report.navigationTargets[0]!.label) : 'Choose a navigation menu'}</option>${(report?.navigationTargets ?? []).map(target => `<option value="${escape(target.id)}" ${draft.navigationTarget === target.id ? 'selected' : ''}>${escape(target.label)}</option>`).join('')}</select><p class="hint nav-contract"></p>${!report?.navigationTargets.length ? '<p class="hint">No editable menu found. Configure navigation.file for this project.</p>' : ''}<div class="editor-toolbar"><span class="field-label">Start with</span><button data-template="blank">Blank page</button><button data-template="landing">Landing page</button><details><summary>Add a section +</summary><div class="section-menu">${Object.keys(sections).map(name => `<button data-section="${name}">${name}</button>`).join('')}</div></details></div><label class="sr-only" for="page-source">BTSX page source</label><textarea id="page-source" class="source-editor" spellcheck="false">${escape(draft.source)}</textarea><div class="message" role="status">${escape(message)}</div></div><footer class="action-footer"><span>${icon('page')} Page + route + navigation link.</span><button class="primary review" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Review page'} ${icon('arrow')}</button></footer>`
      panel.querySelector<HTMLInputElement>('#page-name')!.addEventListener('input', event => { draft.name = (event.target as HTMLInputElement).value; preview = null; if (draft.routePath === undefined) panel.querySelector<HTMLInputElement>('#route-path')!.value = suggestPath(draft.name); if (draft.navLabel === undefined) panel.querySelector<HTMLInputElement>('#nav-label')!.value = suggestLabel(draft.name) })
      panel.querySelector<HTMLInputElement>('#route-path')!.addEventListener('input', event => { draft.routePath = (event.target as HTMLInputElement).value; preview = null })
      panel.querySelector<HTMLInputElement>('#nav-label')!.addEventListener('input', event => { draft.navLabel = (event.target as HTMLInputElement).value; preview = null })
      panel.querySelector<HTMLSelectElement>('#nav-target')!.addEventListener('change', event => { draft.navigationTarget = (event.target as HTMLSelectElement).value || undefined; preview = null; showNavContract() })
      showNavContract()
      panel.querySelector<HTMLTextAreaElement>('#page-source')!.addEventListener('input', event => { draft.source = (event.target as HTMLTextAreaElement).value; preview = null })
      panel.querySelectorAll<HTMLButtonElement>('[data-template]').forEach(button => button.addEventListener('click', () => { draft.source = templates[button.dataset.template as keyof typeof templates]; preview = null; message = ''; render() }))
      panel.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => button.addEventListener('click', () => {
        const split = draft.source.indexOf('\nstyle\n')
        const snippet = sections[button.dataset.section!]!
        draft.source = split < 0 ? draft.source.trimEnd() + snippet : draft.source.slice(0, split).trimEnd() + snippet + draft.source.slice(split)
        preview = null; render()
      }))
      panel.querySelector('.review')!.addEventListener('click', () => void review())
    } else if (view === 'tabs-draft') {
      renderTabsForm()
    } else if (view === 'preview' || view === 'tabs-preview') {
      const isTabs = view === 'tabs-preview'
      const proposed = isTabs ? tabsPreview! : preview!
      panel.innerHTML = `${header('One last look', escape(proposed.path))}<div class="preview-body"><div class="validation">${icon('check')} Compiles with Beast and Octane</div>${proposed.files.map(file => `<details class="planned-file" open><summary>${icon(file.action === 'create' ? 'plus' : 'page')}<span>${escape(file.path)}</span><small>${file.action === 'create' ? 'New file' : 'Update'}</small></summary><pre class="source-preview" tabindex="0" aria-label="Proposed ${escape(file.path)}"><code>${escape(file.source)}</code></pre>${file.before !== null ? `<details class="original-file"><summary>Current source</summary><pre class="source-preview" tabindex="0"><code>${escape(file.before)}</code></pre></details>` : ''}</details>`).join('')}<div class="message" role="status">${escape(message)}</div><p class="hint">${isTabs ? 'Adds the Tabs component and its items to this page.' : 'Creates the page and updates the route and navigation together.'}</p></div><footer class="action-footer"><span>${proposed.files.length} files · ${escape(proposed.routePath)}</span><button class="primary save" ${busy || isTabs && !tabsReady() ? 'disabled' : ''}>${busy ? 'Saving…' : isTabs ? 'Add Tabs' : 'Create page'} ${icon('plus')}</button></footer>`
      panel.querySelector('.save')!.addEventListener('click', () => void (isTabs ? saveTabs() : save()))
    } else if (view === 'file') {
      panel.innerHTML = `${header(escape(currentFile!.name), escape(currentFile!.path))}<div class="preview-body">${currentFile!.error ? `<p class="error-note">${escape(currentFile!.error)}</p>` : ''}<pre class="source-preview" tabindex="0"><code>${escape(currentSource)}</code></pre><div class="message" role="status"></div></div><footer class="action-footer"><span>${currentFile!.lines} lines · ${currentFile!.components.length} component${currentFile!.components.length === 1 ? '' : 's'}</span><button class="secondary copy">Copy source</button></footer>`
      panel.querySelector('.copy')!.addEventListener('click', () => { void navigator.clipboard.writeText(currentSource).then(() => notify('Source copied.')).catch(() => notify('Could not access the clipboard. Select the source to copy it.')) })
    } else if (view === 'collection') {
      const collection = currentCollection!
      panel.innerHTML = `${header(escape(collection.name), escape(collection.file) + ':' + collection.line)}<div class="preview-body collection-body"><div class="collection-meta"><span class="type-badge">${collection.kind === 'tabs' ? 'Tabs' : 'Navigation'}</span><span>${collection.source === 'data' ? 'Shared data' : 'Rendered markup'} · ${collection.items.length} items</span></div><h3>Item type</h3>${renderType(collection.itemType)}${collection.bindings.length ? `<p class="hint">Data binding: <code>${escape(collection.bindings.join(', '))}</code></p>` : ''}${collection.reason ? `<p class="hint">${escape(collection.reason)}</p>` : ''}${collection.consumers.length ? `<h3>Used by</h3><ul class="consumer-list">${collection.consumers.map(consumer => `<li><code>${escape(consumer.file)}:${consumer.line}</code> · ${escape(consumer.name)}</li>`).join('')}</ul>` : ''}<h3>Items</h3>${collection.items.map(item => `<details class="detected-item"><summary><span>${escape(item.label)}</span><span class="type-badge">${escape(item.kind.replaceAll('-', ' '))}</span></summary><div class="item-body"><p class="hint">${item.component ? `Component: <code>${escape(item.component)}</code> · ` : ''}Line ${item.line}${item.destination ? ` · Destination: <code>${escape(item.destination)}</code>` : ''}${item.value ? ` · Value: <code>${escape(item.value)}</code>` : ''}</p>${renderType(item.itemType)}</div></details>`).join('') || '<p class="hint">No literal items found. The group may populate its items at runtime.</p>'}</div><footer class="action-footer"><span>${collection.editable && collection.kind === 'navigation' ? 'Available for new page links' : 'Inspect item types and source bindings'}</span></footer>`
    } else if (view === 'tabs-success') {
      panel.innerHTML = `${header('Tabs added', escape(tabsPreview!.path))}<div class="success-body"><div class="success-icon">${icon('check')}</div><h2>Your tabs are ready.</h2><p>${tabsDraft.items.length} tabs added to <strong>${escape(tabsPreview!.routePath)}</strong>.</p><button class="secondary done">Back to builder ${icon('arrow')}</button></div>${footer()}`
      panel.querySelector('.done')!.addEventListener('click', () => { tabsReceipt(null); tabsPreview = null; tabsDraft.items = []; void scan() })
    } else if (view === 'success') {
      panel.innerHTML = `${header('Your idea has a home', escape(preview!.path))}<div class="success-body"><div class="success-icon">${icon('check')}</div><span class="eyebrow">READY FOR WHAT’S NEXT</span><h2>${escape(draft.name)} is created.</h2><p>Your route and navigation link are ready.<br>Find it at <strong>${escape(preview!.routePath)}</strong>.</p><a class="primary visit" href="${escape(apiBase.slice(0, -BASE.length) + preview!.routePath)}">Open page ${icon('arrow')}</a><button class="secondary done">Back to builder ${icon('arrow')}</button></div>${footer()}`
      panel.querySelector('.visit')!.addEventListener('click', () => { receipt('') })
      panel.querySelector('.done')!.addEventListener('click', () => { receipt(''); draft = { name: 'UntitledPage', source: templates.blank }; preview = null; void scan() })
    } else {
      panel.innerHTML = `${header('Couldn’t connect to your project')}<div class="error-body">${icon('scan')}<h2>Let’s try that again.</h2><p class="error-note" role="alert">${escape(message)}</p><button class="primary retry">Scan project ${icon('scan')}</button></div>${footer()}`
      panel.querySelector('.retry')!.addEventListener('click', () => void scan())
    }
    panel.querySelector('.close')?.addEventListener('click', close)
    panel.querySelector('.back')?.addEventListener('click', () => {
      message = ''
      if (view === 'tabs-draft' || view === 'tabs-success') tabsReceipt(null)
      view = view === 'preview' ? 'draft' : view === 'tabs-preview' ? 'tabs-draft' : 'palette'
      if (!report) { void scan(); return }
      render(); focusSearch()
    })
  }

  function showNavContract(): void {
    const target = report?.navigationTargets.find(target => target.id === draft.navigationTarget) ?? (report?.navigationTargets.length === 1 ? report.navigationTargets[0] : undefined)
    const hint = panel.querySelector<HTMLElement>('.nav-contract')
    if (hint) hint.textContent = target?.itemType ? `Item type: ${target.itemType.name} · ${target.itemType.origin === 'declared' ? 'Declared type' : 'Inferred shape'}` : ''
  }

  function renderType(type: ItemType): string {
    return `<div class="type-contract"><div class="type-title"><code>${escape(type.name)}</code><span class="type-badge">${type.origin === 'declared' ? 'Declared type' : 'Inferred shape'}</span></div>${type.fields.length ? `<div class="fields-scroll"><table class="type-fields"><thead><tr><th>Field</th><th>Type</th><th>Presence</th></tr></thead><tbody>${type.fields.map(field => `<tr><td><code>${escape(field.name)}</code></td><td><code>${escape(field.type)}</code></td><td>${field.optional ? 'Optional' : 'Required'}</td></tr>`).join('')}</tbody></table></div>` : ''}${type.variants?.length ? `<details class="type-variants"><summary>${type.variants.length} item variants</summary>${type.variants.map(variant => renderType(variant)).join('')}</details>` : ''}</div>`
  }

  const tabKey = (component: TabComponent | undefined) => component?.itemType.fields.find(field => field.name === 'id')?.name ?? component?.itemType.fields.find(field => field.name === 'value')?.name
  function newTab(component: TabComponent, index: number): Record<string, TabValue> {
    const key = tabKey(component)
    if (key && !component.itemType.fields.find(field => field.name === key)?.values) {
      while (tabsDraft.items.some(item => item[key] === `tab-${index + 1}`)) index++
    }
    return Object.fromEntries(component.itemType.fields.filter(field => !field.optional).map(field => [field.name,
      field.values?.[index % field.values.length] ?? (field.scalar === 'boolean' ? false : field.scalar === 'number' ? index + 1 : ['label', 'shortLabel', 'title'].includes(field.name) ? `Tab ${index + 1}` : ['id', 'value'].includes(field.name) ? `tab-${index + 1}` : ['href', 'to'].includes(field.name) ? `#tab-${index + 1}` : ''),
    ]))
  }
  function selectComponent(component: TabComponent): void {
    tabsDraft.component = component.id
    tabsDraft.items = []
    tabsDraft.items.push(newTab(component, 0), newTab(component, 1))
    const key = tabKey(component)
    tabsDraft.active = key ? tabsDraft.items[0]![key]! : ''
    tabsPreview = null
  }
  function startTabs(): void {
    const page = report?.pageRoutes.find(page => normalizePath(page.routePath) === currentPath())
    tabsDraft.page = page?.file ?? ''; tabsDraft.routePath = page?.routePath ?? ''
    if (!tabsComponent() && report?.tabComponents.length) selectComponent(report.tabComponents.find(component => !component.reason) ?? report.tabComponents[0]!)
    if (!tabsDraft.items.length && tabsComponent()) selectComponent(tabsComponent()!)
    pageQuery = ''; pickerOpen = false; message = ''; tabsPreview = null; view = 'tabs-draft'; render()
    panel.querySelector<HTMLInputElement>('#tabs-page')?.focus()
  }
  function choosePage(page: PageRoute): void {
    tabsDraft.page = page.file; tabsDraft.routePath = page.routePath
    pageQuery = ''; pickerOpen = false; pickerIndex = 0; tabsPreview = null
    if (currentPath() === normalizePath(page.routePath)) { message = ''; render(); return }
    // A real navigation lets every host router load the selected page before insertion is enabled.
    tabsReceipt({ draft: tabsDraft })
    message = `Opening ${page.routePath}…`; render()
    location.assign(routePrefix + page.routePath)
  }
  const matchingPages = () => (report?.pageRoutes ?? []).filter(page => `${page.name} ${page.routePath} ${page.file}`.toLowerCase().includes(pageQuery.toLowerCase()))
  function renderPagePicker(): void {
    const list = panel.querySelector<HTMLElement>('#tabs-pages')!
    const input = panel.querySelector<HTMLInputElement>('#tabs-page')!
    const pages = matchingPages()
    pickerIndex = Math.min(pickerIndex, Math.max(0, pages.length - 1))
    list.hidden = !pickerOpen
    input.setAttribute('aria-expanded', String(pickerOpen))
    if (pickerOpen && pages.length) input.setAttribute('aria-activedescendant', `tabs-page-${pickerIndex}`)
    else input.removeAttribute('aria-activedescendant')
    list.innerHTML = pages.map((page, index) => `<button type="button" role="option" id="tabs-page-${index}" aria-selected="${index === pickerIndex}" data-page="${index}"><span>${escape(page.name)}</span><span>${escape(page.routePath)}</span></button>`).join('') || '<p class="hint">No matching page routes.</p>'
    list.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => button.addEventListener('click', () => choosePage(pages[Number(button.dataset.page)]!)))
  }
  function renderTabField(field: ItemField, item: Record<string, TabValue>, index: number): string {
    const id = `tab-${index}-${field.name}`
    const value = item[field.name]
    const options = field.values ?? (field.scalar === 'boolean' ? [true, false] : undefined)
    const control = options ? `<select id="${escape(id)}" class="text-field" data-item="${index}" data-field="${escape(field.name)}" ${field.optional ? '' : 'required'}>${field.optional ? `<option value="" ${value === undefined ? 'selected' : ''}>Omit</option>` : ''}${options.map((option, optionIndex) => `<option value="${optionIndex}" ${value === option ? 'selected' : ''}>${escape(String(option))}</option>`).join('')}</select>` : `<input id="${escape(id)}" class="text-field" data-item="${index}" data-field="${escape(field.name)}" type="${field.scalar === 'number' ? 'number' : 'text'}" ${field.scalar === 'number' ? 'step="any"' : 'maxlength="1000"'} value="${escape(String(value ?? ''))}" ${field.optional ? '' : 'required'}>`
    return `<div><label class="field-label" for="${escape(id)}">${escape(field.name)} <span class="muted">· Tab ${index + 1}${field.optional ? ' · Optional' : ''}</span></label>${control}</div>`
  }
  function renderTabsForm(): void {
    const component = tabsComponent()
    const page = tabsPage()
    const key = tabKey(component)
    const ready = tabsReady()
    panel.innerHTML = `${header('Add Tabs', 'Choose a page and define its tab items')}<form class="draft-body tabs-form"><label class="field-label" for="tabs-page">Page route</label><div class="page-picker"><input id="tabs-page" class="text-field" role="combobox" aria-autocomplete="list" aria-controls="tabs-pages" aria-expanded="false" placeholder="Search pages by name or URL" value="${escape(pageQuery || (page ? `${page.name} · ${page.routePath}` : ''))}" autocomplete="off"><div id="tabs-pages" class="page-options" role="listbox" aria-label="Page routes" hidden></div></div><p class="hint route-status" role="status">${page ? ready ? `Ready to add Tabs to ${escape(page.routePath)}.` : `Navigate to ${escape(page.routePath)} to add Tabs.` : 'Select a registered page route to navigate there.'}</p><label class="field-label" for="tabs-component">Tabs component</label><select id="tabs-component" class="text-field">${report?.tabComponents.length ? report.tabComponents.map(item => `<option value="${escape(item.id)}" ${component?.id === item.id ? 'selected' : ''}>${escape(item.name)} · ${escape(item.file)}</option>`).join('') : '<option value="">No Tabs component found</option>'}</select>${component ? `<p class="hint">Item type: <code>${escape(component.itemType.name)}</code>${component.reason ? ' · ' + escape(component.reason) : ''}</p><details class="tabs-contract"><summary>View item type</summary>${renderType(component.itemType)}</details>` : '<p class="hint">Add a Tabs.btsx component with a typed items prop in a scanned directory.</p>'}${component?.labelProp ? `<label class="field-label" for="tabs-label">Tabs label</label><input id="tabs-label" class="text-field" value="${escape(tabsDraft.label ?? 'Tabs')}" maxlength="100">` : ''}<div class="tab-items">${component && !component.reason ? tabsDraft.items.map((item, index) => `<fieldset class="tab-item"><legend>Tab ${index + 1}</legend><button type="button" class="icon-button remove-tab" data-remove="${index}" aria-label="Remove Tab ${index + 1}" ${tabsDraft.items.length === 1 ? 'disabled' : ''}>${icon('close')}</button><div class="tab-item-fields">${component.itemType.fields.map(field => renderTabField(field, item, index)).join('')}</div></fieldset>`).join('') : ''}</div>${component && !component.reason ? `<button type="button" class="secondary add-tab" ${tabsDraft.items.length >= 50 ? 'disabled' : ''}>${icon('plus')} Add tab item</button>${component.activeProp && key ? `<label class="field-label active-tab-label" for="tabs-active">Active tab</label><select id="tabs-active" class="text-field">${tabsDraft.items.map((item, index) => `<option value="${index}" ${item[key] === tabsDraft.active ? 'selected' : ''}>${escape(String(item.label ?? item.title ?? item[key] ?? `Tab ${index + 1}`))}</option>`).join('')}</select>` : ''}` : ''}<div class="message" role="status">${escape(message)}</div></form><footer class="action-footer"><span>${page ? escape(page.routePath) : 'Select a page route'}</span><button class="primary review-tabs" ${busy || !ready ? 'disabled' : ''}>${busy ? 'Checking…' : 'Review Tabs'} ${icon('arrow')}</button></footer>`
    renderPagePicker()
    const search = panel.querySelector<HTMLInputElement>('#tabs-page')!
    search.addEventListener('focus', () => { pickerOpen = true; renderPagePicker(); if (!pageQuery) search.select() })
    search.addEventListener('input', () => { pageQuery = search.value; pickerIndex = 0; pickerOpen = true; renderPagePicker() })
    search.addEventListener('blur', event => { if (!panel.querySelector('#tabs-pages')!.contains(event.relatedTarget as Node | null)) { pickerOpen = false; renderPagePicker() } })
    search.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        const pages = matchingPages()
        if (event.key === 'Enter') { if (pickerOpen && pages[pickerIndex]) choosePage(pages[pickerIndex]!); return }
        pickerOpen = true; pickerIndex = Math.max(0, Math.min(pages.length - 1, pickerIndex + (event.key === 'ArrowDown' ? 1 : -1))); renderPagePicker()
        panel.querySelector(`#tabs-page-${pickerIndex}`)?.scrollIntoView({ block: 'nearest' })
      }
    })
    panel.querySelector('.tabs-form')!.addEventListener('submit', event => { event.preventDefault(); void reviewTabs() })
    panel.querySelector('#tabs-component')!.addEventListener('change', event => {
      const selected = report?.tabComponents.find(item => item.id === (event.target as HTMLSelectElement).value)
      if (selected) { selectComponent(selected); message = ''; render() }
    })
    panel.querySelector('#tabs-label')?.addEventListener('input', event => { tabsDraft.label = (event.target as HTMLInputElement).value; tabsPreview = null })
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(input => input.addEventListener('input', () => {
      const item = tabsDraft.items[Number(input.dataset.item)]!
      const field = component!.itemType.fields.find(field => field.name === input.dataset.field)!
      const old = item[field.name]
      const options = field.values ?? (field.scalar === 'boolean' ? [true, false] : undefined)
      if (input.value === '' && field.optional) delete item[field.name]
      else item[field.name] = options ? options[Number(input.value)]! : field.scalar === 'number' ? input.value === '' ? NaN : Number(input.value) : input.value
      if (field.name === key && tabsDraft.active === old) tabsDraft.active = item[field.name] ?? ''
      tabsPreview = null
      const active = panel.querySelector<HTMLSelectElement>('#tabs-active')
      if (active) active.options[Number(input.dataset.item)]!.textContent = String(item.label ?? item.title ?? item[key!] ?? `Tab ${Number(input.dataset.item) + 1}`)
    }))
    panel.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button => button.addEventListener('click', () => {
      const [removed] = tabsDraft.items.splice(Number(button.dataset.remove), 1)
      if (key && removed?.[key] === tabsDraft.active) tabsDraft.active = tabsDraft.items[0]?.[key] ?? ''
      tabsPreview = null; render()
    }))
    panel.querySelector('.add-tab')?.addEventListener('click', () => { tabsDraft.items.push(newTab(component!, tabsDraft.items.length)); tabsPreview = null; render() })
    panel.querySelector('#tabs-active')?.addEventListener('change', event => { tabsDraft.active = tabsDraft.items[Number((event.target as HTMLSelectElement).value)]![key!]!; tabsPreview = null })
    panel.querySelector('.review-tabs')!.addEventListener('click', () => void reviewTabs())
  }

  async function reviewTabs(): Promise<void> {
    if (busy || !tabsReady() || !panel.querySelector<HTMLFormElement>('.tabs-form')?.reportValidity()) return
    const turn = generation
    busy = true; message = ''; render()
    try {
      const result = await request<TabsPreview>('/tabs/preview', tabsDraft)
      if (!opened || turn !== generation || !tabsReady()) return
      tabsPreview = result; view = 'tabs-preview'
    } catch (error) { message = error instanceof Error ? error.message : String(error) }
    finally { busy = false; if (opened && turn === generation) { render(); focusSearch() } }
  }
  async function saveTabs(): Promise<void> {
    if (busy || !tabsPreview || !tabsReady()) return
    const turn = generation
    busy = true; message = ''; render()
    tabsReceipt({ draft: tabsDraft, hash: tabsPreview.hash })
    try {
      tabsPreview = await request<TabsPreview>('/tabs/create', { ...tabsDraft, hash: tabsPreview.hash })
      if (opened && turn === generation) view = 'tabs-success'
    } catch (error) { tabsReceipt(null); message = error instanceof Error ? error.message : String(error) }
    finally { busy = false; if (opened && turn === generation) { render(); focusSearch() } }
  }

  type Action = { name: string; detail: string; icon: string; group: string; run: () => void }
  let actions: Action[] = []
  function renderResults(): void {
    const needle = query.toLowerCase()
    const builtins: Action[] = [
      { name: 'Create a new page', detail: 'A fresh start', icon: 'plus', group: 'Actions', run: () => { view = 'draft'; message = ''; render(); panel.querySelector<HTMLInputElement>('#page-name')!.focus(); panel.querySelector<HTMLInputElement>('#page-name')!.select() } },
      { name: 'Add Tabs to a page', detail: 'Choose a page and tab items', icon: 'component', group: 'Actions', run: startTabs },
      { name: 'Rescan project', detail: 'Find what’s new', icon: 'scan', group: 'Actions', run: () => void scan() },
    ]
    actions = [...(tab === 'All' ? builtins : tab === 'Tabs' ? builtins.filter(action => action.run === startTabs) : []), ...(report?.files ?? []).filter(file => tab === 'All' || tab === 'Pages' && file.kind === 'page' || tab === 'Components' && file.kind === 'component').map(file => ({
      name: file.name, detail: file.path, icon: file.kind === 'page' ? 'page' : 'component', group: file.kind === 'page' ? 'Pages' : 'Components', run: () => void openFile(file),
    })), ...(report?.collections ?? []).filter(collection => tab === 'All' || tab === 'Navs' && collection.kind === 'navigation' || tab === 'Tabs' && collection.kind === 'tabs').map(collection => ({ name: collection.name, detail: `${collection.items.length} items · ${collection.file}`, icon: collection.kind === 'tabs' ? 'component' : 'arrow', group: collection.kind === 'tabs' ? 'Tabs' : 'Navigation', run: () => { currentCollection = collection; view = 'collection'; render(); focusSearch() } }))].filter(action => `${action.name} ${action.detail}`.toLowerCase().includes(needle))
    selected = Math.min(selected, Math.max(0, actions.length - 1))
    const results = panel.querySelector<HTMLElement>('.results')!
    let lastGroup = ''
    results.innerHTML = actions.length ? actions.map((action, index) => {
      const heading = action.group !== lastGroup ? `<h3 class="group-label">${action.group}</h3>` : ''
      lastGroup = action.group
      return `${heading}<button class="result ${index === selected ? 'selected' : ''}" data-index="${index}">${icon(action.icon)}<span class="result-name">${escape(action.name)}</span><span class="result-detail">${escape(action.detail)}</span><span class="result-enter">↵</span></button>`
    }).join('') : `<div class="empty-state">${icon('search')}<h3>${query ? 'Nothing here just yet' : 'A clean slate'}</h3><p>${query ? 'Try another name, or create something new.' : `No ${tab.toLowerCase()} found in this project.`}</p><button class="secondary empty-create">Create a page ${icon('plus')}</button></div>`
    results.querySelectorAll<HTMLButtonElement>('.result').forEach(button => button.addEventListener('click', () => actions[Number(button.dataset.index)]?.run()))
    results.querySelector('.empty-create')?.addEventListener('click', () => { view = 'draft'; message = ''; render(); panel.querySelector<HTMLInputElement>('#page-name')!.focus() })
    const errors = report?.files.filter(file => file.error).length ?? 0
    panel.querySelector<HTMLElement>('.message')!.textContent = message || report?.warnings.join(' · ') || (errors ? `${errors} file${errors === 1 ? '' : 's'} with compiler errors. Open the source to inspect.` : '')
  }

  function focusSearch(): void { (panel.querySelector<HTMLElement>('.search') ?? panel.querySelector<HTMLElement>('button'))?.focus() }
  async function scan(): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const turn = ++generation
    view = 'scan'; message = ''; render()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const timer = window.setTimeout(() => { if (view === 'scan' && turn === generation) panel.querySelector('.scan-label')!.textContent = 'Resolving menus, tabs, and item types…' }, 650)
    scanTimer = timer
    try {
      config = await request<ClientConfig>('/config', undefined, signal)
      applyConfig()
      const next = await request<ProjectScan>('/scan', undefined, signal)
      const duration = reduced ? 0 : config.scanDuration
      await new Promise<void>(resolve => window.setTimeout(resolve, Math.max(0, duration - (performance.now() - start))))
      if (!opened || turn !== generation) return
      report = next; view = 'palette'; selected = 0
      if (resumeTabs) { resumeTabs = false; startTabs() }
      else { render(); focusSearch() }
    } catch (error) {
      if (signal.aborted || !opened || turn !== generation) return
      message = error instanceof Error ? error.message : String(error); view = 'error'; render(); focusSearch()
    } finally { window.clearTimeout(timer) }
  }

  async function openFile(file: ProjectFile): Promise<void> {
    if (busy) return
    const turn = generation
    busy = true
    try {
      const result = await request<{ source: string }>(`/source?path=${encodeURIComponent(file.path)}`)
      if (!opened || turn !== generation) return
      currentFile = file; currentSource = result.source; view = 'file'; render(); focusSearch()
    } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
    finally { busy = false }
  }

  async function review(): Promise<void> {
    if (busy) return
    const turn = generation
    busy = true; message = ''; render()
    try {
      const result = await request<PagePreview>('/preview', draft)
      if (!opened || turn !== generation) return
      preview = result; view = 'preview'
    } catch (error) { message = error instanceof Error ? error.message : String(error) }
    finally { busy = false; if (opened && turn === generation) { render(); focusSearch() } }
  }

  async function save(): Promise<void> {
    if (busy || !preview) return
    const turn = generation
    busy = true; message = ''; render()
    receipt(preview.hash)
    try {
      preview = await request<PagePreview>('/create', { ...draft, hash: preview.hash })
      if (opened && turn === generation) view = 'success'
    } catch (error) { receipt(''); message = error instanceof Error ? error.message : String(error) }
    finally { busy = false; if (opened && turn === generation) { render(); focusSearch() } }
  }

  function open(): void {
    if (opened) return
    const active = shadow.activeElement ?? document.activeElement
    previousFocus = active instanceof HTMLElement ? active : null
    opened = true
    panel.hidden = false; backdrop.hidden = false; launcher.setAttribute('aria-expanded', 'true')
    let path = currentPath()
    window.clearInterval(routeTimer)
    routeTimer = window.setInterval(() => {
      const next = currentPath()
      if (next === path) return
      path = next
      if (view !== 'tabs-draft' && view !== 'tabs-preview') return
      const page = report?.pageRoutes.find(page => normalizePath(page.routePath) === next)
      tabsDraft.page = page?.file ?? ''; tabsDraft.routePath = page?.routePath ?? ''
      tabsPreview = null; pageQuery = ''; pickerOpen = false; message = ''; view = 'tabs-draft'; render()
    }, 250)
    void scan(); panel.focus()
  }
  function close(): void {
    if (view === 'success') receipt('')
    if (view.startsWith('tabs-') && !busy) tabsReceipt(null)
    opened = false; generation++; controller?.abort(); window.clearTimeout(scanTimer)
    window.clearInterval(routeTimer)
    panel.hidden = true; backdrop.hidden = true; launcher.setAttribute('aria-expanded', 'false')
    previousFocus?.focus()
  }
  panel.tabIndex = -1
  launcher.setAttribute('aria-expanded', 'false')
  launcher.addEventListener('click', open)
  backdrop.addEventListener('click', close)
  function keydown(event: KeyboardEvent): void {
    const [modifier, ...parts] = config.shortcut.split('+')
    const key = parts.at(-1)!.toLowerCase()
    const mod = modifier === 'Meta' ? event.metaKey && !event.ctrlKey : modifier === 'Ctrl' ? event.ctrlKey && !event.metaKey : isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
    if (event.key.toLowerCase() === key && mod && event.shiftKey === parts.includes('Shift') && !event.altKey) {
      event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) opened ? close() : open(); return
    }
    if (!opened) return
    if (event.key === 'Escape' && view === 'tabs-draft' && pickerOpen) { event.preventDefault(); event.stopImmediatePropagation(); pickerOpen = false; renderPagePicker(); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
    if (event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href], summary, [tabindex="0"]')].filter(element => element.getClientRects().length)
      const current = shadow.activeElement
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && (current === first || current === panel)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (current === last || current === panel)) { event.preventDefault(); first?.focus() }
    }
    if (view !== 'palette' || !(shadow.activeElement?.matches('.search, .result'))) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (!actions.length) return
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length
      renderResults(); panel.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
      focusSearch()
    } else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); actions[selected]?.run() }
  }
  window.addEventListener('keydown', keydown, true)
  // Clean up if an app's DOM ownership removes the mount during HMR or navigation.
  const observer = new MutationObserver(() => {
    if (host.isConnected) return
    controller?.abort(); generation++; window.clearTimeout(scanTimer); window.clearInterval(routeTimer)
    window.removeEventListener('keydown', keydown, true); observer.disconnect()
  })
  observer.observe(document.body, { childList: true })
  const pendingTabs = tabsReceipt()
  if (pendingTabs?.draft && Array.isArray(pendingTabs.draft.items)) {
    tabsDraft = pendingTabs.draft
    if (pendingTabs.hash && /^[a-f0-9]{64}$/.test(pendingTabs.hash)) {
      void configuration.catch(() => {}).then(async () => {
        try {
          const result = await request<TabsPreview>(`/tabs/creation?hash=${pendingTabs.hash}`)
          if (tabsReceipt()?.hash !== pendingTabs.hash || opened) return
          tabsPreview = result; opened = true; view = 'tabs-success'; panel.hidden = false; backdrop.hidden = false
          launcher.setAttribute('aria-expanded', 'true'); render(); focusSearch()
        } catch { tabsReceipt(null) }
      })
    } else { resumeTabs = true; open() }
  }
  const pendingHash = receipt()
  if (pendingHash && /^[a-f0-9]{64}$/.test(pendingHash)) {
    void configuration.catch(() => {}).then(async () => {
      try {
        const result = await request<PagePreview>(`/creation?hash=${pendingHash}`)
        if (receipt() !== pendingHash || opened) return
        preview = result
        draft = { name: result.path.split('/').at(-1)!.replace(/\.btsx$/, ''), source: result.source, routePath: result.routePath, navLabel: result.navLabel }
        opened = true; view = 'success'; panel.hidden = false; backdrop.hidden = false
        launcher.setAttribute('aria-expanded', 'true'); render(); focusSearch()
      } catch { receipt('') }
    })
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
