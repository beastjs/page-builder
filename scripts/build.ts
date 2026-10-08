import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { $ } from 'bun'

await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: ['vite.ts', 'rspack.ts', 'rsbuild.ts'], outdir: 'dist',
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
})
await build({
  entryPoints: ['client/mount.ts'], outfile: 'dist/client.js', bundle: true,
  format: 'esm', target: 'es2022', minify: true, loader: { '.css': 'text' },
})
await $`bunx tsc -p tsconfig.build.json`
// Keep public declaration entrypoints next to their JavaScript exports.
for (const name of ['vite', 'rspack', 'rsbuild']) {
  await Bun.write(`dist/${name}.d.ts`, `export * from './types/${name}.js'\n`)
}
