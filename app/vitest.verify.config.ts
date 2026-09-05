import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Config for `npm run verify:real` only. The default suite deliberately does
 * not pick these up: they read the machine's real CLI directories and fetch
 * the live rate table, so they are neither hermetic nor reproducible.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
    testTimeout: 120_000
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
