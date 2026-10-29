import type { ProjectFile, SectionSummary } from '../../shared/types.js'
import type { SectionKindId } from '../../shared/catalog/types.js'

export interface SectionLibraryProps {
  /** Null until the catalog has loaded. */
  summaries: SectionSummary[] | null
  pages: ProjectFile[]
  page: string
  /** Kinds the chosen page already renders, inline or as section components. */
  pageKinds: SectionKindId[]
  sectionsDir: string
  query: string
  openKind?: SectionKindId
  /** The template whose install is being reviewed. */
  pending?: string
  dark: boolean
  message: string
  onPageChange: (page: string) => void
  onQueryChange: (query: string) => void
  onOpenKind: (kind: SectionKindId | undefined) => void
  onInstall: (template: string) => void
  onBack: () => void
  onClose: () => void
}
