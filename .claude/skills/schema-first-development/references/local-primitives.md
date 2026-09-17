# Schema Primitives

This repo uses upstream `effect/Schema` directly. There is no local schema
helper package; reach for built-in constructors, checks, and existing project
schemas before inventing new schemas or custom filters.

## Import Baseline

Use this baseline unless the file already follows a stronger local pattern.

```ts
import * as S from "effect/Schema"
```

## Identifiers and Annotations

Give every class, tagged error, and service a string identifier, and annotate
reusable schemas with a meaningful description.

```ts
import { Context, Effect } from "effect"
import * as S from "effect/Schema"

// Class schema: identifier is the first argument, annotations the last.
export class User extends S.Class<User>("User")(
  { id: S.String, name: S.String },
  { description: "Application user payload." }
) {}

// Non-class schema: identifier and description through `.annotate(...)`.
export const Tenant = S.NonEmptyString.annotate({
  identifier: "Tenant",
  description: "Logical tenant identifier used for partitioning."
})
export type Tenant = typeof Tenant.Type

// Service: the string key is the runtime identity.
export class UserRepository extends Context.Service<UserRepository, {
  readonly findById: (id: string) => Effect.Effect<User>
}>()("UserRepository") {}
```

Identifiers must be unique across the application. Namespace them
(`"billing/Invoice"`) when two modules could otherwise pick the same name.

## `S.Literals` for Internal Literal Domains

Use one named `S.Literals([...])` schema when a literal set is reused. Do not
add `as const` to inline array literals passed directly to `S.Literals(...)`;
its const type parameters preserve the literal tuple.

What it gives you:

- the schema value
- `.literals`: the literal tuple
- `.members`: one `S.Literal` schema per literal
- `.pick([...])`: a subset domain
- `.mapMembers(...)`: tagged-union assembly with `Tuple.evolve`
- `.transform([...])`: a directional mapping to another literal set
- `S.is(schema)`: the derived guard

```ts
import { Match } from "effect"
import * as S from "effect/Schema"

export const JobStatus = S.Literals(["queued", "running", "failed"]).annotate({
  identifier: "JobStatus",
  description: "Lifecycle status of a background job."
})
export type JobStatus = typeof JobStatus.Type

export const isJobStatus = S.is(JobStatus)
export const ActiveJobStatus = JobStatus.pick(["queued", "running"])

export const statusLabel = Match.type<JobStatus>().pipe(
  Match.when("queued", () => "Waiting"),
  Match.when("running", () => "In progress"),
  Match.when("failed", () => "Failed"),
  Match.exhaustive
)
```

Good fits:

- status fields
- mode fields
- error kinds
- reusable small internal domains

## Lookup-Driven Literal Domains

When wire codes map to internal literals, encode the mapping in the schema with
`.transform(...)` instead of a hand-written lookup table plus guard:

```ts
import * as S from "effect/Schema"

// Decodes "Q" | "R" | "F" into "queued" | "running" | "failed" and back.
export const JobStatusCode = S.Literals(["Q", "R", "F"]).transform([
  "queued",
  "running",
  "failed"
])
```

Good fits:

- error-code tables
- database enum maps
- protocol lookup tables

## Built-In Schemas Before New Brands

Check `effect/Schema` before writing a custom primitive. Examples worth
reusing:

- `S.NonEmptyString`, `S.Trimmed`
- `S.Int`, `S.Finite`, `S.FiniteFromString`
- `S.NonEmptyArray`
- checks such as `S.isPattern`, `S.isIncludes`, length and range checks
- `S.brand("Name")` for nominal domain types

Then check the project for an existing schema of the same concept. If it
exists, reuse or extend it instead of cloning the logic locally.

## Transformations Before Manual Wrappers

Encode normalization and format conversion in the schema with `S.decodeTo`
and `SchemaTransformation.transform` instead of writing decode glue:

```ts
import * as S from "effect/Schema"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Str from "effect/String"

export const LowercaseEmail = S.String.pipe(
  S.decodeTo(
    S.String,
    SchemaTransformation.transform({
      decode: Str.toLowerCase,
      encode: (value) => value
    })
  )
)
```

## `S.TaggedError` for Typed Error Schemas

When an error is part of a module boundary, extend `S.TaggedError` from
`effect/Schema` directly. This keeps the error schema-backed.

```ts
import * as S from "effect/Schema"

export class InputError extends S.TaggedError<InputError>()(
  "InputError",
  { message: S.String },
  { description: "Invalid input payload." }
) {}
```

Pass an identifier (`S.TaggedError<InputError>("forms/InputError")(...)`) only
when a distinct namespaced identifier is wanted; never pass an identifier equal
to the tag. Cause-carrying errors declare `cause: S.Defect({ includeStack: true })`
explicitly.

## Common Pitfalls

- Do not rebuild string, number, or collection checks from scratch when
  `effect/Schema` already provides them.
- Do not repeat inline `S.Literals(...)` for the same domain in several
  modules; export one named schema.
- Do not define shared schemas without annotation metadata.
- Do not create plain TS types beside a reusable schema unless the type alias
  is derived from the schema value.
