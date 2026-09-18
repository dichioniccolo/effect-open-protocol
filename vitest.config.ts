import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "store/test/**/*.test.ts"],
    exclude: ["node_modules/**", ".repos/**"],
    passWithNoTests: true
  }
})
