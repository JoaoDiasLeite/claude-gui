import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // Main window + quick-launcher overlay + approval toast + status pill
          // auxiliary windows (see src/main/overlay.ts, toast.ts, pill.ts).
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          toast: resolve('src/renderer/toast.html'),
          pill: resolve('src/renderer/pill.html')
        }
      }
    }
  }
})
