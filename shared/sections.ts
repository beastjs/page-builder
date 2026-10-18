/** Section labels and IDs share a case-insensitive kebab-case name. */
export const sectionKey = (name: string): string => name.trim().toLowerCase().replace(/[\s_]+/g, '-')
