---
name: jsdoc-annotation-specialist
description: >
  JSDoc/TSDoc and schema annotation compliance: Effect-style section grammar,
  kind-aware Examples, described @see, missing schema identifier/description
  annotations, TSDoc violations, non-compiling examples, and documentation
  post-passes on exported symbols.
version: 0.3.0
status: active
---

# JSDoc Annotation Specialist

Use this skill to author, upgrade, or review JSDoc and schema annotations. The
binding source is `.patterns/jsdoc-documentation.md`; this skill turns that law
into a repeatable editing posture.

## References

- `references/conventions.md` — section grammar, kind split, tag order, worked
  before/after block, imports, categories, and forbidden patterns.
- `references/annotation-patterns.md` — schema `identifier`/`description`
  annotations by schema kind, including same-name type companions.
- `references/agent-lifting-and-greps.md` — agent-context lifting and focused
  grep audits.

Load `references/conventions.md` whenever writing or upgrading a doc block. Load
the annotation reference for schemas and the grep reference for multi-file audits.

## Authoring workflow

1. Inventory the owning declarations for public exports; do not document barrel
   re-exports as though they were new symbols.
2. Classify each export as value-level or pure type-level.
3. Write one lead paragraph that explains purpose rather than restating the
   signature.
4. Add only useful body sections in this order: `**When to use**`, `**Details**`,
   `**Gotchas**`, then titled `**Example** (Title)` blocks.
5. Require an Example for value-level exports. For pure type-level exports, require
   prose and add an Example only when it teaches something material.
6. Never introduce `@example` or `@remarks`. Move `@remarks` content into Details
   or Gotchas and write examples as titled Example sections.
7. Add conditional tags only for facts absent from the signature, order them per
   `references/conventions.md`, and describe every `@see` with a purpose phrase.
8. Verify `@category`, `@since 0.0.0`, TSDoc grammar, imports, and Example safety.
9. For schema values, verify `identifier`/`description` annotations using the
   annotation reference.
10. Check that Examples compile (`bunx tsc --noEmit` on a scratch copy when in
   doubt) and fix failures.

## Section grammar

- Sections are optional except for kind-required Examples.
- Present sections are non-empty, unique, and ordered exactly:
  When to use -> Details -> Gotchas -> Examples last.
- The When-to-use body begins with `Use to`, `Use when`, `Use as`, or `Use with`.
- Every Example title is non-empty and unique within its doc block.
- Each Example has exactly one `ts` fence; no `ts` fence is loose outside an
  Example section.
- Tags follow all body sections.

`**Example** (Title)` is canonical everywhere. The legacy `@example`/`@remarks`
carriers are not used in this repo.

## Kind split

Value-level exports require an Example: functions, constants, classes, schemas,
services, layers, and other runtime values. Pure type-level exports require prose
only: aliases, interfaces, namespaces, `.Encoded` companions, and same-name schema
type companions. Their Example is optional.

## TSDoc hard rules

- Drop `{type}` blobs from `@param`, `@returns`, and `@throws`; the signature owns
  the type.
- Use `@typeParam`, never `@template`.
- Use a hyphen only in `@param name - description`, never after `@returns` or
  `@throws`.
- Use `@packageDocumentation`, never `@module`.
- Use Details or Gotchas, never `@remarks`.
- Every `@deprecated` links its replacement and explains the migration.
- Every `@see` contains a link plus a purpose phrase.

## Post-pass checklist

1. Every owning export has a useful one-paragraph lead, canonical `@category`, and
   `@since 0.0.0`.
2. Every value-level export has a titled, single-fence, observable, compilable
   Example; pure type-level exports have precise prose.
3. Sections are non-empty, unique, canonical-order, and Example-last; When-to-use
   text has an allowed opener; no loose `ts` fence exists.
4. Files whose documentation was touched have no `@remarks` or legacy `@example`
   carrier.
5. Conditional tags add information, follow tag order, and every `@see` is
   described.
6. Examples use `S`/`A`/`O`/`P`/`R` namespaces, contain no `any`, assertions,
   `declare`, empty generators, or deprecated `@effect/schema` imports.
7. Schema annotations and same-name type companions follow
   `references/annotation-patterns.md`.
8. Examples compile and `bunx tsc --noEmit` passes.

## Escalation

- `schema-first-development` — schema modeling beyond annotation work.
- `effect-first-development` — code changes broader than documentation.
- `.patterns/error-handling.md` — new tagged-error hierarchies.

## Source references

- `.patterns/jsdoc-documentation.md` — binding JSDoc/TSDoc law
- `references/conventions.md` — categories and worked examples
- `.repos/effect/packages/effect/src/` — upstream Effect source, the reference
  style for Effect-flavored JSDoc
