/** Fade only the edges with offscreen content, without changing layout or scroll position. */
export function observeScrollFades(element: HTMLElement): () => void {
  const update = () => {
    const remaining = element.scrollHeight - element.clientHeight - element.scrollTop
    element.style.setProperty('--scroll-fade-top', `${Math.min(16, Math.max(0, element.scrollTop))}px`)
    element.style.setProperty('--scroll-fade-bottom', `${Math.min(16, Math.max(0, remaining))}px`)
  }
  const resize = new ResizeObserver(update)
  const content = new MutationObserver(update)
  element.addEventListener('scroll', update, { passive: true })
  resize.observe(element)
  content.observe(element, { childList: true, subtree: true, characterData: true })
  update()
  return () => {
    element.removeEventListener('scroll', update)
    resize.disconnect()
    content.disconnect()
    element.style.removeProperty('--scroll-fade-top')
    element.style.removeProperty('--scroll-fade-bottom')
  }
}
