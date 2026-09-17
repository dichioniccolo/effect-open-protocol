# Effect Laws v1

Compact, enforceable laws for this codebase. Keep agent-facing files terse; keep details here.

## Short Laws (authoritative)

1. Use `A/O/P/R/S` aliases only:
   - `import * as A from "effect/Array"`
   - `import * as O from "effect/Option"`
   - `import * as P from "effect/Predicate"`
   - `import * as R from "effect/Record"`
   - `import * as S from "effect/Schema"`
2. For other stable helper/data modules, prefer dedicated namespace imports (`effect/String` as `Str`, `effect/Equal` as `Eq`, `effect/Boolean` as `Bool`, etc.); reserve root `effect` imports for core combinators/types such as `Effect`, `Match`, `pipe`, and `flow`.
3. `effect/unstable/*` imports are allowed when needed.
4. No `any`, type assertions, `@ts-ignore`, or non-null assertions.
5. No runtime `typeof ... === ...`; use `effect/Predicate` guards.
6. No native `Object/Map/Set/Date` in domain logic.
7. No native `Error` in production source; extend `S.TaggedError` from `effect/Schema` directly for typed errors. Intentional low-level runtime exceptions carry a comment explaining why.
8. No `node:path` in runtime source; use `Path.Path` service APIs.
9. No native `fetch` in runtime source; use `effect/unstable/http` and provide platform client layers.
10. No native `Array.prototype.sort`; use `A.sort` with explicit `Order`.
11. No native `switch` statements; use `Match`, `Match.tagsExhaustive` for `_tag` unions, and schema `.match` for tagged-union schemas.
12. Use `Bool.match` for boolean branching in domain/runtime orchestration code.
13. Prefer schema defaults and transformations (`S.withDecodingDefault*`, `S.decodeTo`, `SchemaTransformation`) over ad-hoc parsing/fallback logic.
14. HTTP boundaries must be expressed with Effect HTTP modules (`HttpClientRequest`, `HttpClientResponse`, `Headers`, `UrlParams`, `HttpMethod`, `HttpBody`).
15. JSDoc is required for exported APIs in `src/`; examples must compile.
16. Do not finish work with failing `bunx tsc --noEmit` or tests.
17. Named or reused domain constraints are modeled as schemas first; prefer built-in schema constructors/checks before `S.makeFilter`, and derive guards with `S.is(...)`.
18. Reusable `S.makeFilter`, `S.makeFilterGroup`, and reusable built-in check blocks must include `identifier`, `title`, and `description`; `message` stays user-facing.
19. Model internal literal domains as one named, annotated `S.Literals([...])` schema; derive guards with `S.is(...)` and subsets with `.pick([...])`.
20. Model finite variants, lifecycle states, status/result cases, and case-specific payloads as discriminated unions; keep optional/nullish bags at external boundaries only when compatibility requires them.
21. Prefer the tersest equivalent Effect helper form when behavior is unchanged: direct helper refs over trivial wrapper lambdas, `flow(...)` for passthrough `pipe(...)` callbacks, and shared thunk helpers when already in scope.
22. Reusable functions that directly return `Effect.gen(function*)` must use `Effect.fn` or `Effect.fnUntraced`; zero-arg one-off effect values may stay as `Effect.gen`.
23. Keep functions small and low in complexity. Prefer real seams (match helpers, schema/data-table dispatch, named concept extraction) over threshold-appeasement fragmentation.

## Exceptions

Boundary exceptions (e.g. a native `Error` required by a third-party callback
API) are allowed only at real runtime boundaries. Mark each one with a comment
naming the reason; do not add exceptions for cleanup convenience. Remove the
comment in the same change that removes the exception.

## Scope

Applies to all source under `src/`.

Excludes by default:

- tests and fixtures
- generated artifacts

## Deep References

- [JSDoc patterns](../.patterns/jsdoc-documentation.md)
- [Effect library development patterns](../.patterns/effect-library-development.md)
- [Effect-first development](./effect-first-development.md)
