// Octane 0.4.3 exports this runtime entry without declarations.
declare module 'octane/compiler/bundler' {
  export interface CompilerOptions { root?: string; environment?: 'client' | 'server'; hmr?: false | 'vite'; dev?: boolean }
  export interface OctaneBundlerCompiler {
    transform(code: string, id: string, options?: CompilerOptions): { code: string; map: unknown } | null
  }
  export function createOctaneCompiler(options?: CompilerOptions): OctaneBundlerCompiler
}
