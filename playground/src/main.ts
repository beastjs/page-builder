import { createRoot } from 'octane'
import { RouterProvider } from '@octanejs/tanstack-router'
import { router } from './router'
import './style.css'

createRoot(document.getElementById('app')!).render(RouterProvider, { router })
