import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // A fixed non-UTC zone with DST, so local-day handling is exercised rather
    // than accidentally passing because everything was UTC.
    env: { TZ: 'America/Chicago' },
  },
})
