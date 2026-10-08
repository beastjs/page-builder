export const BASE = '/__beast-page-builder'

export interface BeastPageBuilderOptions {
  /** Project-relative folders to scan. */
  include?: string[]
  /** New pages are created here; existing files are never overwritten. */
  pagesDir?: string
  /** TanStack Router module containing rootRoute.addChildren([...]). */
  routerFile?: string
  /** Limit page-link insertion to this file and optionally one nav/array/group. */
  navigation?: { file: string; selector?: string; array?: string; group?: string; itemDefaults?: Record<string, string | number | boolean | string[]> }
  /** Mod means Command on macOS and Control elsewhere. */
  shortcut?: string
  position?: 'center' | 'bottom-right'
  theme?: 'light' | 'dark' | 'auto'
  /** Minimum scan animation duration in milliseconds. */
  scanDuration?: number
  launcher?: boolean
}

export interface ClientConfig {
  shortcut: string
  position: 'center' | 'bottom-right'
  theme: 'light' | 'dark' | 'auto'
  scanDuration: number
  launcher: boolean
  pagesDir: string
  routerFile: string
}

export interface ProjectFile {
  path: string
  name: string
  kind: 'page' | 'component'
  lines: number
  components: string[]
  error: string | null
}

export interface ProjectScan {
  name: string
  files: ProjectFile[]
  scannedAt: string
  warnings: string[]
  navigationTargets: NavigationTarget[]
  collections: DetectedCollection[]
}

export interface ItemField { name: string; type: string; optional: boolean; values?: Array<string | number | boolean> }
export interface ItemType { name: string; origin: 'declared' | 'inferred'; fields: ItemField[]; variants?: ItemType[] }
export interface DetectedItem {
  label: string
  kind: 'internal-link' | 'external-link' | 'anchor' | 'action' | 'tab' | 'unknown'
  line: number
  component?: string
  destination?: string
  value?: string
  itemType: ItemType
}
export interface CollectionConsumer { file: string; line: number; name: string }
export interface DetectedCollection {
  id: string
  file: string
  line: number
  name: string
  kind: 'navigation' | 'tabs'
  source: 'markup' | 'data'
  itemType: ItemType
  items: DetectedItem[]
  editable: boolean
  reason?: string
  array?: string
  group?: string
  bindings: string[]
  consumers: CollectionConsumer[]
  dataSources: string[]
}
export interface NavigationTarget { id: string; file: string; label: string; array?: string; group?: string; itemType?: ItemType }
export interface PageDraft { name: string; source: string; routePath?: string; navLabel?: string; navigationTarget?: string }
export interface PlannedFile { path: string; action: 'create' | 'edit'; before: string | null; source: string }
export interface PagePreview { path: string; source: string; hash: string; routePath: string; navLabel: string; files: PlannedFile[] }
