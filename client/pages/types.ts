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
  /** How a section edit is named: by kind for studio sections, else by its id. */
  sectionTitle?: string
  /** Offered when editing a saved page; unset while it has unsaved edits, since an install changes the file. */
  library?: { onOpen?: () => void }
}
