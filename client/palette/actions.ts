import type { DetectedCollection, ProjectFile, ProjectScan, TabInstance } from '../../shared/types.js'
import type { PaletteAction, PaletteTab } from './types.js'

interface PaletteHandlers {
  createPage: () => void
  addTabs: () => void
  scan: () => void
  toggleLauncher: () => void
  editTabs: (instance: TabInstance) => void
  openFile: (file: ProjectFile) => void
  addSection: (snippet: string) => void
  openCollection: (collection: DetectedCollection) => void
}

interface PaletteOptions {
  report: ProjectScan | null
  tab: PaletteTab
  query: string
  launcherHidden: boolean
  shortcut: string
  sections: Record<string, string>
  handlers: PaletteHandlers
}

export function paletteActions({ report, tab, query, launcherHidden, shortcut, sections, handlers }: PaletteOptions): PaletteAction[] {
  const needle = query.toLowerCase()
  const builtins: PaletteAction[] = [
    {
      id: 'action:create-page',
      name: 'Create a new page',
      detail: 'A fresh start',
      icon: 'plus',
      group: 'Actions',
      run: handlers.createPage
    },
    {
      id: 'action:add-tabs',
      name: 'Add Tabs to a page',
      detail: 'Choose a page and tab items',
      icon: 'component',
      group: 'Actions',
      run: handlers.addTabs
    },
    { id: 'action:rescan', name: 'Rescan project', detail: 'Find what’s new', icon: 'scan', group: 'Actions', run: handlers.scan },
    {
      id: 'action:launcher',
      name: launcherHidden ? 'Show launcher' : 'Hide launcher',
      detail: launcherHidden ? 'Restore the floating Builder button' : `Open with ${shortcut} instead`,
      icon: launcherHidden ? 'eye' : 'eye-off',
      group: 'Actions',
      run: handlers.toggleLauncher
    }
  ]
  const existingTabs: PaletteAction[] = (tab === 'All' || tab === 'Tabs' ? (report?.tabInstances ?? []) : []).map(
    (instance) => ({
      id: `tabs:${instance.id}`,
      name: `Edit ${instance.draft?.label || 'Tabs'} · ${report?.files.find((file) => file.path === instance.page)?.name ?? instance.page}`,
      detail: `${instance.draft ? instance.draft.items.length + ' tabs' : 'Edit source'} · ${instance.page}:${instance.line}`,
      icon: 'component',
      group: 'Existing tabs',
      run: () => {
        if (instance.draft) handlers.editTabs(instance)
        else {
          const file = report?.files.find((file) => file.path === instance.page)
          if (file) handlers.openFile(file)
        }
      }
    })
  )
  return [
    ...(tab === 'All' ? builtins : tab === 'Tabs' ? builtins.filter((action) => action.id === 'action:add-tabs') : []),
    ...existingTabs,
    ...(tab === 'All' || tab === 'Sections'
      ? Object.entries(sections).map(([name, snippet]) => ({
          id: `section:${name}`,
          name,
          detail: 'Add to a page draft',
          icon: 'component',
          group: 'Sections',
          run: () => handlers.addSection(snippet)
        }))
      : []),
    ...(report?.files ?? [])
      .filter(
        (file) =>
          tab === 'All' ||
          (tab === 'Pages' && file.kind === 'page') ||
          (tab === 'Components' && file.kind === 'component')
      )
      .map((file) => ({
        id: `file:${file.path}`,
        name: file.name,
        detail: file.path,
        icon: file.kind === 'page' ? 'page' : 'component',
        group: file.kind === 'page' ? 'Pages' : 'Components',
        run: () => handlers.openFile(file)
      })),
    ...(report?.collections ?? [])
      .filter(
        (collection) =>
          tab === 'All' ||
          (tab === 'Navs' && collection.kind === 'navigation') ||
          (tab === 'Tabs' && collection.kind === 'tabs')
      )
      .map((collection) => ({
        id: `collection:${collection.id}`,
        name: collection.name,
        detail: `${collection.items.length} items · ${collection.file}`,
        icon: collection.kind === 'tabs' ? 'component' : 'arrow',
        group: collection.kind === 'tabs' ? 'Tabs' : 'Navigation',
        run: () => handlers.openCollection(collection)
      }))
  ].filter((action) => `${action.name} ${action.detail}`.toLowerCase().includes(needle))
}
