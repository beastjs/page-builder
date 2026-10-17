import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
import type * as Loaders from '../src/components/loaders'

declare global {
  interface Window {
    loaders: typeof Loaders
  }
}

let bundle: string
test.beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/components/loaders/index.ts'], bundle: true, write: false,
    format: 'iife', globalName: 'loaders', platform: 'browser', target: 'es2022'
  })
  bundle = result.outputFiles[0]!.text
})

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setContent('<!doctype html><html><head></head><body></body></html>')
  await page.addScriptTag({ content: bundle })
})

test('native loaders preserve their structure, SVG namespaces, and default animations', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Atom, Clock, Leap, Ripple, Trace, HexTrace } = window.loaders
    const roots = [Atom(), Clock(), Leap(), Ripple(), Trace(), HexTrace()]
    const detached = roots.every(root => !root.isConnected)
    document.body.append(...roots)
    return {
      detached,
      roots: roots.map(root => ({
        name: root.getAttribute('class'), hidden: root.getAttribute('aria-hidden'),
        width: getComputedStyle(root).width, height: getComputedStyle(root).height
      })),
      animations: roots.map(root => {
        const style = getComputedStyle(root.querySelector('[class*="-spin"], .ld-leap-wrapper, .ld-ripple-ring')!)
        return { name: style.animationName, duration: style.animationDuration, state: style.animationPlayState }
      }),
      namespaces: [...document.querySelectorAll('svg, svg *')].map(element => element.namespaceURI),
      traceCap: document.querySelector('.ld-trace-spin')!.getAttribute('stroke-linecap')
    }
  })
  expect(result.detached).toBe(true)
  expect(result.roots).toEqual(['atom', 'clock', 'leap', 'ripple', 'trace', 'hex-trace'].map(name => ({
    name: `ld-${name}`, hidden: 'true', width: '20px', height: '20px'
  })))
  expect(result.animations).toEqual([
    { name: 'ld-atom-rotate', duration: '1s', state: 'running' },
    { name: 'ld-clock-rotate', duration: '1.2s', state: 'running' },
    { name: 'ld-leap-hop', duration: '1.8s', state: 'running' },
    { name: 'ld-ripple-spread', duration: '1.2s', state: 'running' },
    { name: 'ld-trace-rotate', duration: '1.2s', state: 'running' },
    { name: 'ld-hex-trace-rotate', duration: '1.2s', state: 'running' }
  ])
  expect(result.namespaces.every(namespace => namespace === 'http://www.w3.org/2000/svg')).toBe(true)
  expect(result.traceCap).toBe('round')
  await expect(page.locator('.ld-atom-shell')).toHaveCount(1)
  await expect(page.locator('.ld-atom-orbit .ld-atom-ring')).toHaveCount(3)
  await expect(page.locator('.ld-clock circle, .ld-clock path')).toHaveCount(2)
  await expect(page.locator('.ld-leap-wrapper .ld-leap-dot')).toHaveCount(3)
  await expect(page.locator('.ld-ripple-ring-out')).toHaveCount(3)
  await expect(page.locator('.ld-trace rect')).toHaveCount(2)
  await expect(page.locator('.ld-hex-trace polygon')).toHaveCount(2)
})

test('all loaders apply shared props and preserve staggered timing', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Atom, Clock, Leap, Ripple, Trace, HexTrace } = window.loaders
    const props = { className: 'custom-loader', size: 40, color: '#123456', duration: 2400, playState: 'paused' as const }
    const roots = [Atom(props), Clock(props), Leap(props), Ripple(props), Trace(props), HexTrace(props)]
    document.body.append(...roots)
    return roots.map(root => {
      const children = [...root.querySelectorAll('[class*="-spin"], .ld-leap-wrapper, .ld-ripple-ring')]
      return {
        customClass: root.classList.contains('custom-loader'),
        width: getComputedStyle(root).width, color: getComputedStyle(root).color,
        animations: children.map(child => {
          const style = getComputedStyle(child)
          return { duration: style.animationDuration, state: style.animationPlayState, delay: style.animationDelay }
        })
      }
    })
  })
  for (const root of result) {
    expect(root.customClass).toBe(true)
    expect(root.width).toBe('40px')
    expect(root.color).toBe('rgb(18, 52, 86)')
    for (const animation of root.animations) {
      expect(animation.duration).toBe('2.4s')
      expect(animation.state).toBe('paused')
    }
  }
  for (const index of [0, 2, 3]) {
    expect(result[index]!.animations.map(animation => animation.delay)).toEqual(['-2.4s', '-1.6s', '-0.8s'])
  }
})

test('easing, ripple direction, and trace caps reach the browser styles', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Atom, Clock, Ripple, Trace } = window.loaders
    document.body.append(
      Atom({ easing: 'ease-in-out' }), Clock({ easing: 'stacked', playState: 'paused' }),
      Ripple({ direction: 'in' }), Trace({ easing: 'stacked', cap: 'flat' })
    )
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    return {
      atomEasing: style('.ld-atom-spin').animationTimingFunction,
      clockNames: style('.ld-clock-spin').animationName,
      clockComposition: style('.ld-clock-spin').animationComposition,
      clockStates: document.querySelector('.ld-clock')!.getAnimations({ subtree: true }).map(animation => animation.playState),
      rippleDirections: [...document.querySelectorAll('.ld-ripple-ring')].map(ring => getComputedStyle(ring).animationDirection),
      traceNames: style('.ld-trace-spin').animationName,
      traceCap: document.querySelector('.ld-trace-spin')!.getAttribute('stroke-linecap')
    }
  })
  expect(result).toEqual({
    atomEasing: 'ease-in-out', clockNames: 'ld-clock-rotate, ld-clock-rotate', clockComposition: 'add',
    clockStates: ['paused', 'paused'], rippleDirections: ['reverse', 'reverse', 'reverse'],
    traceNames: 'ld-trace-rotate, ld-trace-rotate', traceCap: 'butt'
  })
})

test('styles are shared per target and work in shadow roots and other documents', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Atom, Clock, Leap, Ripple, Trace, HexTrace } = window.loaders
    const factories = [Atom, Clock, Leap, Ripple, Trace, HexTrace]
    const first = document.createElement('div').attachShadow({ mode: 'open' })
    const second = document.createElement('div').attachShadow({ mode: 'open' })
    document.body.append(first.host, second.host)
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const otherDoc = iframe.contentDocument!
    for (const factory of factories) {
      document.body.append(factory(), factory())
      first.append(factory({}, first), factory({}, first))
      second.append(factory({}, second))
      otherDoc.body.append(factory({}, otherDoc))
    }
    const counts = [document.head, first, second, otherDoc.head].map(target => target.querySelectorAll('style[data-loader]').length)
    const widths = [...first.querySelectorAll('.ld-atom, .ld-clock, .ld-leap, .ld-ripple, .ld-trace, .ld-hex-trace')]
      .map(root => getComputedStyle(root).width)
    const otherOwners = [...otherDoc.body.children].every(root => root.ownerDocument === otherDoc)
    first.querySelector('style[data-loader="atom"]')!.remove()
    Atom({}, first)
    return { counts, widths, otherOwners, restored: first.querySelectorAll('style[data-loader="atom"]').length }
  })
  expect(result.counts).toEqual([6, 6, 6, 6])
  expect(result.widths).toEqual(Array(12).fill('20px'))
  expect(result.otherOwners).toBe(true)
  expect(result.restored).toBe(1)
})

test('reduced motion stops every animation and leaves a visible static loader', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const result = await page.evaluate(() => {
    const { Atom, Clock, Leap, Ripple, Trace, HexTrace } = window.loaders
    const roots = [Atom({ easing: 'stacked' }), Clock(), Leap(), Ripple(), Trace({ easing: 'stacked' }), HexTrace({ easing: 'stacked' })]
    document.body.append(...roots)
    return {
      animations: document.getAnimations().length,
      atomTransform: getComputedStyle(document.querySelector('.ld-atom-spin')!).transform,
      dotPositions: [...document.querySelectorAll('.ld-leap-wrapper')].map(dot => dot.getBoundingClientRect().x),
      ringTransforms: [...document.querySelectorAll('.ld-ripple-ring')].map(ring => getComputedStyle(ring).transform),
      ringOpacities: [...document.querySelectorAll('.ld-ripple-ring')].map(ring => getComputedStyle(ring).opacity),
      traceDash: getComputedStyle(document.querySelector('.ld-trace-spin')!).strokeDasharray,
      hexTraceDash: getComputedStyle(document.querySelector('.ld-hex-trace-spin')!).strokeDasharray
    }
  })
  expect(result.animations).toBe(0)
  expect(result.atomTransform).not.toBe('none')
  expect(new Set(result.dotPositions).size).toBe(3)
  expect(new Set(result.ringTransforms).size).toBe(3)
  expect(result.ringOpacities).toEqual(['0.4', '0.4', '0.4'])
  expect(result.traceDash).not.toBe('none')
  expect(result.hexTraceDash).not.toBe('none')
})

test('hex trace draws a regular hexagon and moves its dash along the perimeter', async ({ page }) => {
  const result = await page.evaluate(() => {
    const root = window.loaders.HexTrace({ cap: 'flat' })
    document.body.append(root)
    const polygon = root.querySelector<SVGPolygonElement>('.ld-hex-trace-spin')!
    const animation = polygon.getAnimations()[0]!
    animation.pause()
    animation.currentTime = 600
    return {
      radii: Array.from({ length: polygon.points.numberOfItems }, (_, index) => {
        const point = polygon.points.getItem(index)
        return Math.hypot(point.x - 10, point.y - 10)
      }),
      perimeter: polygon.getTotalLength(),
      cap: getComputedStyle(polygon).strokeLinecap,
      offset: getComputedStyle(polygon).strokeDashoffset,
      fill: getComputedStyle(polygon).fill
    }
  })
  expect(result.radii).toHaveLength(6)
  for (const radius of result.radii) expect(radius).toBeCloseTo(8.5, 4)
  expect(result.perimeter).toBeCloseTo(51, 4)
  expect(result.cap).toBe('butt')
  expect(result.offset).toBe('-50px')
  expect(result.fill).toBe('none')
})
