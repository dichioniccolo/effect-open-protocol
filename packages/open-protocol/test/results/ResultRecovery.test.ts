import { describe, expect, it } from "@effect/vitest"
import { assertNone, assertSome } from "@effect/vitest/utils"
import { Effect, Ref } from "effect"
import * as A from "effect/Array"
import { CommandRejected, RequestTimeout } from "../../src/connection/ConnectionError.ts"
import { ControllerTimestamp, DeviceId, TighteningId, TighteningResult } from "../../src/protocol/TighteningResult.ts"
import * as Dedup from "../../src/results/Dedup.ts"
import { runRecovery } from "../../src/results/ResultRecovery.ts"

const resultFor = (id: number): TighteningResult =>
  new TighteningResult({
    deviceId: DeviceId.make("recovery-tool"),
    tighteningId: TighteningId.make(id),
    vin: `VIN${id}`,
    parameterSetId: 1,
    status: "OK",
    torqueStatus: "OK",
    angleStatus: "OK",
    torque: 12.34,
    angle: 90,
    timestamp: ControllerTimestamp.make("2026-09-19:10:14:16")
  })

/**
 * A controller whose latest result is `latest`, answering each MID 0064 with
 * what `answer` says, and recording what it was asked and what was submitted.
 */
const controller = Effect.fnUntraced(function* (
  latest: number,
  answer: (id: number) => Effect.Effect<TighteningResult, CommandRejected | RequestTimeout> = (id) =>
    Effect.succeed(resultFor(id))
) {
  const asked = yield* Ref.make<ReadonlyArray<number>>([])
  const submitted = yield* Ref.make<ReadonlyArray<number>>([])
  const dedup = yield* Dedup.make(64)

  const recover = (limit: number) =>
    runRecovery({
      dedup,
      request: (id) =>
        id === 0
          ? Effect.succeed(resultFor(latest))
          : Effect.andThen(
              Ref.update(asked, (current) => A.append(current, id)),
              answer(id)
            ),
      submit: (result) =>
        Effect.andThen(
          Ref.update(submitted, (current) => A.append(current, result.tighteningId)),
          dedup.remember(result.tighteningId)
        ),
      limit
    })

  return { asked, dedup, recover, submitted }
})

describe("runRecovery", () => {
  it.effect("asks only for what was not delivered, and leaves the rest for the next pass", () =>
    Effect.gen(function* () {
      const line = yield* controller(6)
      yield* line.dedup.markBaseline(TighteningId.make(1))
      yield* line.dedup.remember(TighteningId.make(3))
      yield* line.dedup.remember(TighteningId.make(4))

      const recovery = yield* line.recover(2)

      expect(yield* Ref.get(line.asked)).toEqual([2, 5])
      expect(recovery.skipped).toBe(1)
    })
  )

  it.effect("gives up only on what the controller says it no longer holds", () =>
    Effect.gen(function* () {
      const line = yield* controller(3, (id) => Effect.fail(new CommandRejected({ mid: 64, code: id === 2 ? 79 : 15 })))
      yield* line.dedup.markBaseline(TighteningId.make(1))

      const recovery = yield* line.recover(10)

      expect(recovery.pending).toEqual([2])
      expect(recovery.missing).toEqual([3])

      // 3 is written off, so delivering 2 closes the gap past it.
      yield* line.dedup.remember(TighteningId.make(2))
      assertSome(yield* line.dedup.lastDelivered, TighteningId.make(3))
    })
  )

  it.effect("delivers a late reply and asks again for the identifier it did not answer", () =>
    Effect.gen(function* () {
      // Every request is answered with 2, as when the reply to an earlier
      // request for 2 arrives only after that request timed out.
      const line = yield* controller(3, () => Effect.succeed(resultFor(2)))
      yield* line.dedup.markBaseline(TighteningId.make(1))

      const recovery = yield* line.recover(10)

      expect(yield* Ref.get(line.submitted)).toEqual([2, 2])
      expect(recovery.recovered).toEqual([2])
      expect(recovery.pending).toEqual([3])
    })
  )

  it.effect("retries when the controller does not say what its latest result is", () =>
    Effect.gen(function* () {
      const dedup = yield* Dedup.make(64)
      yield* dedup.markBaseline(TighteningId.make(1))

      const recovery = yield* runRecovery({
        dedup,
        request: () => Effect.fail(new RequestTimeout({ mid: 64 })),
        submit: () => Effect.void,
        limit: 10
      })

      expect(A.length(recovery.pending)).toBe(1)
    })
  )

  it.effect("finds where an empty controller's results start, even after a late reply", () =>
    Effect.gen(function* () {
      const line = yield* controller(5)
      yield* line.dedup.markNoHistory
      yield* line.dedup.remember(TighteningId.make(5))

      yield* line.recover(10)

      expect(yield* Ref.get(line.asked)).toEqual([1, 2, 3, 4])
      assertSome(yield* line.dedup.lastDelivered, TighteningId.make(5))
    })
  )

  it.effect("takes the highest identifier the empty controller no longer holds as the floor", () =>
    Effect.gen(function* () {
      const line = yield* controller(5, (id) =>
        id < 3 ? Effect.fail(new CommandRejected({ mid: 64, code: 15 })) : Effect.succeed(resultFor(id))
      )

      yield* line.dedup.markNoHistory

      const recovery = yield* line.recover(10)

      expect(recovery.missing).toEqual([1, 2])
      assertSome(yield* line.dedup.lastDelivered, TighteningId.make(5))
    })
  )

  it.effect("walks an empty controller down one block per pass", () =>
    Effect.gen(function* () {
      const line = yield* controller(5)
      yield* line.dedup.markNoHistory

      const first = yield* line.recover(2)
      expect(yield* Ref.get(line.asked)).toEqual([4, 5])
      expect(first.skipped).toBeGreaterThan(0)
      assertNone(yield* line.dedup.lastDelivered)

      yield* line.recover(2)
      yield* line.recover(2)
      assertSome(yield* line.dedup.lastDelivered, TighteningId.make(5))
    })
  )

  it.effect("stops asking once three requests in a row get no answer", () =>
    Effect.gen(function* () {
      const line = yield* controller(11, () => Effect.fail(new RequestTimeout({ mid: 64 })))
      yield* line.dedup.markBaseline(TighteningId.make(1))

      const recovery = yield* line.recover(10)

      expect(yield* Ref.get(line.asked)).toEqual([2, 3, 4])
      expect(A.length(recovery.pending)).toBe(10)
    })
  )

  it.effect("does not ask for a result already on its way to the handler", () =>
    Effect.gen(function* () {
      const line = yield* controller(4)
      yield* line.dedup.markBaseline(TighteningId.make(1))
      yield* line.dedup.claim(TighteningId.make(2))

      yield* line.recover(10)

      expect(yield* Ref.get(line.asked)).toEqual([3, 4])
    })
  )
})
