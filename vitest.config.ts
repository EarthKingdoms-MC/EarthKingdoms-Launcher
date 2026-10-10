import { defineConfig } from 'vitest/config'

// Tests de logique pure du process main (authentification, session de jeu, skins) :
// aucun Electron n'est lancé, le transport HTTP et le stockage sont injectés.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
})
