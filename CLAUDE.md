
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun run test` (Vitest + `@effect/vitest`) instead of `jest` or `bun test`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Tests run on Vitest with `@effect/vitest`: `bun run test` (runs
`vitest run` under Bun). Do not use `bun test` or `bun:test` — Bun's runner does
not support `@effect/vitest`.

```ts#index.test.ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

describe("hello world", () => {
  it.effect("runs an effect", () =>
    Effect.gen(function* () {
      const value = yield* Effect.succeed(1)
      expect(value).toBe(1)
    }))
})
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Effect Agent Setup

Agent rules, skills, and docs for Effect v4, using
plain `effect/Schema` and `Context.Service` (no helper packages).

- Effect-first code laws: `.claude/skills/effect-first-development/SKILL.md`
  (full standard: `standards/effect-first-development.md`, `standards/effect-laws-v1.md`).
- Schema work: `.claude/skills/schema-first-development/SKILL.md`
  (session template: `standards/schema-first-development-prompt.md`).
- Patterns: `.patterns/` (error handling, testing, module organization, JSDoc, library dev).
- Agents in `.claude/agents/`: effect-first-developer, schema-first-developer,
  code-patterns-strategist, crispener, jsdoc-annotation-specialist,
  modularization-analyst, architecture-guardian.
- Idea → work pipeline: `/explore` skill with `explorations/` packets that
  graduate into `goals/` packets; `/reflect` writes goal closeout reflections.

### Code Laws

- Use schema-first domain models; prefer typed errors and tagged unions.
- Prefer effect helper modules (`String`, `Equal`, ...) over native helpers;
  keep root `effect` imports for core combinators.
- Prefer match helpers over conditional chains; prefer service composition
  over global state; keep service boundaries explicit.
- Prefer the tersest equivalent helper form when behavior is unchanged.
- Before recreating a helper, schema, or service, search existing source first.

### Touch → Skill

| Touch | Load |
| --- | --- |
| Domain models / schemas | schema-first-development skill |
| Effect service / Layer | effect-first-development skill |
| JSDoc on exports | `.patterns/jsdoc-documentation.md` |
| Effect Atom frontend state | atom-reactivity-specialist skill |
| Fuzzy idea / new initiative | explore skill |

### Effect reference source

Validate Effect v4 APIs against real source, not training-data priors. Run
`bash scripts/setup-effect-ref.sh` once to link `.repos/effect` (gitignored).

### Verification

- Type check: `bunx tsc --noEmit`.
- Tests: `bun run test` (see Testing above); target files with
  `bun run test <path>`.
