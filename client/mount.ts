import { createRoot, flushSync } from 'octane'
import Builder from './Builder.btsx'
import { apiPath, defaultConfig } from './api.js'
import { createBuilderController } from './controller.js'
import { shortcutLabel } from './browser/preferences.js'
import { registerBuilderFonts } from './browser/fonts.js'

function mount(): void {
  if (document.getElementById('beast-page-builder')) return
  registerBuilderFonts(document)
  const host = document.createElement('div')
  host.id = 'beast-page-builder'
  const shadow = host.attachShadow({ mode: 'open' })
  document.body.append(host)
  const root = createRoot(shadow)
  const noop = () => {}
  flushSync(() => root.render(Builder, {
    opened: false, screen: null, theme: defaultConfig.theme, position: defaultConfig.position,
    launcherVisible: defaultConfig.launcher, shortcut: shortcutLabel(defaultConfig.shortcut),
    onOpen: noop, onClose: noop, onThemeToggle: noop
  }))
  const dispose = createBuilderController({
    host, shadow, panel: shadow.querySelector<HTMLElement>('.panel')!, apiBase: apiPath(import.meta.url),
    commit: props => flushSync(() => root.render(Builder, props))
  })
  // Dispose browser subscriptions and component effects when app ownership removes the mount.
  const observer = new MutationObserver(() => {
    if (host.isConnected) return
    dispose()
    root.unmount()
    observer.disconnect()
  })
  observer.observe(document.body, { childList: true })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
