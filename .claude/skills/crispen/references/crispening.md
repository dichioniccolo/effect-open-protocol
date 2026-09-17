# Crispening reference

Two parts: **A. the toolkit** (what to reach for, the signature shape, and the
noise it kills) and **B. the moves** (before→after transforms). Everything here
is upstream `effect`; confirm signatures against `.repos/effect/packages/effect/SCHEMA.md`
and `src/Schema.ts` when in doubt.

```ts
import { Effect, Match, flow } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
```

---

## Part A — the crispening toolkit

### Defaults — kill `*Defaults` spreads and per-call boilerplate

| Symbol | Shape | Kills |
|--------|-------|-------|
| `S.withConstructorDefault(Effect.succeed(v))` | field default applied by `new X(...)` / `X.make(...)`; wire stays required | `version: 1` / `format: ""` repeated at every construction |
| `S.withConstructorDefault(Effect.succeed(O.none()))` on an `Option` field | `None` by default at construction | explicit `O.none()` at every `make` call |
| `S.withDecodingDefaultKey(Effect.succeed(v))` | default when the key is absent on decode | decode-time fallback objects |
| `S.withDecodingDefault(Effect.succeed(v))` | default when the key is absent or `undefined` on decode | `?? fallback` after decoding |
| `S.withDecodingDefaultTypeKey` / `S.withDecodingDefaultType` | same, but the default is given as the decoded `Type` | converting a typed default back to its encoded form |

> Constructor defaults leave the encoded/wire contract unchanged. Add a decoding
> default as well when a missing key on **decode** should also default.

### Guards & codecs — kill the top-of-file decode/guard wall

| Symbol | Shape | Kills |
|--------|-------|-------|
| in-body `static readonly is = S.is(Self)` | attach on `S.Class` / `S.TaggedClass` | a free-floating `const isX = S.is(X)` next to the class |
| `S.is(schema)` at the call site | derived guard | hand-written `isX` predicates |
| `S.decodeUnknownOption(schema)` / `S.decodeUnknownEffect(schema)` | soft / effectful decode | a wall of per-type decode helpers |
| `S.toEquivalence(schema)` | `(a, b) => boolean` | manual `===` / `!==` on decoded values |
| union `.guards` / `.cases` / `.match` (from `S.TaggedUnion` or `S.toTaggedUnion`) | per-variant guards, constructors, exhaustive match | hand-written variant predicates and `switch` blocks |

### Literal domains — collapse repeated variant families

| Symbol | API | Kills |
|--------|-----|-------|
| `S.Literals([...])` | `.literals`, `.members`, `.pick([...])`, `.mapMembers(...)`, `S.is(...)` | duplicate literal arrays, enum-like objects, ad-hoc literal guards, N near-identical nodes |
| `S.Literals([...]).transform([...])` | positional literal-to-literal mapping, both directions | a hand-written bidirectional lookup table plus its inverse |

> Do **not** add `as const` to the inline array; the const type parameters
> already preserve the tuple.

### Identity & errors — explicit identifiers, no `new Error`

```ts
import * as S from "effect/Schema"

// schema identifier + annotations
export class Heading extends S.TaggedClass<Heading>("Heading")(
  "heading",
  { level: HeadingLevel.annotateKey({ description: "Heading depth, 1–6." }) },
  { description: "A markdown heading." }
) {
  static readonly is = S.is(Heading)
}

// pipeable schema annotation
export const HeadingLevel = S.Literals([1, 2, 3, 4, 5, 6]).pipe(
  S.annotate({ identifier: "HeadingLevel", description: "Allowed heading depths." })
)

// typed error: omit the identifier unless a namespaced one is needed
class ParseError extends S.TaggedError<ParseError>()(
  "ParseError",
  { operation: S.String },
  { description: "Parsing failed." }
) {}

// boundary-translation error (declares message + cause explicitly)
class DomainError extends S.TaggedError<DomainError>()(
  "DomainError",
  { message: S.String, cause: S.Defect({ includeStack: true }) },
  { description: "A lower-level failure translated at the domain boundary." }
) {}
// Effect.fail(raw).pipe(Effect.mapError((cause) =>
//   new DomainError({ message: "Domain operation failed", cause })
// ))
```

Never pass an identifier equal to the tag.

### Terse behavior & tests

| Symbol | Use |
|--------|-----|
| `Match.tagsExhaustive({ tag: fn, … })` | the catamorphism: one arm per variant, exhaustiveness enforced. Adding a node = adding one arm. |
| `Effect.fn("Name")(function* …)` / `Effect.fnUntraced(...)` | production (traced) / tests + hot paths (untraced); never `(a) => Effect.gen(...)`. |
| `dual(2, impl)` | public 2–3-arg helpers get data-first + data-last forms. |
| `flow(...)` | passthrough `pipe` callbacks; direct helper refs over trivial lambdas. |
| `Arbitrary.schema(Schema)` (`effect/unstable/arbitrary`) + `@effect/vitest` | derive test data from the schema; delete hand fixtures. |

---

## Part B — before → after moves

**1. N near-identical nodes → one node with a literal field.** Kills repeated
match arms and lookup tables.
```ts
// before: H1..H6 as six S.TaggedClass nodes, six render arms, two lookup tables
// after:
export const HeadingLevel = S.Literals([1, 2, 3, 4, 5, 6]).pipe(
  S.annotate({ identifier: "HeadingLevel", description: "Allowed heading depths." })
)
export class Heading extends S.TaggedClass<Heading>("Heading")("heading",
  { level: HeadingLevel, children: S.Array(Inline) }, { description: "A markdown heading." }) {
  static readonly is = S.is(Heading)
}
// one render arm: heading: (b) => `${"#".repeat(b.level)} ${inline(b.children)}`
// h1…h6 stay as thin builders that construct Heading with a level.
```

**2. Decode/guard header wall → derived helpers at the call site or as statics.**
```ts
// before: const isBlock = S.is(Block); const decodeBlock = S.decodeUnknownOption(Block); // ×N at file top
// after:
export const Block = S.Union([Heading, Paragraph, BlockQuote]).pipe(S.toTaggedUnion("_tag"))
// call sites: Block.guards.heading(x) / S.decodeUnknownOption(Block)(raw)
```

**3. `*Defaults` spreads → schema-field defaults.**
```ts
// before: new ParagraphNode({ ...ParagraphDefaults, children })  // version:1, format:"", indent:0 …
// after (fields carry their own defaults):
version: S.Int.pipe(S.withConstructorDefault(Effect.succeed(1))),
format: ElementFormat.pipe(S.withConstructorDefault(Effect.succeed<ElementFormat>(""))),
indent: S.Int.pipe(S.withConstructorDefault(Effect.succeed(0))),
direction: S.Option(Direction).pipe(S.withConstructorDefault(Effect.succeed(O.none()))),
// call site: new ParagraphNode({ children })
```

**4. Nullable field + null-ternary → `Option` field.**
```ts
// before: backgroundColor: string | null;  … color != null ? color : fallback
// after:
backgroundColor: S.OptionFromNullOr(S.String),
// use: O.getOrElse(cell.backgroundColor, () => fallback) — no null in domain code.
```

**5. Duplicated imperative loop → one shared `dual` combinator.**
```ts
// before: let runs = []; for (const c of children) { if (isInline(c)) …push… }  // repeated in every renderer
// after: one combinator, data-first or data-last, no let/for/push:
export const segmentInlineRuns: {
  <I, B>(items: ReadonlyArray<I | B>, s: SegmentStrategy<I, B>): ReadonlyArray<string>
  <I, B>(s: SegmentStrategy<I, B>): (items: ReadonlyArray<I | B>) => ReadonlyArray<string>
} = dual(2, (items, s) => A.match(items, {
  onEmpty: A.empty<string>,
  onNonEmpty: flow(A.groupWith((l, r) => s.isInline(l) === s.isInline(r)), A.flatMap(/* … */))
}))
```

**6. Hand fixtures → schema-derived property laws.**
```ts
import { it } from "@effect/vitest"

it.prop("round-trips losslessly", [Document], ([doc]) =>
  S.is(Document)(roundTrip(doc)))
// codec law: A → B → A stabilizes after one pass (the lossiness profile IS the law).
```

**7. Module role split.** Behavior moves off the schema file; `.model.ts` stays
pure, breaking model↔utils cycles.
```
Md.model.ts    — schemas only (S.TaggedClass, S.Literals, defaults)
Md.behavior.ts — pure projections (plain text, run segmentation)
Md.escape.ts   — escaping / URL sanitization (trust boundary — stays explicit + tested)
Md.render.ts   — render adapters (Match.tagsExhaustive matchers)
Md.ts          — public builder namespace
```
No module needs all five suffixes; pick per module.

**8. Lesson — a value→function schema is a breaking change.** Exposing a typed
`Effect<A, E, R>` schema requires a phantom-typed function
(`export const EffectSchema = <A, E, R>() => S.declare<Effect.Effect<A, E, R>>(isEffect, …)`),
because `S.declare` can't runtime-check type arguments. Turning a schema
**value** into a **function** breaks every value-form consumer: tests and
`**Example**` blocks must call `EffectSchema()`. When you parameterize a schema,
sweep guard/decode/example call sites in the same change.
