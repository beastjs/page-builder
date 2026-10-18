import { matchesShortcut } from './preferences.js'
import type { createPersistence } from '../persistence.js'

interface PanelOptions {
  shadow: ShadowRoot
  panel: HTMLElement
  storage: Pick<ReturnType<typeof createPersistence>, 'position' | 'setPosition'>
  opened: () => boolean
  shortcut: () => string
  onToggle: () => void
  onClose: () => void
}

/** Browser-owned geometry and focus stay outside the declarative screen tree. */
export function createPanelBehavior({ shadow, panel, storage, opened, shortcut, onToggle, onClose }: PanelOptions) {
  const listeners = new AbortController()
  const { signal } = listeners
  let previousFocus: HTMLElement | null = null
  let panelPosition = storage.position()
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null
  let heightAnimation: Animation | null = null
  let heightTarget = 0
  let observedHeight = 0
  let observeFrame = 0

  function revealContent(): void {
    panel.removeAttribute('data-resizing')
    panel.removeAttribute('data-screen-changing')
  }

  function transitionHeight(from: number, to: number, screenChanged: boolean): void {
    heightAnimation?.cancel()
    panel.setAttribute('data-resizing', '')
    panel.toggleAttribute('data-screen-changing', screenChanged)
    // The next screen's smaller CSS maximum must not clip a shrinking editor.
    const maxHeight = `${Math.max(from, to)}px`
    const animation = panel.animate([{ height: `${from}px`, maxHeight }, { height: `${to}px`, maxHeight }], {
      duration: 240,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
    })
    heightAnimation = animation
    heightTarget = to
    animation.onfinish = () => {
      if (heightAnimation !== animation) return
      heightAnimation = null
      observedHeight = panel.offsetHeight
      revealContent()
      positionPanel()
      if (panelPosition) storage.setPosition(panelPosition)
    }
  }

  function positionPanel(): void {
    if (!panelPosition || panel.hidden) return
    panel.dataset.moved = ''
    const gutter = 8
    const { x, y } = panelPosition
    panelPosition.x = Math.max(gutter, Math.min(panelPosition.x, innerWidth - panel.offsetWidth - gutter))
    panelPosition.y = Math.max(gutter, Math.min(panelPosition.y, innerHeight - panel.offsetHeight - gutter))
    panel.style.setProperty('--builder-left', `${panelPosition.x}px`)
    panel.style.setProperty('--builder-top', `${panelPosition.y}px`)
    if (!drag && !heightAnimation && (x !== panelPosition.x || y !== panelPosition.y)) storage.setPosition(panelPosition)
  }
  function stopDrag(event?: PointerEvent): void {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    const { pointerId } = drag
    drag = null
    storage.setPosition(panelPosition)
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
      storage.setPosition(null)
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
    storage.setPosition(panelPosition)
  }, { signal })
  const panelResizeObserver = new ResizeObserver(() => {
    const height = panel.offsetHeight
    // Native disclosures and resized source fields can change height without a controller render.
    if (!panel.hidden && !heightAnimation && observedHeight && Math.abs(height - observedHeight) >= 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Resizing an observed element inside delivery otherwise produces an observer-loop error.
      panelResizeObserver.unobserve(panel)
      transitionHeight(observedHeight, height, false)
      observeFrame = requestAnimationFrame(() => {
        observeFrame = 0
        panelResizeObserver.observe(panel)
      })
    }
    observedHeight = height
    positionPanel()
  })
  panelResizeObserver.observe(panel)
  function viewportResize(): void {
    heightAnimation?.cancel()
    heightAnimation = null
    observedHeight = panel.offsetHeight
    revealContent()
    positionPanel()
  }
  window.addEventListener('resize', viewportResize)

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
    updateContent(update: () => void): void {
      const previousView = panel.dataset.view
      const wasVisible = !panel.hidden
      // Temporarily detach the effect to measure the next layout without losing playback progress.
      const from = panel.offsetHeight
      const active = heightAnimation
      const effect = active?.effect ?? null
      if (active) active.effect = null
      update()
      const editor = ['draft', 'page-edit', 'tabs-draft'].includes(panel.dataset.view ?? '')
      if (!editor || previousView !== panel.dataset.view) {
        panel.style.removeProperty('--builder-editor-height')
        panel.style.removeProperty('--builder-max-height')
        if (editor) {
          // Measure each editor once, before expanding it, so typing never compounds the height.
          const height = panel.offsetHeight
          panel.style.setProperty('--builder-editor-height', `${height * 1.6}px`)
          panel.style.setProperty('--builder-max-height', `${640 * 1.6}px`)
        }
      }
      const to = panel.offsetHeight
      if (!wasVisible || panel.hidden || Math.abs(from - to) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        active?.cancel()
        heightAnimation = null
        observedHeight = to
        revealContent()
        return
      }
      if (active && to === heightTarget && previousView === panel.dataset.view) {
        active.effect = effect
        return
      }
      transitionHeight(from, to, previousView !== panel.dataset.view)
    },
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
      heightAnimation?.cancel()
      heightAnimation = null
      revealContent()
      listeners.abort()
      cancelAnimationFrame(observeFrame)
      panelResizeObserver.disconnect()
      window.removeEventListener('resize', viewportResize)
    }
  }
}
