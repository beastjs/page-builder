import { expect, test } from 'bun:test'
import { build } from 'esbuild'
import { builtinModules } from 'node:module'
import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'

// Consumers receive dist/ without this repository's devDependencies or source tree.
test('published artifacts contain a self-contained client and declare every server runtime import', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const declared = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)])
  const builtin = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
  for (const entry of ['client', 'vite', 'rspack', 'rsbuild']) {
    const path = `dist/${entry}.js`
    const result = await build({ entryPoints: [path], bundle: false, write: false, metafile: true, logLevel: 'silent' })
    const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports)
    if (entry === 'client') expect(imports).toEqual([])
    else {
      expect(imports.length).toBeGreaterThan(0)
      for (const item of imports) {
        if (builtin.has(item.path)) continue
        // Local runtime imports must ship alongside the entry, never reach into source.
        if (item.path.startsWith('.')) {
          const target = resolve('dist', item.path)
          expect(target.startsWith(resolve('dist') + '/')).toBe(true)
          await access(target)
        } else {
          const name = item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0]!
          expect(declared.has(name), `${path} imports undeclared runtime dependency ${name}`).toBe(true)
        }
      }
    }
  }
  for (const entry of Object.values(pkg.exports) as { default: string; types: string }[]) {
    await access(entry.default)
    await access(entry.types)
  }
  for (const name of ['vite', 'rspack', 'rsbuild']) await access(`dist/types/${name}.d.ts`)
})
