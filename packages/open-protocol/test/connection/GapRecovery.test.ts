import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Predicate, Ref, Stream } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as Str from "effect/String"
import * as GapRecovery from "../../src/connection/GapRecovery.ts"
import { type DeviceSettings, resolveSettings } from "../../src/connection/DeviceSettings.ts"
import * as RequestReply from "../../src/connection/RequestReply.ts"
import type { Session } from "../../src/connection/Session.ts"
import type { Pushed } from "../../src/connection/Subscriptions.ts"
import { decodeFrame, decodeMessage, encodeMessage, OldResult } from "../../src/protocol/Messages.ts"
import {
  ControllerTimestamp,
  DeviceId,
  fieldsOf,
  TighteningId,
  TighteningResult
} from "../../src/protocol/TighteningResult.ts"
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
const fixture = Effect.fnUntraced(function* (recoverySettings: DeviceSettings = settings, silentFirst = 0) {
  const asked = yield* Ref.make<ReadonlyArray<number>>([])
  // The first `silentFirst` requests for a stored result go unanswered.
  const unanswered = yield* Ref.make(silentFirst)
  const submitted = yield* Ref.make<ReadonlyArray<number>>([])
  const dedup = yield* Dedup.make(64)

  // Recovery only talks through `replies`, so the controller is a send
  // function that answers every old result request from a fixed store.
  const slot = yield* Ref.make(O.none<RequestReply.RequestReply>())

  const answer = (frame: string) =>
    Effect.gen(function* () {
      const message = yield* Effect.orDie(decodeMessage(Str.substring(0, Str.length(frame) - 1)(frame)))
      yield* Ref.update(asked, (current) => A.append(current, Number(Str.substring(4, 8)(frame))))

      const reply = new OldResult(
        fieldsOf(
          resultFor(
            Predicate.isTagged(message, "RequestOldResult") && message.tighteningId !== 0 ? message.tighteningId : 3
          )
        )
      )

      const replies = yield* Ref.get(slot)

      const stored = Predicate.isTagged(message, "RequestOldResult") && message.tighteningId !== 0
      const silent = stored && (yield* Ref.getAndUpdate(unanswered, (n) => n - 1)) > 0

      yield* O.match(silent ? O.none() : replies, {
        onNone: () => Effect.void,
        onSome: (current) =>
          Effect.asVoid(Effect.flatMap(Effect.orDie(decodeFrame(encodeMessage(reply))), current.offer))
      })
    })

  const replies = yield* RequestReply.make({ send: answer, responseTimeout: Duration.seconds(1) })
  yield* Ref.set(slot, O.some(replies))

  const session: Session = { duplex: { incoming: Stream.empty, send: () => Effect.void }, replies }

  const submit = (result: TighteningResult) =>
    Effect.andThen(
      Ref.update(submitted, (current) => A.append(current, result.tighteningId)),
      dedup.remember(result.tighteningId)
    )

  const pipeline = {
    submitPushed: (pushed: Pushed<TighteningResult>) => submit(pushed.value),
    submitRecovered: submit,
    delivered: Effect.succeed(0),
    duplicates: Effect.succeed(0)
  } satisfies ResultDelivery

  // The window is real and the delivery queue is this stub.
  const recovery = yield* GapRecovery.make({ settings: recoverySettings, dedup, pipeline })

  return { asked, dedup, pipeline, recovery, session, submitted }
})

describe("what triggers a MID 0064", () => {
  it.effect("a contiguous result asks the controller for nothing", () =>
    Effect.gen(function* () {
      const gap = yield* fixture()
      yield* gap.dedup.markBaseline(TighteningId.make(1))

      yield* gap.recovery.submitPushed(gap.session, { value: resultFor(2), ack: Effect.void })
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

      yield* gap.recovery.submitPushed(gap.session, { value: resultFor(3), ack: Effect.void })
      yield* Effect.sleep(Duration.millis(50))

      const requests = yield* Ref.get(gap.asked)
      expect(A.length(requests)).toBeGreaterThan(0)
      expect(A.every(requests, (mid) => mid === 64)).toBe(true)
    })
  )

  it.live("a result arriving before any baseline asks where the results start", () =>
    Effect.gen(function* () {
      const gap = yield* fixture()

      yield* gap.recovery.submitPushed(gap.session, { value: resultFor(9), ack: Effect.void })
      yield* Effect.sleep(Duration.millis(50))

      const requests = yield* Ref.get(gap.asked)
      expect(A.length(requests)).toBeGreaterThan(0)
      expect(A.every(requests, (mid) => mid === 64)).toBe(true)
    })
  )

  it.effect("a gap larger than one pass is fetched to the end", () =>
    Effect.gen(function* () {
      // The fixture's controller holds results up to 3; one pass fetches one.
      const gap = yield* fixture({ ...settings, recoveryLimit: 1 })
      yield* gap.dedup.markBaseline(TighteningId.make(1))

      yield* gap.recovery.recoverGap(gap.session)

      expect(yield* Ref.get(gap.submitted)).toEqual([2, 3])
    })
  )

  it.live("what a pass had to leave is fetched later without another trigger", () =>
    Effect.gen(function* () {
      const gap = yield* fixture(
        {
          ...settings,
          recoveryAttempts: 1,
          recoveryTimeout: Duration.millis(20),
          recoveryRetryDelay: Duration.millis(10)
        },
        2
      )

      yield* gap.dedup.markBaseline(TighteningId.make(1))

      // The only pass allowed gets no answer for 2 and 3 and gives up.
      yield* gap.recovery.recoverGap(gap.session)
      expect(yield* Ref.get(gap.submitted)).toEqual([])

      yield* Effect.forkChild(gap.recovery.keepUp(gap.session))
      yield* Effect.sleep(Duration.millis(200))

      expect(yield* Ref.get(gap.submitted)).toEqual([2, 3])
    })
  )
})
