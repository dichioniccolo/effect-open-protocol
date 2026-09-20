# Research

## 2026-09-20 — External landscape

### `Model` exists in Effect v4 core, not in a separate SQL package

The repo pins `effect@4.0.0-rc.115` in every workspace
(`packages/store/package.json:15`, `packages/cli/package.json:15`,
`packages/open-protocol/package.json:25`, `apps/ui/package.json:22`). In v4 the
model machinery ships inside core:

- `effect/unstable/schema/Model` — the variant model itself
  (`.repos/effect/packages/effect/src/unstable/schema/Model.ts`, 865 lines).
- `effect/unstable/sql/SqlModel` — repository and resolver derivation over a
  model (`.repos/effect/packages/effect/src/unstable/sql/SqlModel.ts`, 359
  lines).

So the ask "use `Model` from the SQL package" resolves to two core modules; no
new dependency, and no `@effect/sql` install. The v3-era docs for the same idea
(`Model.makeRepository` in `@effect/sql`) are at
<https://effect-ts.github.io/effect/sql/Model.ts.html> and
<https://effect.website/docs/v3/api/sql>; treat them as shape-only references,
the v4 module is the authority.

### What `Model.Class` gives

One field declaration, six derived variant schemas: `select` (the class
itself), `insert`, `update`, `json`, `jsonCreate`, `jsonUpdate`
(`Model.ts:35-36`, `Model.ts:46-53`). Field helpers relevant here:

| Helper | Effect | Source |
| --- | --- | --- |
| `Model.GeneratedByDb(S)` | Present on select, absent from insert/update — the db assigns it | `Model.ts:205-241` |
| `Model.GeneratedByApp(S)` | Present on select + insert, absent from update | `Model.ts:243-273` |
| `Model.FieldOption(S)` | Nullable column ↔ `Option` field | `Model.ts:337-383` |
| `Model.Sensitive(S)` | Kept out of the JSON variants | `Model.ts:275-302` |
| `Model.DateTimeInsert` / `DateTimeUpdate` | Audit stamps filled on write | `Model.ts:486-676` |
| `Model.JsonFromString(S)` | JSON column decoded to a schema | `Model.ts:688-728` |
| `Model.BooleanSqlite` | SQLite 0/1 ↔ boolean | `Model.ts:385-417` |

### What `SqlModel` derives

`SqlModel.makeRepository(Model, { tableName, spanPrefix, idColumn,
softDeleteColumn? })` returns exactly six operations —
`insert`, `insertVoid`, `update`, `updateVoid`, `findById`, `delete`
(`SqlModel.ts:33-73`). It encodes with `Model.insert` / `Model.update`, decodes
rows with the select variant, wraps each call in a span named from
`spanPrefix`, and handles dialect differences (`insert ... returning *`
everywhere but MySQL, `LAST_INSERT_ID()` there) — `SqlModel.ts:88-100`.
`softDeleteColumn` turns `delete` into a timestamp update and filters reads
(`SqlModel.ts:80-86`).

`SqlModel.makeResolvers` is the same surface as `RequestResolver`s
(`insert`, `insertVoid`, `findById`, `delete`), and it does batch **writes**,
not only by-id reads: its `execute` receives the whole array of pending
requests, so `insertVoid` emits one multi-row
`insert into <table> ${sql.insert(requests)}` (`SqlModel.ts:311-317`), and
`insert` does the same with `returning *` outside MySQL
(`SqlModel.ts:286-308`). That is the statement `WireStore.insertEvents` builds
by hand.

The catch is the axis of batching. A `RequestResolver` groups requests that are
in flight together in one request block; the recorder batches across *time* —
independent connection fibers offer one event each, and a writer fiber sweeps
up whatever accumulated (`Recording.ts:67-80`). A resolver does not open that
window, and once the queue has produced a batch, `insertEvents` already issues
the statement the resolver would, inside an explicit `sql.withTransaction`.

Nothing else is derived: no list, no filtered page, no aggregate, no custom
projection. Those stay `SqlSchema.findAll` / raw `sql`. `makeRepository` is
built *on* `SqlSchema` (`SqlModel.ts:22`), so mixing the two is the intended
shape, not a fallback.

## 2026-09-20 — In-repo capability inventory

### The raw SQL today

`packages/store/src/WireStore.ts` (174 lines) is the only real SQL surface.
It is already schema-driven through `SqlSchema` — none of it decodes rows by
hand:

| Operation | Today | `makeRepository` covers it? |
| --- | --- | --- |
| `startRun` (`WireStore.ts:81-86,117-122`) | `SqlSchema.findOne` + `insert ... returning id` | Yes — `insert`, if `Run` becomes the model (returns the whole row, not just the id) |
| `endRun` (`WireStore.ts:123`) | bare `update runs set endedAt = ...` | Partly — `updateVoid` needs the full update variant, not a one-column patch |
| `insertEvents` (`WireStore.ts:124-134`) | encode array + one `sql.insert` in a transaction | **No** — repository inserts one row at a time; a batch loop would be N statements |
| `listRuns` (`WireStore.ts:87-91`) | `findAll` with `runColumns` subselects | **No** — no list op, and the computed columns are not table columns |
| `findRun` (`WireStore.ts:93-97`) | `findOneOption` with the same subselects | **No** — `findById` selects `*` from the table and fails with `NoSuchElementError`, not `Option` |
| `events` (`WireStore.ts:101-114`) | `findAll` with `sql.and` over optional filters | **No** — paged, filtered read |

The sting: `Run` is not a table row. `runColumns` (`WireStore.ts:48-50`) bolts
`eventCount` and `lastEventAt` onto the `runs` row via correlated subselects,
so the select variant of a `Run` model would not match `select * from runs`.
Either the model splits (row model + read model), or the counts move to a view.

### The schemas that would become models

`packages/store/src/Schema.ts` already has the variant split hand-rolled as a
class chain:

- `RunStart` (`Schema.ts:122-134`) = the insert variant of a run.
- `Run extends RunStart.extend` (`Schema.ts:157-165`) = select + computed.
- `NewEvent` (`Schema.ts:192-203`) = the insert variant of an event.
- `StoredEvent extends NewEvent.extend({ id })` (`Schema.ts:224-228`) = select.
- `EventQuery` (`Schema.ts:253-266`) = a query, not a row; unaffected.

That is precisely the `GeneratedByDb(id)` pattern: one `Model.Class` with
`id: Model.GeneratedByDb(RunId)` collapses `RunStart`/`Run`, and one with
`id: Model.GeneratedByDb(EventId)` collapses `NewEvent`/`StoredEvent`.
`O.OptionFromNullOr` fields (`endedAt`, `mid`, ...) map to
`Model.FieldOption`.

Both pairs are **exported from the package barrel** (`packages/store/src/index.ts`
re-exports `./Schema.ts`) and consumed outside the store:
`packages/cli/src/Recording.ts:19` imports `NewEvent`, `RunStart`, `RunSide`,
`RunId`. So collapsing them is a public API change across `packages/cli`,
`apps/ui`, and the package's own JSDoc examples.

### Consumers

- `packages/cli/src/Recording.ts:64-70` — builds `WireStore.layer` over
  `SqliteClient`, calls `store.insertEvents(batch)` per batch. Batch insert is
  the hot path.
- `apps/ui/lib/server.ts` — one `ManagedRuntime` over `WireStore.layer`; reads
  only.
- `packages/store/test/WireStore.test.ts`, `packages/cli/test/Recording.test.ts`,
  `packages/store/test/fixtures/open.ts` — the test surface.
- `packages/store/src/migrations.ts` — table DDL, `Migrator.fromRecord`.
  Untouched by `Model`; `Model` never generates DDL. NOT FOUND: any schema→DDL
  derivation in v4.

### Constraints discovered

1. **No `@effect/sql` package involved** — it is `effect/unstable/schema/Model`
   + `effect/unstable/sql/SqlModel`, already a dependency.
2. **The store is not raw-SQL-naive** — `SqlSchema` already does the
   encode/decode. The win from `Model` is the *variant collapse* in
   `Schema.ts`, not the query layer.
3. **Four of six store operations have no `makeRepository` equivalent**
   (`insertEvents`, `listRuns`, `findRun`, `events`), so raw `sql` stays.
   `makeResolvers` *can* batch an insert into one statement, but on the wrong
   axis: it batches concurrent requests, not a time window, and the queue that
   opens that window already hands `insertEvents` a ready batch.
4. `findById` fails with `NoSuchElementError`; `findRun` returns `Option`.
   Adopting it changes the store's error channel or needs a wrapper.
5. `Run`'s computed columns (`eventCount`, `lastEventAt`) are the main
   structural obstacle.
