import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

const nitroRuntime = fileURLToPath(import.meta.resolve('nitro/vite/runtime'))
const tanStackSsrHandler = resolve(dirname(nitroRuntime), 'internal/vite/ssr-renderer.mjs')

export default defineConfig({
  build: {
    rollupOptions: {
      input: 'index.html',
    },
  },
  plugins: [
    tanstackStart(),
    nitro({
      preset: 'vercel',
      renderer: { template: 'index.html', handler: tanStackSsrHandler },
    }),
    react(),
  ],
})
