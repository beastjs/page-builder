import { matchesShortcut } from './preferences.js'

interface PanelOptions {
  shadow: ShadowRoot
  panel: HTMLElement
  opened: () => boolean
  shortcut: () => string
  onToggle: () => void
  onClose: () => void
}

/** Browser-owned geometry and focus stay outside the declarative screen tree. */
export function createPanelBehavior({ shadow, panel, opened, shortcut, onToggle, onClose }: PanelOptions) {
  const listeners = new AbortController()
  const { signal } = listeners
  let previousFocus: HTMLElement | null = null
  let panelPosition: { x: number; y: number } | null = null
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null

  function positionPanel(): void {
    if (!panelPosition || panel.hidden) return
    panel.dataset.moved = ''
    const gutter = 8
    panelPosition.x = Math.max(gutter, Math.min(panelPosition.x, innerWidth - panel.offsetWidth - gutter))
    panelPosition.y = Math.max(gutter, Math.min(panelPosition.y, innerHeight - panel.offsetHeight - gutter))
    panel.style.setProperty('--builder-left', `${panelPosition.x}px`)
    panel.style.setProperty('--builder-top', `${panelPosition.y}px`)
  }
  function stopDrag(event?: PointerEvent): void {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    const { pointerId } = drag
    drag = null
    delete panel.dataset.dragging
    if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId)
  }
  // Delegate to the stable panel: switching views replaces the header during a drag.
  panel.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || drag) return
    const target = event.target instanceof Element ? event.target : null
    if (!target?.closest('.searchbar, .scan-header, .topbar')) return
    if (target.closest('button, input, textarea, select, a, summary, [contenteditable]') && !target.closest('.move'))
      return
    event.preventDefault()
    target.closest<HTMLElement>('.move')?.focus({ preventScroll: true })
    const box = panel.getBoundingClientRect()
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top }
    panelPosition = { x: box.left, y: box.top }
    positionPanel()
    panel.dataset.dragging = ''
    panel.setPointerCapture(event.pointerId)
  }, { signal })
  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    panelPosition = { x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y }
    positionPanel()
  }, { signal })
  panel.addEventListener('pointerup', stopDrag, { signal })
  panel.addEventListener('pointercancel', stopDrag, { signal })
  panel.addEventListener('lostpointercapture', stopDrag, { signal })
  panel.addEventListener('keydown', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.move')) return
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Home') {
      panelPosition = null
      delete panel.dataset.moved
      panel.style.removeProperty('--builder-left')
      panel.style.removeProperty('--builder-top')
      return
    }
    const box = panel.getBoundingClientRect()
    const step = event.shiftKey ? 40 : 10
    panelPosition = {
      x: box.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      y: box.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
    }
    positionPanel()
  }, { signal })
  const panelResizeObserver = new ResizeObserver(positionPanel)
  panelResizeObserver.observe(panel)
  window.addEventListener('resize', positionPanel)

  function keydown(event: KeyboardEvent): void {
    if (matchesShortcut(event, shortcut())) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat) onToggle()
      return
    }
    if (!opened()) return
    if (event.key === 'Escape') {
      const picker = panel.querySelector<HTMLInputElement>('#tabs-page')
      if (picker?.getAttribute('aria-expanded') === 'true') {
        event.preventDefault()
        event.stopImmediatePropagation()
        picker.dispatchEvent(new Event('builder:close-picker'))
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, textarea, select, a[href], summary, [tabindex="0"]'
    )].filter(element => element.getClientRects().length)
    const current = shadow.activeElement
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && (current === first || current === panel)) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && (current === last || current === panel)) {
      event.preventDefault()
      first?.focus()
    }
  }
  window.addEventListener('keydown', keydown, { capture: true, signal })
  return {
    position: positionPanel,
    stopDrag,
    captureFocus() {
      const active = shadow.activeElement ?? document.activeElement
      previousFocus = active instanceof HTMLElement ? active : null
    },
    restoreFocus: () => previousFocus?.focus(),
    focusSearch() { (panel.querySelector<HTMLElement>('.search') ?? panel.querySelector<HTMLElement>('button'))?.focus() },
    dispose() {
      stopDrag()
      listeners.abort()
      panelResizeObserver.disconnect()
      window.removeEventListener('resize', positionPanel)
    }
  }
}
