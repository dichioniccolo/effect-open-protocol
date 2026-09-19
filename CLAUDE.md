
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

Tests run on Vitest with `@effect/vitest`: `bun run test` (turbo runs
`vitest run` under Bun in each package). Do not use `bun test` or `bun:test` — Bun's runner does
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

UIs are built with Next.js (App Router) and Tailwind CSS. Run Next through Bun
(`bun install`, `bun run dev`, `bunx next ...`); never npm/yarn/pnpm. Don't use
`vite`, and don't hand-roll a UI on `Bun.serve()` HTML imports.

State lives in Effect atoms wherever an atom fits: server data, derived
values, shared UI state. Reach for `useState`/context only for purely local,
throwaway component state.

- Core atoms ship in Effect v4 itself: `effect/unstable/reactivity`
  (`Atom`, `AtomRegistry`, `AtomRef`, `AtomRpc`, `AtomHttpApi`, `AsyncResult`,
  `Hydration`). No `@effect-atom/*` packages; those are the v3-era library.
- React bindings: `@effect/atom-react` (same monorepo as Effect, source in
  `.repos/effect/packages/atom/react`).
- Validate atom APIs against that source, not training-data priors.

Components come from shadcn/ui (Base UI primitives, `base-nova` style) and live
in `apps/ui/components/ui/`. Add them with `bunx --bun shadcn@latest add <name>` from
`apps/ui/` and follow the `shadcn` skill. Colors are shadcn's variable names with
this project's values, defined once in `apps/ui/app/globals.css`; use the semantic
utilities (`bg-background`, `text-muted-foreground`, `text-live`, ...), never
raw palette steps.

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
| Fuzzy idea / new initiative | explore skill |

### Effect reference source

Validate Effect v4 APIs against real source, not training-data priors. Run
`bash scripts/setup-effect-ref.sh` once to link `.repos/effect` (gitignored).

### Verification

- Type check: `bun run check` (root tooling, then `tsc --noEmit` in every
  workspace through turbo).
- Lint: `bun run lint` (oxlint, config in `.oxlintrc.json`).
- Format: `bun run format` (oxfmt, config in `.oxfmtrc.json`); CI-style
  check with `bun run format:check`.
- Tests: `bun run test` (see Testing above); target files with
  `bunx --bun vitest run <path>` from the root.
