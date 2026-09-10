import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig({
  build: {
    rollupOptions: {
      output: { entryFileNames: 'assets/[name].js' },
    },
  },
  plugins: [
    tanstackStart(),
    nitro({
      preset: 'vercel',
      renderer: { template: 'index.html' },
    }),
    react(),
  ],
})
