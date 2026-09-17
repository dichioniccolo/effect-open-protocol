# Examples

Starting points for matching repo style. Confirm nontrivial APIs against
`.repos/effect/packages/effect/SCHEMA.md`.

## 1. Protocol Payloads and Literal Domains

Use when you need a literal domain, an annotated filter, and a class payload.

```ts
import * as S from "effect/Schema"

export const GenerationActionKind = S.Literals(["create", "overwrite", "skip"]).annotate({
  identifier: "GenerationActionKind",
  description: "What a generator does with a planned file."
})
export type GenerationActionKind = typeof GenerationActionKind.Type

export const RelativePlanPath = S.NonEmptyString.check(
  S.makeFilter((value: string) => !value.startsWith("/"), {
    identifier: "RelativePlanPathCheck",
    title: "Relative Plan Path",
    description: "A path relative to the generation root.",
    message: "Expected a relative path"
  })
).pipe(S.brand("RelativePlanPath"))
export type RelativePlanPath = typeof RelativePlanPath.Type

export class PlannedFile extends S.Class<PlannedFile>("PlannedFile")(
  {
    path: RelativePlanPath,
    action: GenerationActionKind,
    contents: S.String
  },
  { description: "A file the generator plans to write." }
) {}
```

Why it matters: the schema value is reused for runtime validation, types, and
guards; small protocol payloads stay schema-first.

## 2. Defaults and Normalization in the Schema

Use when a field has a default or needs normalization.

```ts
import { Effect } from "effect"
import * as S from "effect/Schema"

export class DockSettings extends S.Class<DockSettings>("DockSettings")(
  {
    // Constructor default: `new DockSettings({})` fills it in.
    allowance: S.Int.pipe(S.withConstructorDefault(Effect.succeed(0))),
    // Decoding default: missing key or `undefined` on the wire decodes to "left".
    side: S.Literals(["left", "right"]).pipe(S.withDecodingDefault(Effect.succeed("left" as const)))
  },
  { description: "User-adjustable dock settings." }
) {}
```

Why it matters: defaults live next to the field definition, not in ad-hoc
runtime fallback objects.

## 3. Optional Data and Typed Errors at a Boundary

Use when decoding external config into `Option` fields with a typed error.

```ts
import { Effect } from "effect"
import * as S from "effect/Schema"

export class DocsConfig extends S.Class<DocsConfig>("DocsConfig")(
  {
    outDir: S.String,
    theme: S.OptionFromOptionalKey(S.String)
  },
  { description: "Documentation generator configuration." }
) {}

export class ConfigDecodeError extends S.TaggedError<ConfigDecodeError>()(
  "ConfigDecodeError",
  { message: S.String },
  { description: "The configuration file did not match the expected shape." }
) {}

const DocsConfigJson = S.fromJsonString(DocsConfig)

export const decodeDocsConfig = Effect.fn("DocsConfig.decode")(function* (raw: string) {
  return yield* S.decodeUnknownEffect(DocsConfigJson)(raw).pipe(
    Effect.mapError((error) => new ConfigDecodeError({ message: error.message }))
  )
})
```

Why it matters: optional transport fields become `Option` immediately, and the
schema error is mapped to a typed boundary error.

## 4. Tagged Unions With a Custom Discriminator

Use when a union is discriminated by `kind`, `type`, `status`, etc.

```ts
import { Tuple } from "effect"
import * as S from "effect/Schema"

const MutationKind = S.Literals(["addImport", "removeImport"])

export class AddImport extends S.Class<AddImport>("AddImport")({
  kind: S.tag("addImport"),
  module: S.String
}) {}

export class RemoveImport extends S.Class<RemoveImport>("RemoveImport")({
  kind: S.tag("removeImport"),
  module: S.String
}) {}

export const Mutation = MutationKind
  .mapMembers(Tuple.evolve([() => AddImport, () => RemoveImport]))
  .annotate({ identifier: "Mutation", description: "A source-file mutation." })
  .pipe(S.toTaggedUnion("kind"))
export type Mutation = typeof Mutation.Type

export const describeMutation = (mutation: Mutation) =>
  Mutation.match(mutation, {
    addImport: ({ module }) => `add ${module}`,
    removeImport: ({ module }) => `remove ${module}`
  })

const moduleEquivalence = S.toEquivalence(S.String)
```

Why it matters: the case set is anchored to the literal domain, and branching
uses the schema-derived `.match` instead of manual `switch`.

## 5. Canonical `_tag` Unions

Use `S.TaggedUnion` when the discriminator is `_tag`.

```ts
import * as S from "effect/Schema"

export const TaskEvent = S.TaggedUnion({
  Created: { id: S.String },
  Completed: { id: S.String, at: S.String }
}).annotate({ identifier: "TaskEvent", description: "Task lifecycle events." })
export type TaskEvent = typeof TaskEvent.Type

const created = TaskEvent.cases.Created.make({ id: "t-1" })
const isCompleted = TaskEvent.guards.Completed
```

## 6. Schema-Derived Property Tests

Use when testing laws of a schema-modeled domain.

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as S from "effect/Schema"
import { PlannedFile } from "../src/PlannedFile"

describe("PlannedFile", () => {
  it.effect.prop("encode/decode round-trips", [PlannedFile], ([file]) =>
    Effect.gen(function* () {
      const encoded = yield* S.encodeEffect(PlannedFile)(file)
      const decoded = yield* S.decodeUnknownEffect(PlannedFile)(encoded)
      expect(S.toEquivalence(PlannedFile)(decoded, file)).toBe(true)
    }))
})
```

Derive generators from the production
schema (or `Arbitrary.schema(schema)` from `effect/unstable/arbitrary`) instead
of writing weaker test-only schemas.

## Quick Selection Map

- Need a `S.Class` domain payload: example 1
- Need schema-driven defaults: example 2
- Need `Option` boundary fields or schema-backed errors: example 3
- Need a `kind` or `type` tagged union: example 4
- Need a `_tag` union: example 5
- Need property tests: example 6
