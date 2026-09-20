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
 * @since 0.0.0
 */
import { Context, Effect, Layer } from "effect"
import type * as Cause from "effect/Cause"
import type * as S from "effect/Schema"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlModel from "effect/unstable/sql/SqlModel"
import { Run, type RunId } from "./Schema.ts"

/**
 * Insert, update, find-by-id and delete for one `runs` row, derived from the
 * `Run` model.
 *
 * @category models
 * @since 0.0.0
 */
export interface RunRepositoryService {
  /** Writes a new run and returns the row the database assigned an id to. */
  readonly insert: (run: typeof Run.insert.Type) => Effect.Effect<Run, SqlError | S.SchemaError>
  /** Overwrites a run with the values it carries. */
  readonly update: (run: typeof Run.update.Type) => Effect.Effect<Run, SqlError | S.SchemaError>
  /** Overwrites a run, discarding the row it returns. */
  readonly updateVoid: (run: typeof Run.update.Type) => Effect.Effect<void, SqlError | S.SchemaError>
  /** One run by id, failing when there is none. */
  readonly findById: (id: RunId) => Effect.Effect<Run, Cause.NoSuchElementError | SqlError | S.SchemaError>
  /** Removes a run by id. */
  readonly delete: (id: RunId) => Effect.Effect<void, SqlError | S.SchemaError>
}

/**
 * The `runs` repository as a service, so whoever needs a run row asks for one
 * instead of building the derivation again.
 *
 * **Example** (Recording the start of a run)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Run, RunRepository } from "@effect-open-protocol/store"
 *
 * const started = Effect.gen(function* () {
 *   const runs = yield* RunRepository.RunRepository
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
export const make: Effect.Effect<RunRepositoryService, never, SqlClient> = SqlModel.makeRepository(Run, {
  tableName: "runs",
  spanPrefix: "RunRepository",
  idColumn: "id"
})

/**
 * The `runs` repository over a `SqlClient`.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<RunRepository, never, SqlClient> = Layer.effect(RunRepository)(make)
