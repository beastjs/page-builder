import type { ClientConfig } from '../../shared/types.js'
import type { createPersistence } from '../persistence.js'

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform)
export function shortcutLabel(shortcut: string): string {
  return shortcut.replace('Mod', isMac() ? '⌘' : 'Ctrl').replace('Meta', '⌘').replaceAll('+', ' ')
}
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const [modifier, ...parts] = shortcut.split('+')
  const mod = modifier === 'Meta' ? event.metaKey && !event.ctrlKey
    : modifier === 'Ctrl' ? event.ctrlKey && !event.metaKey
    : isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return event.key.toLowerCase() === parts.at(-1)?.toLowerCase() && mod &&
    event.shiftKey === parts.includes('Shift') && !event.altKey
}
export function createPreferences(storage: ReturnType<typeof createPersistence>, onChange: () => void) {
  const system = matchMedia('(prefers-color-scheme: dark)')
  let theme = storage.theme()
  let launcher = storage.launcher()
  system.addEventListener('change', onChange)
  const mode = (config: ClientConfig) => theme ?? config.theme
  return {
    mode,
    dark: (config: ClientConfig) => mode(config) === 'dark' || (mode(config) === 'auto' && system.matches),
    launcher: (config: ClientConfig) => launcher ?? config.launcher,
    toggleTheme(config: ClientConfig) {
      theme = mode(config) === 'dark' || (mode(config) === 'auto' && system.matches) ? 'light' : 'dark'
      storage.setTheme(theme)
    },
    toggleLauncher(config: ClientConfig) { launcher = !(launcher ?? config.launcher); storage.setLauncher(launcher) },
    dispose: () => system.removeEventListener('change', onChange)
  }
}
