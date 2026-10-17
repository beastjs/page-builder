import type { PageRoute, TabComponent, TabsDraft } from '../../shared/types.js'

export interface TabsEditorProps {
  draft: TabsDraft
  pages: PageRoute[]
  components: TabComponent[]
  ready: boolean
  dark: boolean
  busy: boolean
  message: string
  onDraftChange: (draft: TabsDraft) => void
  onChoosePage: (page: PageRoute) => void
  onReview: () => Promise<void>
  onBack: () => void
  onClose: () => void
}
