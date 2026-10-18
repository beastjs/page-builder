export const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/'

export function createNavigation(prefix: string) {
  const currentPath = () => normalizePath(location.pathname.slice(prefix.length))
  let timer: number | undefined
  const stop = () => { window.clearInterval(timer); timer = undefined }
  return {
    currentPath,
    go: (route: string) => location.assign(prefix + route),
    watch(onChange: (path: string) => void) {
      stop()
      let path = currentPath()
      timer = window.setInterval(() => {
        const next = currentPath()
        if (next === path) return
        path = next
        onChange(next)
      }, 250)
    },
    stop
  }
}
