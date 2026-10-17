import type { NavigationTarget, PageDraft } from '../../shared/types.js'

export interface PageEditorProps {
  draft: PageDraft
  pagesDir: string
  targets: NavigationTarget[]
  dark: boolean
  busy: boolean
  message: string
  onDraftChange: (draft: PageDraft) => void
  onReview: () => Promise<void>
  onBack: () => void
  onClose: () => void
  onClearMessage: () => void
}
