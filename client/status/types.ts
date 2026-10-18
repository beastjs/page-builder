import type { PagePreview, TabsPreview } from '../../shared/types.js'

export type SuccessScreen =
  | { type: 'page-success'; name: string; editing: boolean; preview: PagePreview; href: string; onVisit: () => void; onEdit: () => void; onDone: () => void }
  | { type: 'tabs-success'; editing: boolean; preview: TabsPreview; count: number; onDone: () => void }

export type StatusScreen = SuccessScreen
  | { type: 'scan'; label: string }
  | { type: 'error'; message: string; onRetry: () => void }

export interface StatusViewProps {
  screen: StatusScreen
  projectName: string
  dark: boolean
  onBack: () => void
  onClose: () => void
}
