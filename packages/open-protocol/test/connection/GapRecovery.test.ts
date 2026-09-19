import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Predicate, Ref, Stream } from "effect"
import * as A from "effect/Array"
import * as GapRecovery from "../../src/connection/GapRecovery.ts"
import { resolveSettings } from "../../src/connection/DeviceSettings.ts"
import type { Session } from "../../src/connection/Session.ts"
import { type Message, OldResult } from "../../src/protocol/Messages.ts"
import { ControllerTimestamp, DeviceId, TighteningId, TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { Endpoint } from "../../src/transport/Transport.ts"
import * as Dedup from "../../src/results/Dedup.ts"
import type { ResultDelivery } from "../../src/results/ResultDelivery.ts"

const deviceId = DeviceId.make("gap-tool")

const resultFor = (id: number): TighteningResult =>
  new TighteningResult({
    deviceId,
    tighteningId: TighteningId.make(id),
    vin: `VIN${id}`,
    parameterSetId: 1,
    status: "OK",
    torqueStatus: "OK",
    angleStatus: "OK",
    torque: 12.34,
    angle: 90,
    timestamp: ControllerTimestamp.make("2026-09-18:10:14:16")
  })

const settings = resolveSettings({
  id: deviceId,
  endpoint: new Endpoint({ host: "gap", port: 4545 }),
  recoveryAttempts: 1,
  recoveryRetryDelay: Duration.millis(1)
})

/**
 * A session that records which MIDs were asked for and answers every old
 * result request from a fixed store.
 */
const fixture = Effect.fnUntraced(function* () {
  const asked = yield* Ref.make<ReadonlyArray<number>>([])
  const submitted = yield* Ref.make<ReadonlyArray<number>>([])
  const dedup = yield* Dedup.make(64)

  // Recovery only talks through `replies`; the duplex is an inert stand-in.
  const session: Session = {
    duplex: { incoming: Stream.empty, send: () => Effect.void },
    replies: {
      request: (message: Message, mid: number) =>
        Effect.andThen(
          Ref.update(asked, (current) => A.append(current, mid)),
          Effect.succeed(
            Predicate.isTagged(message, "RequestOldResult")
              ? new OldResult({
                  result: resultFor(message.tighteningId === 0 ? 3 : message.tighteningId)
                })
              : new OldResult({ result: resultFor(3) })
          )
        ),
      offer: () => Effect.succeed(false),
      interruptAll: () => Effect.void
    }
  }

  const pipeline = {
    submit: (result: TighteningResult) =>
      Effect.andThen(
        Ref.update(submitted, (current) => A.append(current, result.tighteningId)),
        dedup.remember(result.tighteningId)
      ),
    delivered: Effect.succeed(0),
    duplicates: Effect.succeed(0)
  } satisfies ResultDelivery

  // The window is real and the delivery queue is this stub.
  const recovery = yield* GapRecovery.make({ settings, dedup, pipeline })

  return { asked, dedup, pipeline, recovery, session, submitted }
})

describe("what triggers a MID 0064", () => {
  it.effect("a contiguous result asks the controller for nothing", () =>
    Effect.gen(function* () {
      const gap = yield* fixture()
      yield* gap.dedup.markBaseline(TighteningId.make(1))

      yield* gap.recovery.submitResult(gap.session, resultFor(2))
      yield* Effect.yieldNow

      expect(yield* Ref.get(gap.asked)).toEqual([])
    })
  )

  // Live: the pass runs on a forked fiber and sleeps between attempts, so the
  // test clock would hold it still.
  it.live("a result that skips an identifier asks for the gap", () =>
    Effect.gen(function* () {
      const gap = yield* fixture()
      yield* gap.dedup.markBaseline(TighteningId.make(1))

      yield* gap.recovery.submitResult(gap.session, resultFor(3))
      yield* Effect.sleep(Duration.millis(50))

      const requests = yield* Ref.get(gap.asked)
      expect(A.length(requests)).toBeGreaterThan(0)
      expect(A.every(requests, (mid) => mid === 64)).toBe(true)
    })
  )

  it.effect("a result arriving before any baseline asks for nothing", () =>
    Effect.gen(function* () {
      const gap = yield* fixture()

      yield* gap.recovery.submitResult(gap.session, resultFor(9))
      yield* Effect.yieldNow

      expect(yield* Ref.get(gap.asked)).toEqual([])
    })
  )
})
