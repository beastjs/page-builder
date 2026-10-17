export const suggestPath = (name: string) =>
  '/' + (name.replace(/Page$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase() || 'page')

export const suggestLabel = (name: string) => name.replace(/Page$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')

export function insertSection(source: string, snippet: string): string {
  const split = source.indexOf('\nstyle\n')
  return split < 0
    ? source.trimEnd() + snippet
    : source.slice(0, split).trimEnd() + snippet + source.slice(split)
}
