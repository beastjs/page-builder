import type { TabComponent, TabValue } from '../../shared/types.js'

export const tabKey = (component: TabComponent | undefined) =>
  component?.itemType.fields.find((field) => field.name === 'id')?.name ??
  component?.itemType.fields.find((field) => field.name === 'value')?.name

export function newTab(component: TabComponent, items: Record<string, TabValue>[], index: number): Record<string, TabValue> {
  const key = tabKey(component)
  if (key && !component.itemType.fields.find((field) => field.name === key)?.values) {
    while (items.some((item) => item[key] === `tab-${index + 1}`)) index++
  }
  return Object.fromEntries(component.itemType.fields.filter((field) => !field.optional).map((field) => [
    field.name,
    field.values?.[index % field.values.length] ?? (field.scalar === 'boolean' ? false
      : field.scalar === 'number' ? index + 1
      : ['label', 'shortLabel', 'title'].includes(field.name) ? `Tab ${index + 1}`
      : ['id', 'value'].includes(field.name) ? `tab-${index + 1}`
      : ['href', 'to'].includes(field.name) ? `#tab-${index + 1}` : '')
  ]))
}
