export const ROUTER = `import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@octanejs/tanstack-router'
import App from './App.btsx'
const rootRoute = createRootRoute({ component: App })
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: lazyRouteComponent(() => import('./pages/HomePage.btsx')) })
const routeTree = rootRoute.addChildren([indexRoute])
export const router = createRouter({ routeTree, defaultPreload: 'intent' })
`
export const HEADER = `import { Link } from '@octanejs/tanstack-router'
header
  nav.menu
    Link(to="/") Home
`
