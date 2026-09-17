# Reviewer Roles

Read-only reviewer/critic panel for the quality-review-fix loop (Phase 2).
Each reviewer receives the initiative summary, base commit, changed-surface
list, source-of-truth list, and the inventory item format from
`templates.md`.

## Reviewer Contract

Every reviewer must:

- stay read-only
- cite source standards and concrete file/command evidence
- classify each finding as `blocking`, `non-blocking`, `question`, or `note`
- distinguish changed-scope blockers from historical repo debt
- include suggested fixes and acceptance commands
- return `0 required findings` when no blockers remain

## Roles

1. Quality Gate Reviewer
   - Checks the quality commands, failures, warnings, generated config drift,
     package metadata, and repo sanity.

2. Architecture Boundary Reviewer
   - Checks module placement, dependency direction (domain never imports
     infrastructure), public vs internal surface, and layer composition at the
     application root.

3. Schema And Domain Reviewer
   - Checks schema-first models, `S.Class`, annotations, same-name schema/type
     exports, `S.Literals`, `OptionFrom*`, schema defaults/transforms, entity
     invariants, and table projection rules.
   - Suggested skill: `$schema-first-development`.

4. Effect Law Reviewer
   - Checks A/O/P/R/S aliases, typed errors, no unsafe TypeScript, no native
     runtime helpers in domain logic, `Effect.fn`, `Context.Service`, `Layer`,
     `Config`, `Redacted`, `Path`, `HttpClient`, resource handling, retries,
     timeouts, and concurrency.
   - Suggested skill: `$effect-first-development`.

5. Error Boundary Reviewer
   - Checks infrastructure errors are translated in adapters, service errors
     are translated before reaching protocol handlers, public errors do not
     leak internals, and dropped technical detail is logged at the translation
     boundary.

6. Testing Reviewer
   - Checks `@effect/vitest`, dependency stubs via `Layer.succeed`/`Layer.mock`,
     contract tests for multiple implementations, targeted coverage, and no
     `bun test` (tests run via `bun run test`).

7. Observability Reviewer
   - Checks span-per-boundary, `<module>.<concept>.<action>` naming,
     domain-semantic vs technical attributes, low-cardinality attributes, no
     secrets/PII, logging vs tracing vs console, and error-translation logs.

8. Documentation And API Reviewer
   - Checks public exports, JSDoc/TSDoc, compilable examples, lowercase
     `@category`, `@since`, useful conditional tags, docs that match behavior,
     and standards updates when code changed conventions.
   - Suggested skill: `$jsdoc-annotation-specialist`.

9. Reuse And Duplication Reviewer
   - Checks duplication, missed existing modules, and proposed abstractions.
     Rejects vague `common`, `core`, `utils`, or `lib` gravity. Requires a specific
     owning module first and at least two named consumers before extracting
     shared code.

10. Evolution And Deprecation Reviewer
    - Checks deprecation windows, feature-flag lifetime, migration notes,
      shared contract versioning, removal triggers, and whether a
      recorded decision is actually warranted.
