/**
 * The `runs` table as a derived repository.
 *
 * `SqlModel.makeRepository` builds insert, update, find-by-id and delete out of
 * the `Run` model, so the statements behind them are the model's business and
 * never appear here. `WireStore` depends on this service rather than deriving
 * the repository inside itself, which keeps the store about what a trace store
 * does and leaves the table's CRUD as its own replaceable piece.
 *
 * Only the reads a derivation cannot express - a run list with its event counts
 * - stay with the store, in `queries.ts`.
 *
 * A service rather than a plain constructor, because a table's CRUD is its own
 * replaceable piece with its own lifetime: whoever needs a run row asks for the
 * repository instead of deriving a second one. The store's other queries are
 * construction detail and stay a plain `make`.
 *
 * @since 0.0.0
 */
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import * as SqlModel from "effect/unstable/sql/SqlModel"
import { Run } from "./Schema.ts"

const derived = SqlModel.makeRepository(Run, {
  tableName: "runs",
  spanPrefix: "RunRepository",
  idColumn: "id"
})

/**
 * What the `runs` repository offers, taken from the derivation itself so the
 * two cannot drift.
 *
 * **Details**
 *
 * `SqlModel.makeRepository` also derives `update`, `updateVoid`, `findById` and
 * `delete`. Nothing needs them yet, so only `insert` is offered; widen this
 * `Pick` when a caller appears. The module itself is not in the package
 * barrel for the same reason - it becomes public when something outside this
 * package imports it.
 *
 * @category models
 * @since 0.0.0
 */
export interface RunRepositoryService extends Pick<Effect.Success<typeof derived>, "insert"> {}

/**
 * The `runs` repository as a service, so whoever needs a run row asks for one
 * instead of building the derivation again.
 *
 * **Example** (Recording the start of a run)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Run } from "@effect-open-protocol/store"
 * import { RunRepository } from "./RunRepository.ts"
 *
 * const started = Effect.gen(function* () {
 *   const runs = yield* RunRepository
 *   const run = yield* runs.insert(
 *     Run.insert.make({
 *       side: "client",
 *       startedAt: "2026-09-18T10:00:00.000Z",
 *       host: "127.0.0.1",
 *       port: 4545,
 *       seed: 1,
 *       latency: 40,
 *       jitter: 15
 *     })
 *   )
 *
 *   return run.id
 * })
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class RunRepository extends Context.Service<RunRepository, RunRepositoryService>()(
  "@effect-open-protocol/store/RunRepository"
) {}

/**
 * Derives the repository over whatever `SqlClient` is in context.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make: Effect.Effect<RunRepositoryService, never, SqlClient> = derived

/**
 * The `runs` repository over a `SqlClient`.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<RunRepository, never, SqlClient> = Layer.effect(RunRepository)(make)
