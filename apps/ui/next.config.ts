import type { NextConfig } from "next"
import { fileURLToPath } from "node:url"

const config: NextConfig = {
  // The database driver imports `bun:sqlite`, which no bundler can read, so it
  // is left for the Bun runtime to load.
  serverExternalPackages: ["bun:sqlite"],
  // Next writes its own AGENTS.md and CLAUDE.md into the app unless told not to;
  // this repo keeps agent guidance at the root.
  agentRules: false,
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url))
  }
}

export default config
