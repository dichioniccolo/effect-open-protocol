import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "simulator/**/*.test.ts", "*.test.ts"],
    exclude: ["node_modules/**", ".repos/**"],
    passWithNoTests: true
  }
})
