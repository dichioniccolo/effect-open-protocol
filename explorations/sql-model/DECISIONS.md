# Decisions

## 2026-09-20

### Q1 — What is the actual target, given `makeRepository` covers 2 of 6 store operations?

**Answer:** Model variants only. Collapse the hand-rolled schema pairs into
`Model.Class` definitions; keep every query on `SqlSchema` / raw `sql`.

**Rationale:** `RESEARCH.md` found the store is already schema-driven
(`SqlSchema.findOne/findAll/findOneOption`, `WireStore.ts:81-114`), so there is
no hand-decoding to remove. The duplication lives in `Schema.ts`, where
`RunStart`/`Run` and `NewEvent`/`StoredEvent` are an insert/select variant split
written by hand — exactly what `Model.GeneratedByDb` derives.

**Rejected:**

- *Models + `makeRepository` where it fits* — would cover only
  `startRun`/`endRun`/`findRun`, add a repository indirection for a minority of
  calls, and flip `findRun` from `Option` to a `NoSuchElementError` failure.
- *Full repository-first store* — needs a `runs_with_counts` view and per-row
  event inserts, losing the batched single-statement insert on the recorder's
  hot path (`Recording.ts:64-70`).
- *Kill the packet* — the `Schema.ts` collapse is real value; not a dead end.

**Correction (2026-09-20, after the change shipped):** the rejection above is
right, but one premise was not. `makeRepository`'s `insert` is row-at-a-time
(`SqlModel.ts:88-120`), which is what rules it out of the recorder's hot path —
but `makeResolvers` *does* batch writes: its `insertVoid` receives the array of
pending requests and emits one multi-row insert (`SqlModel.ts:311-317`), the
same statement `insertEvents` builds. It is still the wrong tool here, because
a `RequestResolver` batches requests that are concurrent, while the recorder
batches across time through a queue (`Recording.ts:67-80`) — and by the time
that queue yields a batch, `insertEvents` already issues the statement a
resolver would, inside an explicit transaction. So: "the repository's
row-at-a-time insert does not fit the hot path, and the resolver batches on the
wrong axis", not "`Model` cannot batch inserts".

### Q2 — How much exported-API churn is acceptable?

**Answer:** Free to break. Rename exported symbols and fix every call site in
one pass.

**Rationale:** All packages are at `0.0.0`, and every consumer is in-tree
(`packages/cli/src/Recording.ts:19`, `apps/ui/`, the tests). Aliasing old names
would preserve the two-names-per-concept duplication this change exists to
remove.

**Rejected:** *Keep names as aliases* (keeps the duplication);
*store-internal only* (zero churn, zero gain outside `WireStore.ts`).

### Q3 — How does the `Run` model carry `eventCount` / `lastEventAt`?

**Answer:** Separate read model. `Run` is the `runs` row exactly; `RunSummary`
extends it with the computed pair and is what `listRuns` / `findRun` decode.

```ts
export class Run extends Model.Class<Run>("Run")({
  id: Model.GeneratedByDb(RunId),
  side: RunSide,
  startedAt: S.String,
  endedAt: Model.FieldOption(S.String),
  host: S.String,
  port: S.Int,
  seed: S.Int,
  latency: Count,
  jitter: Count
}) {}

export class RunSummary extends Run.extend<RunSummary>("RunSummary")({
  eventCount: Count,
  lastEventAt: S.OptionFromNullOr(S.String)
}) {}
```

**Rationale:** Each schema matches a query result that actually exists —
`Run` the table, `RunSummary` the `runColumns` projection
(`WireStore.ts:48-50`). `Run.insert` replaces `RunStart` with no field lost.

**Rejected:**

- *`FieldOnly(["select"])` on the computed pair* — one model, but its select
  variant would then never match `select * from runs`, so the model would lie
  about the table it names.
- *SQL view* — adds a migration and moves the projection out of sight for a
  two-column convenience.

**Risk carried forward:** `Model.Class` returns a `Schema.Class` whose `extend`
produces a plain class, so `RunSummary` has no `insert`/`update` variants. That
is what a read model wants, but it must be confirmed against
`.repos/effect/packages/effect/src/unstable/schema/VariantSchema.ts:275-300`
during implementation.

### Q4 — What replaces `NewEvent` / `StoredEvent`?

**Answer:** One model, `TracedEvent`, with `id: Model.GeneratedByDb(EventId)`.
`TracedEvent.insert` replaces `NewEvent`; `TracedEvent` replaces `StoredEvent`.

**Rationale:** Unambiguous beside `effect-open-protocol`'s `WireEvent` /
`WireEventKind`, which the same modules import.

**Rejected:** *`StoredEvent`* (reads wrong on `StoredEvent.insert`, a row not
yet stored); *`Event`* (collides with the protocol vocabulary at import sites).

### Q5 — Do the `WireStore` service signatures change too?

**Answer:** Follow the models. Same six operations with the same semantics
(`findRun` still returns `Option`); only the schema types move:
`startRun(Run.insert)`, `insertEvents(TracedEvent.insert[])`,
`listRuns`/`findRun` yielding `RunSummary`, `events` yielding `TracedEvent`.

**Rationale:** The service surface is right; the pairs behind it were the
problem. Keeping the operations fixed bounds the change to types plus call
sites.

**Rejected:** *Rethink the operations* — widens the blast radius into CLI and
UI behavior, which this packet has no evidence to justify.

### Q6 — Appetite

**Answer:** One sitting: `Schema.ts` rewrite, `WireStore.ts` type updates,
call sites in `packages/cli` and `apps/ui`, JSDoc examples, then green
`bun run check` / `lint` / `test`. One goal packet.

**Rejected:** *Two-step with aliases* (reinstates the aliasing rejected in Q2);
*timeboxed spike first* (the `Run.extend` question is cheap enough to settle
inside the change, and is logged as a risk under Q3).

### Settled by research, not asked

- **No new dependency.** `Model` lives in `effect/unstable/schema/Model` and
  `effect/unstable/sql/SqlModel` in `effect@4.0.0-rc.115`, not in a separate
  `@effect/sql` package (`RESEARCH.md`, external landscape).
- **`Model.FieldOption` is behavior-preserving** on the database variants: it
  is `Schema.OptionFromNullOr`, exactly today's field type
  (`VariantSchema`-backed definition at `Model.ts:337-383`).
- **`EventQuery` stays a plain `S.Class`.** It is a query, not a row; no
  variants apply.
- **`migrations.ts` is untouched.** `Model` derives no DDL.

### Q7 — Keep the gated MAP candidates?

**Answer:** No. `trace-model-json-variants` and `trace-datetime-fields` are
struck from `MAP.md`. One goal graduates, and the packet keeps no re-entry
points.

**Rationale:** The user asked for one goal. Both were already out of scope in
`BRIEF.md`'s rabbit holes, so carrying them as gated candidates duplicated that
prose and left a false promise of future re-entry. Epitaph: *out of scope in
the brief, so not worth a MAP row.*

## 2026-09-20 (second round, after the first change shipped)

### Q8 — No raw SQL inside objects and services. How far does that go?

**Answer:** Three moves. A run is inserted through `SqlModel.makeRepository`,
which lives in its own `RunRepository` service. Every statement no derivation
expresses moves to `packages/store/src/queries.ts`, named and typed, taking the
client it runs on. `WireStore` then composes those and holds no statement text
at all. Migrations keep their DDL; that is where SQL belongs.

**Rationale:** The user's objection is to SQL sitting inside the objects and
services, not to SQL existing. Derivation removes one statement outright;
naming the rest turns `WireStore` into a description of what a trace store does
rather than how. `RunRepository` is a service of its own because deriving it
inside `WireStore.make` would make the store own the table's CRUD as a side
effect of existing.

**Rejected:**

- *`makeResolvers` for `insertEvents`* — it emits the same multi-row statement,
  but `SqlRequest` hashes by payload and **deduplicates equal requests**
  (`SqlResolver.ts:40-51,77-87`). Two traced events are equal whenever the same
  bytes cross the same connection inside the same millisecond, and their row
  ids - the only distinguishing field - are assigned by the database after the
  insert. The recorder would silently lose rows. This reverses the correction
  logged above: the resolver's batching axis is the smaller problem; dedup is
  the disqualifying one.
- *A `runs_with_counts` view* — moves the projection into `migrations.ts`
  rather than removing it, and the run list still needs a statement.
- *Leaving the derivation inside `WireStore.make`* — works, but hides a
  repository inside a store.

**Consequence:** `Run.id` is no longer `Model.GeneratedByDb`. That helper omits
the id from the `update` variant, and `makeRepository` requires the id column in
it (`Model.ts:205-229`, `SqlModel.ts:33-40`); the documented shape for a primary
key used in update payloads is `Model.Field({ select, update, json })`.
`Run.insert` is unchanged, so nothing the recorder writes changed.

### Q9 — The first attempt at Q8 split each query across two files. What replaces it?

**Answer:** A query is its statement *and* the schemas it decodes with, so
`queries.ts` owns both: it exports `make`, which takes the client once and
returns the whole set (`listRunSummaries`, `findRunSummary`, `eventPage`,
`stampRunEnd`, `insertEvents`). `WireStore.make` is migrations, the repository,
the query set, and the service assembly — nothing else.

**Rationale:** The first attempt moved statement text out of `WireStore` but
left `Request`/`Result` behind, so reading one query meant reading two files.
Worse, `SqlSchema` hands `execute` the *encoded* request, which forced
`typeof EventQuery.Encoded` and `typeof RunId.Encoded` into a module signature
— and inconsistently, since `stampRunEnd` took a decoded `RunId` on the same
page. Binding the client once puts the whole query in one place and keeps
encoded shapes inside the module that has to know about them. The
`Statement<unknown>` return type disappeared with it: the set now returns real
`Effect`s of `RunSummary` and `TracedEvent`.

**Rejected:** *Keeping the per-function `(sql, ...)` shape* — five one-call
helpers, each threading a client that never varies, is indirection that buys
nothing.

### Q10 — What does `RunRepository` publish?

**Answer:** `insert`, and nothing else. Its service type is
`Pick<Effect.Success<typeof derived>, "insert">`, taken from the derivation
rather than restated.

**Rationale:** The hand-written interface had already drifted — it silently
dropped `insertVoid`, which `makeRepository` returns. Deriving the type makes
drift impossible. Narrowing to `insert` keeps the exported surface to what the
package promises to keep working; the `Pick` widens the moment a caller needs
more.

**Consequence carried from Q8:** `Run.id` is `Model.Field({ select, update,
json })` rather than `GeneratedByDb` because `makeRepository` requires the id in
the update variant. That relaxation buys the derived `insert` alone — the
update and delete it also derives stay unpublished.

### Q11 — A second review: what was left?

**Answer:** Five cleanups, all applied. The query set is named for the store
operations it backs (`listRuns`, `findRun`, `events`, `endRun`,
`insertEvents`), so `WireStore` assembles rather than translates; the unused
`Queries` type is gone; `RunRepository` left the package barrel; the two
composition idioms are now explained where they live; and the transaction
around the event insert is gone.

**Rationale:**

- *Names.* `Queries` and `WireStoreService` were the same six operations under
  two vocabularies, with the assembly performing the mapping. Aligning them
  makes the identity visible and removes the `listRuns(undefined)` wart, which
  the query set now applies itself.
- *Dead type.* `Queries` was exported, referenced nowhere, and its module is not
  public. Speculative surface.
- *Barrel.* Exporting `RunRepository` with no consumer outside the package
  contradicted the rule used to narrow it to `insert`. It is internal until
  something imports it.
- *Idioms.* A service for the table's CRUD, a plain `make` for the store's own
  queries. Both module headers now say which and why, so the next reader does
  not have to guess the house style.
- *Transaction.* One multi-row insert is atomic in SQLite, so `withTransaction`
  bought nothing and cost a `BEGIN`/`COMMIT` pair per batch on the recorder's
  hot path - the same path that blocks the event loop under `bun:sqlite`.

**Rejected:** *`WireStore.of({ ...queries, startRun })`* — shorter, but TypeScript
does not excess-property-check a spread, so a future query member would ride
along on the runtime object without appearing in the contract.
