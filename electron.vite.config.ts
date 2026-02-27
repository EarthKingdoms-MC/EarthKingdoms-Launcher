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
    base: './',                     // chemins relatifs dans le build → compatible file:// Electron
    plugins: [react()],
    publicDir: resolve('public'),   // sert launcher/public/ à la racine (background.png, icons…)
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    }
  }
})
