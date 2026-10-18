import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import { $ } from 'bun'
import { compileBeastResult, mapGeneratedError } from 'beast-tsrx'
import { createOctaneCompiler } from 'octane/compiler/bundler'

await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: ['vite.ts', 'rspack.ts', 'rsbuild.ts'], outdir: 'dist',
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
})
const compiler = createOctaneCompiler({ root: process.cwd(), environment: 'client', dev: false, hmr: false })
await build({
  entryPoints: ['client/mount.ts'], outfile: 'dist/client.js', bundle: true,
  format: 'esm', target: 'es2022', minify: true, loader: { '.css': 'text', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'beast-octane',
    setup(builder) {
      // Compile widget components and source-distributed Octane bindings at package build time.
      builder.onLoad({ filter: /\.(?:btsx|tsrx|[cm]?[jt]sx?)$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        const beast = path.endsWith('.btsx') ? compileBeastResult(source, { filename: path }) : null
        try {
          const result = compiler.transform(beast?.code ?? source, beast ? path.replace(/\.btsx$/, '.tsrx') : path)
          if (!result) return
          return { contents: result.code, loader: 'ts' }
        } catch (error) {
          throw beast ? mapGeneratedError(error, beast.map, source, path, beast.code) : error
        }
      })
    }
  }],
})
await $`bunx tsc -p tsconfig.build.json`
// Keep public declaration entrypoints next to their JavaScript exports.
for (const name of ['vite', 'rspack', 'rsbuild']) {
  await Bun.write(`dist/${name}.d.ts`, `export * from './types/${name}.js'\n`)
}
