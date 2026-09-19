import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import { Effect, Predicate, Result, Stream, SubscriptionRef } from "effect"
import * as O from "effect/Option"
import * as ControllerSimulator from "../../simulator/ControllerSimulator.ts"
import { layerSimulated } from "../../simulator/SimulatorNetwork.ts"
import { CommandRejected } from "../../src/connection/ConnectionError.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import {
  AcknowledgeResultMid,
  type CommandAccepted,
  CommunicationStartMid,
  type CommunicationStartAccepted,
  KeepAlive,
  KeepAliveMid,
  type OldResult,
  RequestOldResultMid,
  SubscribeResultsMid
} from "../../src/protocol/Messages.ts"
import type { ReplyOf } from "../../src/protocol/Mid.ts"
import { DeviceId, TighteningId } from "../../src/protocol/TighteningResult.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

const endpoint = new Endpoint({ host: "simulator", port: 4545 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(Effect.scoped(effect), layerSimulated)

const awaitReady = (state: SubscriptionRef.SubscriptionRef<ConnectionState>) =>
  Effect.gen(function* () {
    const ready = yield* Stream.runHead(
      Stream.filter(SubscriptionRef.changes(state), (current) => Predicate.isTagged(current, "Ready"))
    )

    return yield* O.match(ready, { onNone: () => Effect.never, onSome: Effect.succeed })
  })

const connected = Effect.gen(function* () {
  const simulator = yield* ControllerSimulator.make({ endpoint })
  const connection = yield* DeviceConnection.make({ id: DeviceId.make("tool-1"), endpoint })
  yield* awaitReady(connection.state)

  return { simulator, connection }
})

describe("typed request", () => {
  it("types the reply from the definition alone", () => {
    expectTypeOf<ReplyOf<ReturnType<typeof RequestOldResultMid.rev<1>>>>().toEqualTypeOf<OldResult>()
    expectTypeOf<ReplyOf<ReturnType<typeof SubscribeResultsMid.rev<1>>>>().toEqualTypeOf<CommandAccepted>()
    expectTypeOf<ReplyOf<ReturnType<typeof CommunicationStartMid.rev<1>>>>().toEqualTypeOf<CommunicationStartAccepted>()
    expectTypeOf<ReplyOf<ReturnType<typeof KeepAliveMid.rev<1>>>>().toEqualTypeOf<KeepAlive>()
    expectTypeOf<ReplyOf<ReturnType<typeof AcknowledgeResultMid.rev<1>>>>().toEqualTypeOf<void>()
  })

  it.effect("asks for an old result and gets it back as MID 0065 revision 1", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* connected
        const produced = yield* setup.simulator.produce

        const reply = yield* setup.connection.request(RequestOldResultMid.rev(1), {
          tighteningId: TighteningId.make(0)
        })

        expectTypeOf(reply).toEqualTypeOf<OldResult>()
        expect(reply._tag).toBe("OldResult")
        expect(reply.revision).toBe(1)
        expect(reply.tighteningId).toBe(produced.tighteningId)
      })
    )
  )

  it.effect("resolves an accepted request with the 0005 acknowledgement", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* connected

        const accepted = yield* setup.connection.request(SubscribeResultsMid.rev(1), {})

        expectTypeOf(accepted).toEqualTypeOf<CommandAccepted>()
        expect(accepted.mid).toBe(60)
      })
    )
  )

  it.effect("fails with the 0004 the controller answers", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* connected

        const outcome = yield* Effect.result(
          setup.connection.request(RequestOldResultMid.rev(1), { tighteningId: TighteningId.make(424242) })
        )

        expect(outcome).toEqual(Result.fail(new CommandRejected({ mid: 64, code: 15 })))
      })
    )
  )

  it.effect("mirrors a keep-alive", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* connected

        expect(yield* setup.connection.request(KeepAliveMid.rev(1), {})).toEqual(new KeepAlive())
      })
    )
  )
})
