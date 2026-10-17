import type { PagePreview, TabsPreview } from '../../shared/types.js'

export type ReviewMode = 'create-page' | 'edit-page' | 'add-tabs' | 'edit-tabs'

interface ReviewControls {
  busy: boolean
  dark: boolean
  message: string
  onSave: () => Promise<void>
  onBack: () => void
  onClose: () => void
}

export type ReviewViewProps = ReviewControls & (
  | { mode: 'create-page' | 'edit-page'; preview: PagePreview; ready?: never }
  | { mode: 'add-tabs' | 'edit-tabs'; preview: TabsPreview; ready: boolean }
)
