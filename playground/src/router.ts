import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@octanejs/tanstack-router'
import App from './App.btsx'

const rootRoute = createRootRoute({ component: App })
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./pages/Home.btsx'))
})

const routeTree = rootRoute.addChildren([indexRoute])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@octanejs/tanstack-router' {
  interface Register {
    router: typeof router
  }
}
