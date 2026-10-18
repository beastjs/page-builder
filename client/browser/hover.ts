/** One sliding backdrop follows the hovered result without changing keyboard selection. */
export function observeResultHover(element: HTMLElement): () => void {
  const listeners = new AbortController()
  const { signal } = listeners
  let hovered: HTMLElement | null = null
  let pointer: { x: number; y: number } | null = null

  const clear = () => {
    hovered = null
    pointer = null
    element.style.setProperty('--hovered-result-opacity', '0')
  }
  const update = () => {
    if (!hovered || !element.contains(hovered)) { clear(); return }
    const container = element.getBoundingClientRect()
    const item = hovered.getBoundingClientRect()
    element.style.setProperty('--hovered-result-top', `${item.top - container.top + element.scrollTop}px`)
    element.style.setProperty('--hovered-result-left', `${item.left - container.left + element.scrollLeft}px`)
    element.style.setProperty('--hovered-result-height', `${item.height}px`)
    element.style.setProperty('--hovered-result-width', `${item.width}px`)
  }
  const follow = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest<HTMLElement>('.result') : null
    if (!item || !element.contains(item) || item === hovered) return
    hovered = item
    update()
    element.style.setProperty('--hovered-result-opacity', '1')
  }
  const hover = (event: PointerEvent) => {
    if (event.pointerType === 'touch') { clear(); return }
    pointer = { x: event.clientX, y: event.clientY }
    follow(event.target)
  }
  const scroll = () => {
    if (!pointer) return
    const root = element.getRootNode() as Document | ShadowRoot
    const target = root.elementFromPoint(pointer.x, pointer.y)
    if (!target?.closest('.result') || !element.contains(target)) { clear(); return }
    follow(target)
    update()
  }
  const resize = new ResizeObserver(update)
  const content = new MutationObserver(() => {
    clear()
    // A filtered-out row's old backdrop must not keep an otherwise empty list scrollable.
    for (const name of ['top', 'left', 'height', 'width']) element.style.removeProperty(`--hovered-result-${name}`)
  })
  resize.observe(element)
  content.observe(element, { childList: true, subtree: true, characterData: true })
  element.addEventListener('pointerover', hover, { signal })
  element.addEventListener('pointermove', hover, { signal })
  element.addEventListener('pointerleave', clear, { signal })
  element.addEventListener('pointercancel', clear, { signal })
  element.addEventListener('scroll', scroll, { passive: true, signal })
  element.addEventListener('animationend', update, { signal })
  element.closest('.panel')?.addEventListener('keydown', clear, { signal })
  return () => {
    listeners.abort()
    resize.disconnect()
    content.disconnect()
    for (const name of ['top', 'left', 'height', 'width', 'opacity']) element.style.removeProperty(`--hovered-result-${name}`)
  }
}
