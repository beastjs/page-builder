import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, platform, arch, totalmem } from 'node:os'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ProjectScan } from '../shared/types.js'

// Run after `bun run build`, with other browser/CPU-heavy checks finished.
// These are synthetic native events, not an assertion of physical keyboard-to-paint latency.
const output = resolve(process.argv[2] ?? 'test-results/client-performance.json')
const editorOnly = process.argv.includes('--editor-only')
const client = await readFile('dist/client.js')
const counts = [1_000, 5_000, 10_000]
const warmups = 5
const samples = 30
const sourceFixture = 'main\n' + '  p Benchmark source content\n'.repeat(2_000)
const config = {
  shortcut: 'Mod+B', position: 'center', theme: 'light', scanDuration: 0,
  launcher: true, pagesDir: 'src/pages', routerFile: 'src/router.ts'
}
let inventory: ProjectScan
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method !== 'GET') return new Response('Read-only benchmark', { status: 405 })
    if (path === '/__beast-page-builder/client.js') return new Response(client, { headers: { 'Content-Type': 'text/javascript' } })
    if (path === '/__beast-page-builder/config') return Response.json(config)
    if (path === '/__beast-page-builder/scan') return Response.json(inventory)
    if (path === '/') return new Response('<!doctype html><html><head><title>Builder measurement fixture</title></head><body><h1>Builder measurement fixture</h1><script type="module" src="/__beast-page-builder/client.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } })
    return new Response('Not found', { status: 404 })
  }
})
const browser = await chromium.launch({ headless: true }).catch(error => { server.stop(true); throw error })
const errors: string[] = []
const results: { files: number; metrics: Record<string, ReturnType<typeof summarize>> }[] = []
const environment = {
  timestamp: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  clientSha256: createHash('sha256').update(client).digest('hex'), clientBytes: client.length,
  platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
  memoryGiB: Math.round(totalmem() / 1024 ** 3), bun: Bun.version, browser: browser.version(),
  viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', cpuThrottling: 1
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    samples: values.length, medianMs: round(sorted[Math.floor(sorted.length / 2)]!),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]!), maxMs: round(sorted.at(-1)!),
    valuesMs: values.map(round)
  }
}
try {
  for (const count of counts) {
    inventory = {
      sections: [],
      name: `${count} file fixture`, scannedAt: '', warnings: [], collections: [], pageRoutes: [], tabComponents: [], tabInstances: [],
      navigationTargets: [{ id: 'main', file: 'src/Header.btsx', label: 'Main menu' }],
      files: Array.from({ length: count }, (_, index) => ({
        name: `Fixture${String(index).padStart(6, '0')}`, path: `src/${index % 2 ? 'components' : 'pages'}/Fixture${String(index).padStart(6, '0')}.btsx`,
        kind: index % 2 ? 'component' : 'page', lines: 40, components: [], error: null
      }))
    }
    const context = await browser.newContext({ viewport: environment.viewport, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(server.url.href)
    await page.getByRole('button', { name: 'Open Beast page builder', exact: true }).click()
    await page.getByText('Builder ready', { exact: true }).waitFor()
    const metrics: Record<string, ReturnType<typeof summarize>> = {}
    // Each sample includes event dispatch, the widget's synchronous commit and forced layout.
    // Preparing the starting state and waiting for a frame are outside the timed region.
    for (const operation of editorOnly ? [] : ['narrow', 'expand', 'retained', 'selection'] as const) {
      const values = await page.evaluate(async ({ operation, count, warmups, samples }) => {
        const root = document.querySelector('#beast-page-builder')!.shadowRoot!
        const input = root.querySelector<HTMLInputElement>('.search')!
        const panel = root.querySelector<HTMLElement>('.panel')!
        const update = (value: string) => {
          input.value = value
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        }
        const values: number[] = []
        input.focus()
        for (let index = 0; index < warmups + samples; index++) {
          if (operation === 'narrow') update('Fixture')
          if (operation === 'expand') update('Fixture000001')
          if (operation === 'retained' || operation === 'selection') update('Fixture')
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          const start = performance.now()
          if (operation === 'selection') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
          else update(operation === 'narrow' ? 'Fixture000001' : operation === 'expand' ? '' : 'fixture')
          panel.getBoundingClientRect()
          // Force layout of the scrollable result list as well as the shell.
          root.querySelector<HTMLElement>('.results')!.scrollHeight
          const elapsed = performance.now() - start
          const rows = root.querySelectorAll('.result').length
          if (operation !== 'expand' && rows !== (operation === 'narrow' ? 1 : count))
            throw new Error(`Unexpected result count for ${operation}: ${rows}`)
          if (operation === 'expand' && rows < count) throw new Error('Expanded inventory is incomplete')
          if (operation === 'selection' && root.querySelector<HTMLElement>('.result.selected')?.dataset.index !== '1')
            throw new Error('Keyboard selection was not committed')
          if (root.activeElement !== input) throw new Error('Palette lost focus')
          if (index >= warmups) values.push(elapsed)
        }
        return values
      }, { operation, count, warmups, samples })
      metrics[`palette_${operation}`] = summarize(values)
      console.log(`${count} files, palette ${operation}: median ${metrics[`palette_${operation}`]!.medianMs} ms; p95 ${metrics[`palette_${operation}`]!.p95Ms} ms`)
    }
    await page.getByRole('textbox', { name: /Search pages/ }).fill('')
    await page.getByRole('button', { name: /Create a new page/ }).click()
    if (await page.locator('.result').count()) throw new Error('Palette rows remained mounted in the editor')
    for (const operation of ['name', 'source'] as const) {
      const measured = await page.evaluate(async ({ operation, warmups, samples, sourceFixture }) => {
        const root = document.querySelector('#beast-page-builder')!.shadowRoot!
        const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(operation === 'name' ? '#page-name' : '.source-editor')!
        const panel = root.querySelector<HTMLElement>('.panel')!
        const source = sourceFixture
        const values: number[] = []
        const eventValues: number[] = []
        input.focus()
        for (let index = 0; index < warmups + samples; index++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          const next = operation === 'name' ? `Benchmark${index}Page` : source + `  p ${index}\n`
          const start = performance.now()
          input.value = next
          input.setSelectionRange(next.length, next.length)
          const eventStart = performance.now()
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
          panel.getBoundingClientRect()
          input.scrollHeight
          const finished = performance.now()
          if (root.activeElement !== input || input.value !== next || input.selectionStart !== next.length)
            throw new Error('Editor lost its value, caret, or focus')
          if (operation === 'name' && root.querySelector<HTMLInputElement>('#route-path')!.value !== `/benchmark${index}`)
            throw new Error('Suggested route was not committed')
          if (index >= warmups) {
            values.push(finished - start)
            eventValues.push(finished - eventStart)
          }
        }
        return { values, eventValues }
      }, { operation, warmups, samples, sourceFixture })
      metrics[`editor_${operation}`] = summarize(measured.values)
      metrics[`editor_${operation}_event`] = summarize(measured.eventValues)
      console.log(`${count} files, editor ${operation}: median ${metrics[`editor_${operation}`]!.medianMs} ms; p95 ${metrics[`editor_${operation}`]!.p95Ms} ms`)
      console.log(`${count} files, editor ${operation} event to layout: median ${metrics[`editor_${operation}_event`]!.medianMs} ms; p95 ${metrics[`editor_${operation}_event`]!.p95Ms} ms`)
    }
    results.push({ files: count, metrics })
    await context.close()
  }
  if (errors.length) throw new Error(errors.join('\n'))
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({
    environment, method: 'Synthetic native input/keydown through synchronous DOM commit and forced layout. Total includes input.value assignment and caret placement; editor _event metrics start at input event dispatch. Excludes starting-state preparation, network, scan, frame wait, and paint.',
    fixture: { counts, warmups, samples, editorOnly, kinds: '50% pages, 50% components; no collections or tab groups', sourceLines: 2002, sourceBaseBytes: Buffer.byteLength(sourceFixture), sourceSuffix: '  p <sample number>\n' },
    results
  }, null, 2) + '\n')
  console.log(`Saved measurements to ${output}`)
} finally {
  await browser.close()
  await server.stop(true)
}
