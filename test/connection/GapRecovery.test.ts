import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Ref } from "effect"
import * as A from "effect/Array"
import { makeGapRecovery } from "../../src/connection/GapRecovery.ts"
import { resolveSettings } from "../../src/connection/DeviceSettings.ts"
import type { Session } from "../../src/connection/Session.ts"
import { type Message, OldResult } from "../../src/protocol/Messages.ts"
import {
  ControllerTimestamp,
  DeviceId,
  TighteningId,
  TighteningResult
} from "../../src/protocol/TighteningResult.ts"
import { Endpoint } from "../../src/transport/Transport.ts"
import { makeDedup } from "../../src/results/Dedup.ts"
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
  const dedup = yield* makeDedup(64)

  const session = {
    duplex: { incoming: undefined, send: undefined },
    replies: {
      request: (message: Message, mid: number) =>
        Effect.andThen(
          Ref.update(asked, (current) => A.append(current, mid)),
          Effect.succeed(
            message._tag === "RequestOldResult"
              ? new OldResult({
                result: resultFor(message.tighteningId === 0 ? 3 : message.tighteningId)
              })
              : new OldResult({ result: resultFor(3) })
          )
        )
    }
  } as unknown as Session

  const pipeline = {
    submit: (result: TighteningResult) =>
      Effect.andThen(
        Ref.update(submitted, (current) => A.append(current, result.tighteningId)),
        dedup.remember(result.tighteningId)
      ),
    delivered: Effect.succeed(0),
    duplicates: Effect.succeed(0)
  } satisfies ResultDelivery

  const recovery = yield* makeGapRecovery({ settings, dedup })
  return { asked, dedup, pipeline, recovery, session, submitted }
})

describe("what triggers a MID 0064", () => {
  it.effect("a contiguous result asks the controller for nothing", () =>
    Effect.gen(function* () {
      const { asked, dedup, pipeline, recovery, session } = yield* fixture()
      yield* dedup.markBaseline(TighteningId.make(1))

      yield* recovery.submitResult(session, pipeline, resultFor(2))
      yield* Effect.yieldNow

      expect(yield* Ref.get(asked)).toEqual([])
    }))

  // Live: the pass runs on a forked fiber and sleeps between attempts, so the
  // test clock would hold it still.
  it.live("a result that skips an identifier asks for the gap", () =>
    Effect.gen(function* () {
      const { asked, dedup, pipeline, recovery, session } = yield* fixture()
      yield* dedup.markBaseline(TighteningId.make(1))

      yield* recovery.submitResult(session, pipeline, resultFor(3))
      yield* Effect.sleep(Duration.millis(50))

      const requests = yield* Ref.get(asked)
      expect(A.length(requests)).toBeGreaterThan(0)
      expect(A.every(requests, (mid) => mid === 64)).toBe(true)
    }))

  it.effect("a result arriving before any baseline asks for nothing", () =>
    Effect.gen(function* () {
      const { asked, pipeline, recovery, session } = yield* fixture()

      yield* recovery.submitResult(session, pipeline, resultFor(9))
      yield* Effect.yieldNow

      expect(yield* Ref.get(asked)).toEqual([])
    }))
})
