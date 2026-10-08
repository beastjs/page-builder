import { defineConfig } from 'vite'
import { beastOctane } from 'beast-tsrx/vite'
import { beastPageBuilder } from '../dist/vite.js'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [beastOctane(), beastPageBuilder()],
  server: { port: 5190, strictPort: true, host: '127.0.0.1' },
})
