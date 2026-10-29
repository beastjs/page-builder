import { BASE, type ClientConfig } from '../shared/types.js'

export const defaultConfig: ClientConfig = {
  shortcut: 'Mod+B', position: 'center', theme: 'light', scanDuration: 1600,
  launcher: true, pagesDir: 'src/pages', sectionsDir: 'src/sections', routerFile: 'src/router.ts'
}

// Vite's script URL carries its base; bundled Rspack/Rsbuild entries use the root endpoint.
export function apiPath(script: string): string {
  const path = new URL(script).pathname
  return path.endsWith(`${BASE}/client.js`) ? path.replace(/\/client\.js$/, '') : BASE
}

export function createApi(base: string) {
  return async function request<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${base}${route}`, {
      signal,
      ...(body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
    return data as T
  }
}
