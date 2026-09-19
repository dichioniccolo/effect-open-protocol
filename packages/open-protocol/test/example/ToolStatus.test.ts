/**
 * The worked example of a user-defined MID: two revisions, a request whose
 * every revision declares its reply, and a typed exchange over the in-memory
 * transport.
 *
 * MIDs 9100 and 9101 and their layouts are illustrative, made up for this
 * example; they are not taken from the Open Protocol specification.
 */
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import { Effect, Predicate, Queue, Stream, SubscriptionRef } from "effect"
import * as O from "effect/Option"
import * as Str from "effect/String"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import * as Field from "../../src/protocol/Field.ts"
import { frames } from "../../src/protocol/Framer.ts"
import { decodeHeader, headerLength } from "../../src/protocol/Header.ts"
import { CommunicationStartAccepted, encodeMessage } from "../../src/protocol/Messages.ts"
import * as Mid from "../../src/protocol/Mid.ts"
import { DeviceId } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layerComplete } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

// --- The definitions a user writes -----------------------------------------

const status = [
  ["toolId", Field.digits({ id: "01", width: 3 })],
  ["temperature", Field.digits({ id: "02", width: 4 })]
] as const

/** MID 9101: a tool's status. Revision 2 appends the motor hours. */
const ToolStatus = Mid.define({
  tag: "ToolStatus",
  mid: 9101,
  revisions: {
    1: Field.layout(status),
    2: Field.layout([...status, ["motorHours", Field.digits({ id: "03", width: 6 })]])
  }
})

/** MID 9100: asks for a tool's status, answered at the same revision. */
const ToolStatusRequest = Mid.request(
  Mid.define({
    tag: "ToolStatusRequest",
    mid: 9100,
    revisions: {
      1: Field.layout([["toolId", Field.digits({ width: 3 })]]),
      2: Field.layout([["toolId", Field.digits({ width: 3 })]])
    }
  }),
  { 1: ToolStatus.rev(1), 2: ToolStatus.rev(2) }
)

// --- A controller that knows MID 9100 ---------------------------------------

const endpoint = new Endpoint({ host: "tool-controller", port: 4545 })

const deviceId = DeviceId.make("tool-1")

const encoder = new TextEncoder()

const statusOf = (toolId: number, revision: number) =>
  revision === 2
    ? Mid.encode(ToolStatus.rev(2), ToolStatus.rev(2).codec.make({ toolId, temperature: 412, motorHours: 1234 }))
    : Mid.encode(ToolStatus.rev(1), ToolStatus.rev(1).codec.make({ toolId, temperature: 412 }))

const answer = (frame: string) =>
  Effect.gen(function* () {
    const header = yield* Effect.fromResult(decodeHeader(frame))
    const data = Str.substring(headerLength, Str.length(frame))(frame)

    if (header.mid === 1) {
      return O.some(encodeMessage(new CommunicationStartAccepted({ cellId: 1, channelId: 1, controllerName: "Tools" })))
    }

    if (header.mid !== 9100) {
      return O.none()
    }

    const request = yield* O.match(ToolStatusRequest.lookup(header.revision), {
      onNone: () => Effect.die("unsupported revision"),
      onSome: (revision) => Mid.decode(revision, data, deviceId)
    })

    return yield* Effect.map(
      Effect.fromResult(
        statusOf(Predicate.hasProperty(request, "toolId") ? Number(request.toolId) : 0, header.revision)
      ),
      O.some
    )
  })

const controller = Effect.gen(function* () {
  const network = yield* InMemoryNetwork
  const accepted = yield* network.bind(endpoint)

  yield* Effect.forkChild(
    Effect.gen(function* () {
      const server = yield* Queue.take(accepted)

      yield* Stream.runForEach(frames(server.incoming), (frame) =>
        Effect.gen(function* () {
          const reply = yield* Effect.orDie(answer(frame))

          if (O.isSome(reply)) {
            yield* server.send(encoder.encode(reply.value))
          }
        })
      )
    })
  )
})

const awaitReady = (state: SubscriptionRef.SubscriptionRef<ConnectionState>) =>
  Effect.gen(function* () {
    const ready = yield* Stream.runHead(
      Stream.filter(SubscriptionRef.changes(state), (current) => Predicate.isTagged(current, "Ready"))
    )

    return yield* O.match(ready, { onNone: () => Effect.never, onSome: Effect.succeed })
  })

const dataOf = (frame: string) => Str.substring(headerLength, Str.length(frame) - 1)(frame)

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(Effect.scoped(effect), layerComplete)

describe("a user-defined MID", () => {
  it("has one exact type per revision, and so does its reply", () => {
    expectTypeOf<Mid.Type<ReturnType<typeof ToolStatus.rev<1>>>>().toEqualTypeOf<{
      readonly _tag: "ToolStatus"
      readonly revision: 1
      readonly toolId: number
      readonly temperature: number
    }>()
    expectTypeOf<Mid.Type<ReturnType<typeof ToolStatus.rev<2>>>>().toEqualTypeOf<{
      readonly _tag: "ToolStatus"
      readonly revision: 2
      readonly toolId: number
      readonly temperature: number
      readonly motorHours: number
    }>()
  })

  it.effect("round trips both revisions through frames", () =>
    Effect.gen(function* () {
      const values = [
        ToolStatus.rev(1).codec.make({ toolId: 7, temperature: 380 }),
        ToolStatus.rev(2).codec.make({ toolId: 7, temperature: 380, motorHours: 99 })
      ] as const

      const first = yield* Effect.fromResult(Mid.encode(ToolStatus.rev(1), values[0]))
      const second = yield* Effect.fromResult(Mid.encode(ToolStatus.rev(2), values[1]))

      expect(dataOf(first)).toBe("01007" + "020380")
      expect(dataOf(second)).toBe("01007" + "020380" + "03000099")
      expect(yield* Mid.decode(ToolStatus.rev(1), dataOf(first), deviceId)).toEqual(values[0])
      expect(yield* Mid.decode(ToolStatus.rev(2), dataOf(second), deviceId)).toEqual(values[1])
    })
  )

  it.effect("asks for each revision over the transport and gets exactly that revision back", () =>
    provided(
      Effect.gen(function* () {
        yield* controller
        const connection = yield* DeviceConnection.make({ id: deviceId, endpoint })
        yield* awaitReady(connection.state)

        const first = yield* connection.request(ToolStatusRequest.rev(1), { toolId: 7 })
        const second = yield* connection.request(ToolStatusRequest.rev(2), { toolId: 7 })

        expectTypeOf(first.revision).toEqualTypeOf<1>()
        expectTypeOf(second.motorHours).toEqualTypeOf<number>()
        expect(first).toEqual(ToolStatus.rev(1).codec.make({ toolId: 7, temperature: 412 }))
        expect(second).toEqual(ToolStatus.rev(2).codec.make({ toolId: 7, temperature: 412, motorHours: 1234 }))
      })
    )
  )
})
