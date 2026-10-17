import type { CSSProperties } from 'octane'
import Atom from '../../src/components/loaders/Atom'

export function readyHexes() {
  const duration = 850 + Math.round(Math.random() * 250)
  return Array.from({ length: 6 }, (_, index) => ({
    style: {
      '--hex-size': `${Math.round(10 - index * 0.8 + Math.random())}px`,
      '--hex-x': `${176 - 4 * index * (index + 3)}px`,
      '--hex-y': `${Math.round((Math.random() - 0.5) * (4 + index * 2))}px`,
      '--hex-opacity': String(0.38 - index * 0.035),
      '--hex-duration': `${duration}ms`
    } satisfies CSSProperties & Record<`--hex-${string}`, string>
  }))
}

// This empty host slot owns the imperative loader and its animation lifecycle.
export function animateReadyIndicator(root: HTMLElement, indicator: HTMLElement): () => void {
  const dot = indicator.ownerDocument.createElement('i')
  indicator.replaceChildren(dot)
  const fades = [...root.querySelectorAll<SVGElement>('.ready-hex')].flatMap((hex) =>
    hex.getAnimations().filter((animation) => animation instanceof CSSAnimation && animation.animationName === 'ready-hex-fade')
  )
  if (!fades.length) return () => indicator.replaceChildren()
  const owner = indicator.getRootNode()
  const loader = Atom({ size: 12 }, owner instanceof ShadowRoot ? owner : indicator.ownerDocument)
  indicator.replaceChildren(loader)
  let active = true
  void Promise.allSettled(fades.map((animation) => animation.finished)).then(async () => {
    if (!active || !indicator.isConnected) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      indicator.replaceChildren(dot)
      return
    }
    loader.classList.add('ready-loader-out')
    dot.classList.add('ready-dot-in')
    indicator.append(dot)
    const zooms = [...loader.getAnimations(), ...dot.getAnimations()]
    await Promise.allSettled(zooms.map((animation) => animation.finished))
    if (!active) return
    loader.remove()
    dot.classList.remove('ready-dot-in')
  })
  return () => {
    active = false
    for (const element of [loader, dot]) element.getAnimations().forEach((animation) => animation.cancel())
    indicator.replaceChildren()
  }
}
