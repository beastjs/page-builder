import type { ClientConfig } from '../shared/types.js'
import type { PaletteProps } from './palette/types.js'
import type { PageEditorProps } from './pages/types.js'
import type { TabsEditorProps } from './tabs/types.js'
import type { ReviewViewProps } from './review/types.js'
import type { FileInspectorProps, CollectionInspectorProps } from './inspect/types.js'
import type { StatusViewProps } from './status/types.js'
import type { SectionLibraryProps } from './sections/types.js'

export type BuilderView = 'scan' | 'palette' | 'draft' | 'page-edit' | 'file' | 'collection' |
  'preview' | 'success' | 'tabs-draft' | 'tabs-preview' | 'tabs-success' | 'error' |
  'sections' | 'section-preview' | 'section-success'

/** A rendered screen carries only the data and actions its view can consume. */
export type BuilderScreen = (
  | { type: 'palette'; props: PaletteProps }
  | { type: 'page'; props: PageEditorProps }
  | { type: 'tabs'; props: TabsEditorProps }
  | { type: 'review'; props: ReviewViewProps }
  | { type: 'file'; props: FileInspectorProps }
  | { type: 'collection'; props: CollectionInspectorProps }
  | { type: 'status'; props: StatusViewProps }
  | { type: 'sections'; props: SectionLibraryProps }
) & { key: number; view: BuilderView }

export interface BuilderProps {
  opened: boolean
  theme: ClientConfig['theme']
  position: ClientConfig['position']
  launcherVisible: boolean
  shortcut: string
  screen: BuilderScreen | null
  onOpen: () => void
  onClose: () => void
  onThemeToggle: (event: MouseEvent) => void
}
