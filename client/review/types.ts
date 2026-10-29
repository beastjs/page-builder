import type { PagePreview, SectionInstallPreview, TabsPreview } from '../../shared/types.js'

export type ReviewMode = 'create-page' | 'edit-page' | 'edit-section' | 'add-tabs' | 'edit-tabs' | 'add-section'

interface ReviewControls {
  busy: boolean
  dark: boolean
  message: string
  onSave: () => Promise<void>
  onBack: () => void
  onClose: () => void
}

export type ReviewViewProps = ReviewControls & (
  | { mode: 'create-page' | 'edit-page' | 'edit-section'; preview: PagePreview; ready?: never }
  | { mode: 'add-tabs' | 'edit-tabs'; preview: TabsPreview; ready: boolean }
  | { mode: 'add-section'; preview: SectionInstallPreview; ready?: never }
)
