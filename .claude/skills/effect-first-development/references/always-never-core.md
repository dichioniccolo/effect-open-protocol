# Always / Never — Core Modeling (Examples 1-9)

Loaded on demand from `effect-first-development/SKILL.md`. Repository laws win on conflict.

## Table of Contents

- [1) Absence handling](#1-absence-handling)
- [2) Typed error boundary](#2-typed-error-boundary)
- [3) Schema naming + annotation](#3-schema-naming--annotation)
- [4) Type checks](#4-type-checks)
- [4b) Schema-backed guards + internal modeling](#4b-schema-backed-guards--internal-modeling)
- [5) Match over switch](#5-match-over-switch)
- [6) Tagged unions and exhaustive branching](#6-tagged-unions-and-exhaustive-branching)
- [7) Service identity](#7-service-identity)
- [8) Discriminated union schemas](#8-discriminated-union-schemas)
- [9) Effect-returning functions](#9-effect-returning-functions)

### 1) Absence handling

```ts
import { pipe } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"

// NEVER: User | undefined
// const user = users.find((u) => u.id === id)

// ALWAYS: Option<User>
const user = pipe(
  users,
  A.findFirst((u) => u.id === id)
)

const name = pipe(
  user,
  O.map((u) => u.name),
  O.getOrElse(() => "anonymous")
)
```

### 2) Typed error boundary

```ts
import { Effect } from "effect"
import * as S from "effect/Schema"

class JsonParseError extends S.TaggedError<JsonParseError>()(
  "JsonParseError",
  { message: S.String, input: S.String },
  { description: "Invalid JSON payload" }
) {}

const parseJson = (raw: string) =>
  S.decodeUnknownEffect(S.fromJsonString(S.Unknown))(raw).pipe(
    Effect.mapError((cause) => new JsonParseError({ message: cause.message, input: raw }))
  )
```

### 3) Schema naming + annotation

```ts
import * as S from "effect/Schema"

// NEVER: export const UserSchema = S.Struct(...)
// NEVER: export interface User { readonly id: string; readonly name: string }
// ALWAYS: prefer S.Class for object schemas.
export class User extends S.Class<User>("User")(
  {
    id: S.String,
    name: S.String
  },
  {
    description: "Application user payload."
  }
) {}

const decodeUser = S.decodeUnknownEffect(User)
```

### 4) Type checks

```ts
import * as P from "effect/Predicate"

// NEVER: typeof value === "string"
// ALWAYS:
const isStringValue = P.isString(value)
```

### 4b) Schema-backed guards + internal modeling

```ts
import { Match, pipe } from "effect"
import * as A from "effect/Array"
import * as P from "effect/Predicate"
import * as S from "effect/Schema"
import * as Str from "effect/String"

const TopicKind = S.Literals(["plain", "scoped"])
type TopicKind = typeof TopicKind.Type

const ContainsScopeSeparator = S.String.check(
  S.isIncludes(":", {
    identifier: "ContainsScopeSeparatorCheck",
    title: "Contains Scope Separator",
    description: "A string that contains `:`.",
    message: "Topic text must contain :"
  })
).pipe(
  S.brand("ContainsScopeSeparator"),
  S.annotate({ identifier: "ContainsScopeSeparator",
    description: "A string containing the topic scope separator `:`."
  })
)

const isContainsScopeSeparator = S.is(ContainsScopeSeparator)

const TopicSegment = S.NonEmptyString.check(
  S.makeFilter(P.not(isContainsScopeSeparator), {
    identifier: "TopicSegmentNoSeparatorCheck",
    title: "Topic Segment No Separator",
    description: "A topic segment that does not contain `:`.",
    message: "Topic segments must not contain :"
  })
).pipe(
  S.brand("TopicSegment"),
  S.annotate({ identifier: "TopicSegment",
    description: "A non-empty topic segment without the scope separator."
  })
)

const isTopicSegment = S.is(TopicSegment)

const splitNonEmpty =
  (separator: string | RegExp) =>
  (value: string): ReadonlyArray<string> =>
    pipe(Str.split(separator)(value), A.filter(Str.isNonEmpty))

const classifyTopicKind = Match.type<string>().pipe(
  Match.when(isContainsScopeSeparator, (): TopicKind => "scoped"),
  Match.orElse((): TopicKind => "plain")
)

export const TopicName = S.NonEmptyString.check(
  S.makeFilterGroup(
    [
      S.makeFilter(P.not(Str.endsWith(":")), {
        identifier: "TopicNameNoTrailingSeparatorCheck",
        title: "Topic Name No Trailing Separator",
        description: "A topic name that does not end with `:`.",
        message: "Topic names must not end with :"
      }),
      S.makeFilter((value: string) =>
        Match.value(classifyTopicKind(value)).pipe(
          Match.when("plain", () => isTopicSegment(value)),
          Match.when("scoped", () => pipe(value, splitNonEmpty(":"), A.every(isTopicSegment))),
          Match.exhaustive
        ), {
        identifier: "TopicNameSegmentsCheck",
        title: "Topic Name Segments",
        description: "A topic name whose segments are valid topic segments.",
        message: "Topic names must contain only valid segments"
      })
    ],
    {
      identifier: "TopicNameChecks",
      title: "Topic Name",
      description: "Checks for a plain or scoped topic name."
    }
  )
).pipe(
  S.brand("TopicName"),
  S.annotate({ identifier: "TopicName",
    description: "A topic name composed from valid plain or scoped segments."
  })
)
```

// NEVER: build forests of regex/predicate helpers when the named concepts can be schemas.

### 5) Match over switch

```ts
import { Match } from "effect"
import * as A from "effect/Array"

type Status = "queued" | "running" | "failed"

// NEVER:
// switch (status) {
//   case "queued": return "queued"
//   case "running": return "running"
//   case "failed": return "failed"
// }

// ALWAYS:
const toLabel = Match.type<Status>().pipe(
  Match.when("queued", () => "queued"),
  Match.when("running", () => "running"),
  Match.when("failed", () => "failed"),
  Match.exhaustive
)

const summarize = (items: ReadonlyArray<string>) =>
  A.match(items, {
    onEmpty: () => "none",
    onNonEmpty: (values) => `count:${A.length(values)}`
  })
```

### 6) Tagged unions and exhaustive branching

```ts
import { Tuple } from "effect"
import * as S from "effect/Schema"

const JobStateTag = S.Literals(["queued", "running", "failed"])

export class JobQueued extends S.Class<JobQueued>("JobQueued")(
  { state: S.tag("queued") },
  { description: "Queued job state." }
) {}

export class JobRunning extends S.Class<JobRunning>("JobRunning")(
  { state: S.tag("running"), workerId: S.String },
  { description: "Running job state." }
) {}

export class JobFailed extends S.Class<JobFailed>("JobFailed")(
  { state: S.tag("failed"), reason: S.String },
  { description: "Failed job state." }
) {}

export const JobState = JobStateTag
  .mapMembers(Tuple.evolve([
    () => JobQueued,
    () => JobRunning,
    () => JobFailed
  ]))
  .annotate({ identifier: "JobState", description: "Job lifecycle state union." })
  .pipe(S.toTaggedUnion("state"))

export type JobState = typeof JobState.Type

export const render = (state: JobState) =>
  JobState.match(state, {
    queued: () => "queued",
    running: ({ workerId }) => `running:${workerId}`,
    failed: ({ reason }) => `failed:${reason}`
  })
```

### 7) Service identity

```ts
import { Context } from "effect"

export class MyService extends Context.Service<MyService, {
  readonly ping: () => string
}>()("MyService") {}
```

### 8) Discriminated union schemas

```ts
import { Tuple } from "effect"
import * as S from "effect/Schema"

// Preferred when the discriminant is `_tag`.
export const TaskEvent = S.TaggedUnion({
  Created: { id: S.String },
  Completed: { id: S.String, at: S.String }
}).annotate({ identifier: "TaskEvent",
  description: "Canonical internal event union discriminated by `_tag`."
})

// Use toTaggedUnion for external unions or non-standard discriminants.
export class ExternalTaskCreated extends S.Class<ExternalTaskCreated>("ExternalTaskCreated")({
  kind: S.tag("created"),
  id: S.String
}) {}

export class ExternalTaskCompleted extends S.Class<ExternalTaskCompleted>("ExternalTaskCompleted")({
  kind: S.tag("completed"),
  id: S.String,
  at: S.String
}) {}

const ExternalTaskKind = S.Literals(["created", "completed"])

export const ExternalTaskEvent = ExternalTaskKind
  .mapMembers(Tuple.evolve([
    () => ExternalTaskCreated,
    () => ExternalTaskCompleted
  ]))
  .annotate({ identifier: "ExternalTaskEvent",
    description: "External task events discriminated by `kind`."
  })
  .pipe(S.toTaggedUnion("kind"))
```

### 9) Effect-returning functions

```ts
import { Effect } from "effect"
import * as S from "effect/Schema"

// Public or reusable flow: traced.
export const fetchProfile = Effect.fn("Profile.fetch")(function* (userId: string) {
  yield* Effect.logDebug("fetch profile", userId)
  return { userId }
})

// Internal hot-path flow: untraced.
const parseSmallPayload = Effect.fnUntraced(function* (raw: string) {
  return yield* S.decodeUnknownEffect(S.fromJsonString(S.Unknown))(raw)
})

// Zero-arg reusable values can stay as effects instead of immediate Effect.fn() invocation.
const loadAppConfig = Effect.gen(function* () {
  return yield* S.decodeUnknownEffect(S.Struct({ port: S.Number }))({ port: 8787 })
}).pipe(Effect.withSpan("AppConfig.load"))
```
