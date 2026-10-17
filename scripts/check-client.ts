import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { compileBeastResult } from 'beast-tsrx'

// tsrx-tsc checks native TSRX. Mirror the client so it also checks BTSX's generated
// types without leaving generated siblings next to authored components.
const cache = resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const root = await mkdtemp(join(cache, 'beast-client-'))
try {
  await cp('client', join(root, 'client'), { recursive: true })
  await cp('shared', join(root, 'shared'), { recursive: true })
  await cp('src/components/loaders', join(root, 'src/components/loaders'), { recursive: true })
  await cp('src/lib/loaders', join(root, 'src/lib/loaders'), { recursive: true })
  for await (const path of new Bun.Glob('**/*.btsx').scan('client')) {
    const filename = join('client', path)
    const { code } = compileBeastResult(await readFile(filename, 'utf8'), { filename })
    const target = join(root, filename.replace(/\.btsx$/, '.tsrx'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, code.replace(/(from\s+['"][^'"]+)\.btsx(['"])/g, '$1.tsrx$2'))
  }
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    tsrx: { compiler: 'octane/compiler' },
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, skipLibCheck: true, noEmit: true,
      jsx: 'preserve', jsxImportSource: 'octane',
      allowImportingTsExtensions: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['node', 'bun']
    },
    include: ['client/**/*.tsrx']
  }))
  const check = Bun.spawn(['node', 'node_modules/@tsrx/typescript-plugin/dist/tsc.js', '-p', join(root, 'tsconfig.json')], { stdout: 'inherit', stderr: 'inherit' })
  process.exitCode = await check.exited
} finally {
  await rm(root, { recursive: true, force: true })
}
