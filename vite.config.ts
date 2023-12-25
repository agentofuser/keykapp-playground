/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { node } from '@liuli-util/vite-plugin-node'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), node({ entry: 'src/index.tsx', dts: true })],
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
  resolve: {
    mainFields: ['module', 'main'],
  },
})
