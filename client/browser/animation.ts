export function animateScreen(panel: HTMLElement): void {
  const enter = (elements: NodeListOf<HTMLElement>, delay = 0) => elements.forEach((element, index) => {
    element.classList.add('builder-enter')
    element.style.setProperty('--enter-delay', `${delay + Math.min(index, 5) * 24}ms`)
  })
  enter(panel.querySelectorAll<HTMLElement>(':scope > header, :scope > nav, :scope > footer'))
  enter(panel.querySelectorAll<HTMLElement>(
    '.scan-body > *, .draft-body > :not(.message), .preview-body > :not(.message), .success-body > *, .error-body > *'
  ), 36)
}

export function waitForScan(duration: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return }
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = window.setTimeout(finish, Math.max(0, duration))
    signal.addEventListener('abort', finish, { once: true })
  })
}
