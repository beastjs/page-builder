import type { SectionKindId } from './catalog/types.js'
import { sectionKinds } from './catalog/kinds.js'

/** Section labels and IDs share a case-insensitive kebab-case name. */
export const sectionKey = (name: string): string => name.trim().toLowerCase().replace(/[\s_]+/g, '-')

const kindsByKey = new Map<string, SectionKindId>()
for (const kind of sectionKinds) for (const name of [kind.id, kind.label, kind.component]) kindsByKey.set(sectionKey(name), kind.id)

/**
 * The catalog kind a section name refers to. Kind ids are canonical; labels and component names also match, so an
 * inline `#partners-marquee` and a studio `data-section='partners'` are the same kind.
 */
export const sectionKindOf = (name: string): SectionKindId | undefined => kindsByKey.get(sectionKey(name))
