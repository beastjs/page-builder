import type { TabsDraft } from '../shared/types.js'

type TabsReceipt = { draft: TabsDraft; hash?: string }
export interface PanelPosition { x: number; y: number }
export function createPersistence(base: string) {
  const key = (name: string) => `beast-page-builder:${name}:${base}`
  const read = (name: string) => {
    try { return localStorage.getItem(key(name)) } catch { return null }
  }
  const write = (name: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(key(name))
      else localStorage.setItem(key(name), value)
    } catch { /* Keep the in-memory preference. */ }
  }
  return {
    position(): PanelPosition | null {
      try {
        const value = JSON.parse(read('position') ?? 'null')
        return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null
      } catch { return null }
    },
    setPosition: (value: PanelPosition | null) => write('position', value ? JSON.stringify(value) : null),
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
    /** The hash of a section install whose response a reload may interrupt. */
    installReceipt(value?: string): string | null {
      try {
        if (value === '') sessionStorage.removeItem(key('install'))
        else if (value) sessionStorage.setItem(key('install'), value)
        return sessionStorage.getItem(key('install'))
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
