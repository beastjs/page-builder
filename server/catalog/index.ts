import type { SectionKindId, SectionTemplate } from '../../shared/catalog/types.js'
import type { SectionSummary } from '../../shared/types.js'
import { sectionKind } from '../../shared/catalog/kinds.js'
import { topbarTemplates } from './sections/topbar.js'
import { heroTemplates } from './sections/hero.js'
import { partnersTemplates } from './sections/partners.js'
import { statsTemplates } from './sections/stats.js'
import { featuresTemplates } from './sections/features.js'
import { guidesTemplates } from './sections/guides.js'
import { productsTemplates } from './sections/products.js'
import { testimonialsTemplates } from './sections/testimonials.js'
import { pricingTemplates } from './sections/pricing.js'
import { faqTemplates } from './sections/faq.js'
import { teamTemplates } from './sections/team.js'
import { ctaTemplates } from './sections/cta.js'
import { newsletterTemplates } from './sections/newsletter.js'
import { footerTemplates } from './sections/footer.js'

/**
 * The built-in section templates, in page order. Server-only: the widget reads summaries from the API and
 * fetches a template's source only when one is chosen, so the sources stay out of dist/client.js.
 * The template files are synced from play by scripts/sync-catalog.ts.
 */
export const sectionTemplates: SectionTemplate[] = [
  ...topbarTemplates,
  ...heroTemplates,
  ...partnersTemplates,
  ...statsTemplates,
  ...featuresTemplates,
  ...guidesTemplates,
  ...productsTemplates,
  ...testimonialsTemplates,
  ...pricingTemplates,
  ...faqTemplates,
  ...teamTemplates,
  ...ctaTemplates,
  ...newsletterTemplates,
  ...footerTemplates,
]

const templatesById = new Map(sectionTemplates.map(template => [template.id, template]))

export const sectionTemplate = (id: string) => templatesById.get(id)
export const templatesOf = (kind: SectionKindId) => sectionTemplates.filter(template => template.kind === kind)
export const sectionSummaries: SectionSummary[] = sectionTemplates.map(({ source: _, ...summary }) => summary)

/** Templates whose kind or template text matches every word of the query. */
export function searchTemplates(query: string): SectionTemplate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return sectionTemplates
  return sectionTemplates.filter(template => {
    const kind = sectionKind(template.kind)
    const haystack = [kind.label, kind.summary, ...kind.keywords, template.title, template.description].join(' ').toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}
