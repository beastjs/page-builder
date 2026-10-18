import type { TabsDraft } from '../shared/types.js'

type TabsReceipt = { draft: TabsDraft; hash?: string }
export function createPersistence(base: string) {
  const key = (name: string) => `beast-page-builder:${name}:${base}`
  const read = (name: string) => {
    try { return localStorage.getItem(key(name)) } catch { return null }
  }
  const write = (name: string, value: string) => {
    try { localStorage.setItem(key(name), value) } catch { /* Keep the in-memory preference. */ }
  }
  return {
    theme(): 'light' | 'dark' | null {
      const value = read('theme')
      return value === 'light' || value === 'dark' ? value : null
    },
    setTheme: (value: 'light' | 'dark') => write('theme', value),
    launcher(): boolean | null {
      const value = read('launcher')
      return value === 'true' ? true : value === 'false' ? false : null
    },
    setLauncher: (value: boolean) => write('launcher', String(value)),
    receipt(value?: string): string | null {
      try {
        if (value === '') sessionStorage.removeItem(key('save'))
        else if (value) sessionStorage.setItem(key('save'), value)
        return sessionStorage.getItem(key('save'))
      } catch { return null }
    },
    tabsReceipt(value?: TabsReceipt | null): TabsReceipt | null {
      try {
        if (value === null) sessionStorage.removeItem(key('tabs'))
        else if (value) sessionStorage.setItem(key('tabs'), JSON.stringify(value))
        return JSON.parse(sessionStorage.getItem(key('tabs')) ?? 'null')
      } catch { return null }
    }
  }
}
