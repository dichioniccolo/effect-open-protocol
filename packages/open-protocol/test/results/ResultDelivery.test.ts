import { describe, expect, it } from "@effect/vitest"
import { assertNone, assertSome } from "@effect/vitest/utils"
import { Duration, Effect, Fiber, pipe, Ref, Schedule } from "effect"
import { TestClock } from "effect/testing"
import * as A from "effect/Array"
import { ControllerTimestamp, DeviceId, TighteningId, TighteningResult } from "../../src/protocol/TighteningResult.ts"
import * as Dedup from "../../src/results/Dedup.ts"
import * as ResultDelivery from "../../src/results/ResultDelivery.ts"
import { defaultSettings } from "../../src/connection/DeviceSettings.ts"

const deviceId = DeviceId.make("tool-1")

/** What a connection would hand the pipeline when the caller set nothing. */
const defaults = { handlerRetry: defaultSettings.handlerRetry, bufferSize: defaultSettings.resultBuffer }

const resultFor = (id: number): TighteningResult =>
  new TighteningResult({
    deviceId,
    tighteningId: TighteningId.make(id),
    vin: "VIN1",
    parameterSetId: 1,
    status: "OK",
    torqueStatus: "OK",
    angleStatus: "OK",
    torque: 12.34,
    angle: 90,
    timestamp: ControllerTimestamp.make("2026-09-17:10:14:16")
  })

interface Recorder {
  readonly handled: Ref.Ref<ReadonlyArray<number>>
  readonly acked: Ref.Ref<ReadonlyArray<number>>
}

const recorder: Effect.Effect<Recorder> = Effect.all({
  handled: Ref.make<ReadonlyArray<number>>([]),
  acked: Ref.make<ReadonlyArray<number>>([])
})

const record = (ref: Ref.Ref<ReadonlyArray<number>>, result: TighteningResult) =>
  Ref.update(ref, (current) => A.append(current, result.tighteningId))

/** A result as its subscription pushes it, with an ack that records itself. */
const pushedFor = (seen: Recorder, id: number) => {
  const result = resultFor(id)

  return { value: result, ack: record(seen.acked, result) }
}

describe("ResultDelivery", () => {
  it.effect("acknowledges only after the handler succeeded", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* recorder
        const dedup = yield* Dedup.make(16)

        const delivery = yield* ResultDelivery.make({
          dedup,
          ...defaults,
          handler: (result) => record(seen.handled, result)
        })

        yield* delivery.submitPushed(pushedFor(seen, 1))
        yield* Effect.yieldNow

        expect(yield* Ref.get(seen.handled)).toEqual([1])
        expect(yield* Ref.get(seen.acked)).toEqual([1])
        expect(yield* delivery.delivered).toBe(1)
      })
    )
  )

  it.effect("does not acknowledge when the handler keeps failing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* recorder
        const attempts = yield* Ref.make(0)
        const dedup = yield* Dedup.make(16)

        const delivery = yield* ResultDelivery.make({
          dedup,
          ...defaults,
          handler: () =>
            Effect.andThen(
              Ref.update(attempts, (n) => n + 1),
              Effect.fail("nope")
            ),
          handlerRetry: Schedule.recurs(2)
        })

        yield* delivery.submitPushed(pushedFor(seen, 1))
        yield* Effect.yieldNow

        expect(yield* Ref.get(seen.acked)).toEqual([])
        expect(yield* Ref.get(attempts)).toBe(3)
        expect(yield* delivery.delivered).toBe(0)
        expect(yield* dedup.seen(TighteningId.make(1))).toBe(false)
      })
    )
  )

  it.effect("retries a flaky handler and then acknowledges", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* recorder
        const attempts = yield* Ref.make(0)
        const dedup = yield* Dedup.make(16)

        const delivery = yield* ResultDelivery.make({
          dedup,
          ...defaults,
          handler: (result) =>
            pipe(
              Ref.updateAndGet(attempts, (n) => n + 1),
              Effect.flatMap((count) => (count < 2 ? Effect.fail("flaky") : record(seen.handled, result)))
            ),
          handlerRetry: Schedule.recurs(3)
        })

        yield* delivery.submitPushed(pushedFor(seen, 7))
        yield* Effect.yieldNow

        expect(yield* Ref.get(seen.handled)).toEqual([7])
        expect(yield* Ref.get(seen.acked)).toEqual([7])
      })
    )
  )

  it.effect("acknowledges a resend without calling the handler twice", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* recorder
        const dedup = yield* Dedup.make(16)

        const delivery = yield* ResultDelivery.make({
          dedup,
          ...defaults,
          handler: (result) => record(seen.handled, result)
        })

        yield* delivery.submitPushed(pushedFor(seen, 3))
        yield* Effect.yieldNow
        yield* delivery.submitPushed(pushedFor(seen, 3))
        yield* Effect.yieldNow

        expect(yield* Ref.get(seen.handled)).toEqual([3])
        expect(yield* Ref.get(seen.acked)).toEqual([3, 3])
        expect(yield* delivery.duplicates).toBe(1)
        expect(yield* delivery.delivered).toBe(1)
      })
    )
  )

  it.effect("applies backpressure when the handler is slow", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* recorder
        const dedup = yield* Dedup.make(16)

        const delivery = yield* ResultDelivery.make({
          dedup,
          ...defaults,
          handler: (result) => Effect.andThen(Effect.sleep(Duration.seconds(1)), record(seen.handled, result)),
          bufferSize: 1
        })

        const submitting = yield* Effect.forkChild(
          Effect.forEach(A.range(1, 4), (id) => delivery.submitPushed(pushedFor(seen, id)), { discard: true })
        )

        yield* TestClock.adjust(Duration.seconds(1))
        expect(yield* Ref.get(seen.handled)).not.toEqual([1, 2, 3, 4])

        yield* TestClock.adjust(Duration.seconds(10))
        yield* Fiber.join(submitting)
        yield* Effect.yieldNow

        expect(yield* Ref.get(seen.handled)).toEqual([1, 2, 3, 4])
        expect(yield* Ref.get(seen.acked)).toEqual([1, 2, 3, 4])
      })
    )
  )

  it.effect("keeps the dedup window bounded", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dedup = yield* Dedup.make(2)
        yield* dedup.markNoHistory

        yield* dedup.remember(TighteningId.make(1))
        yield* dedup.remember(TighteningId.make(2))
        yield* dedup.remember(TighteningId.make(3))

        expect(yield* dedup.seen(TighteningId.make(1))).toBe(false)
        expect(yield* dedup.seen(TighteningId.make(3))).toBe(true)
        assertSome(yield* dedup.lastDelivered, TighteningId.make(3))
      })
    )
  )

  it.effect("waits for a baseline before trusting an identifier", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dedup = yield* Dedup.make(16)

        // A controller that has results we have not seen: until it tells us
        // where it is, a delivered result says nothing about what came before.
        yield* dedup.remember(TighteningId.make(4712004))

        assertNone(yield* dedup.lastDelivered)
      })
    )
  )

  it.effect("takes the baseline from the controller, wherever it counts from", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dedup = yield* Dedup.make(16)

        yield* dedup.markBaseline(TighteningId.make(4712003))
        yield* dedup.remember(TighteningId.make(4712004))

        assertSome(yield* dedup.lastDelivered, TighteningId.make(4712004))
      })
    )
  )

  it.effect("treats an empty controller as counting from its first result", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dedup = yield* Dedup.make(16)

        yield* dedup.markNoHistory
        yield* dedup.remember(TighteningId.make(7))

        assertSome(yield* dedup.lastDelivered, TighteningId.make(7))
      })
    )
  )
})
