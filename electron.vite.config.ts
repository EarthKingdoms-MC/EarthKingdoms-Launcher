import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    publicDir: resolve('public'),   // sert launcher/public/ à la racine (background.png, icons…)
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    }
  }
})
