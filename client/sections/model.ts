import type { DetectedSection, SectionSummary } from '../../shared/types.js'
import type { SectionKindId } from '../../shared/catalog/types.js'
import { sectionKind } from '../../shared/catalog/kinds.js'

/** Summaries whose kind or template text matches every word of the query, as the server's search does. */
export function searchSummaries(summaries: readonly SectionSummary[], query: string): SectionSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...summaries]
  return summaries.filter(summary => {
    const kind = sectionKind(summary.kind)
    const haystack = [kind.label, kind.summary, ...kind.keywords, summary.title, summary.description].join(' ').toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}

/** Kinds a page renders: sections written in the page, and section components it imports and renders. */
export function kindsOnPage(sections: readonly DetectedSection[], page: string): SectionKindId[] {
  const kinds = sections.filter(section => section.kind && (section.file === page || section.usedBy?.some(use => use.file === page))).map(section => section.kind!)
  return [...new Set(kinds)]
}
