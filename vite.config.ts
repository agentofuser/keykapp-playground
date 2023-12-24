/// <reference types="vitest" />
import { defineConfig } from 'vite'
// import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // ...configDefaults,
    // testMatch: ['**/*.test.tsx'],
    includeSource: ['src/**/*.{ts,tsx}'],
    typecheck: {
      enabled: true,
    },
  },
  define: {
    'import.meta.vitest': 'undefined',
  },
})
