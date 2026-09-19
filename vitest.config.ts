import { defineConfig } from "vitest/config"

// Lets `bunx vitest run <path>` target any package's tests from the repo root;
// `bun run test` goes through turbo, one vitest run per package.
export default defineConfig({
  test: {
    projects: ["packages/*"]
  }
})
