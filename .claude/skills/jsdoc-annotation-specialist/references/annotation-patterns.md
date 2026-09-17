# Schema Annotation Patterns

Every exported schema must carry an identifier and a meaningful description,
using plain `effect/Schema` annotations.

## Class schemas (`S.Class`, `Model.Class`, `S.TaggedError`)

The class identifier is the first argument; the last argument of the class
factory receives the annotations:

```ts
class MyEntity extends S.Class<MyEntity>("MyEntity")(
  { /* fields */ },
  {
    description: "A meaningful description reflected in JSDoc for the schema."
  }
) {}
```

## Tagged errors

Extend `S.TaggedError` from `effect/Schema` directly. Pass an identifier
(`S.TaggedError<MyError>("module/MyError")`) only when a distinct namespaced
schema identifier is wanted:

```ts
class MyError extends S.TaggedError<MyError>()(
  "MyError",
  { message: S.String, cause: S.Defect({ includeStack: true }) },
  {
    description: "Describes when and why this error occurs."
  }
) {}
```

If no distinct identifier is needed, use
`S.TaggedError<MyError>()("MyError", fields)`. Never pass a bare identifier
equal to the tag. Cause-carrying errors declare
`cause: S.Defect({ includeStack: true })` explicitly.

## Non-class schemas

Use `S.annotate({ identifier, description })` via `.pipe(...)`:

```ts
const MySchema = S.String.pipe(
  S.check(S.isPattern(/^[a-z]+$/)),
  S.annotate({ identifier: "MySchema",
    description: "A meaningful description."
  })
)
```

## Literal schemas

Use `.annotate({ identifier, description })`:

```ts
const Status = S.Literals(["active", "inactive"]).annotate({ identifier: "Status",
    description: "Entity lifecycle status."
  }
)
```

## Union, TemplateLiteral, and composed schemas

Use `S.annotate({ identifier, description })` inside `.pipe(...)`:

```ts
const MyUnion = S.Union([SchemaA, SchemaB]).pipe(
  S.annotate({ identifier: "MyUnion",
    description: "Discriminated union of A and B."
  })
)
```

## Type Alias Convention

Every non-class schema that is exported must also export a same-name runtime
type alias immediately after it:

```ts
export const MySchema = S.String.pipe(
  S.annotate({ identifier: "MySchema", description: "..." })
)

/**
 * Decoded value produced by {@link MySchema}.
 *
 * @see {@link MySchema} for the runtime schema and decoding behavior.
 * @category models
 * @since 0.0.0
 */
export type MySchema = typeof MySchema.Type
```

The same-name alias is pure type-level, so precise prose is required but an
Example is not. Keep its `@see` described; do not duplicate the runtime schema's
Example or add a legacy `@example` tag.
