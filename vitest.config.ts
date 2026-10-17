import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests always run against the in-memory store with Gemini stubbed.
    env: {
      NODE_ENV: 'test',
      DATA_SOURCE: 'memory',
      GEMINI_API_KEY: '',
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
    },
  },
})
