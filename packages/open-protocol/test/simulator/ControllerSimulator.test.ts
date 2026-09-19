import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, pipe, Result, Stream } from "effect"
import { frames } from "../../src/protocol/Framer.ts"
import {
  CommandError,
  CommunicationStart,
  CommunicationStartAccepted,
  decodeMessage,
  encodeMessage,
  KeepAlive,
  type Message,
  SubscribeResults,
  UnknownMessage
} from "../../src/protocol/Messages.ts"
import { InMemoryNetwork } from "../../src/transport/InMemoryTransport.ts"
import { layerSimulated } from "../../simulator/SimulatorNetwork.ts"
import { type Duplex, Endpoint } from "../../src/transport/Transport.ts"
import * as ControllerBehaviour from "../../simulator/ControllerBehaviour.ts"
import * as ControllerSimulator from "../../simulator/ControllerSimulator.ts"

const endpoint = new Endpoint({ host: "simulator", port: 4545 })

const encoder = new TextEncoder()

const exchange = (connection: Duplex, outgoing: ReadonlyArray<Message>) =>
  Effect.gen(function* () {
    const replies = yield* pipe(
      connection.incoming,
      frames,
      Stream.take(outgoing.length),
      Stream.runCollect,
      Effect.forkChild
    )

    yield* Effect.forEach(outgoing, (message) => connection.send(encoder.encode(encodeMessage(message))), {
      discard: true
    })
    const collected = yield* Fiber.join(replies)

    return yield* Effect.forEach(collected, (frame) => decodeMessage(frame))
  })

describe("ControllerSimulator", () => {
  it.effect("answers the handshake, mirrors keep-alives and accepts subscriptions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint, controllerName: "Airbag1" })
        const network = yield* InMemoryNetwork
        const connection = yield* network.connect(endpoint)

        const replies = yield* exchange(connection, [new CommunicationStart(), new KeepAlive(), new SubscribeResults()])

        expect(replies.length).toBe(3)
        expect(replies[0]).toEqual(
          new CommunicationStartAccepted({ cellId: 1, channelId: 1, controllerName: "Airbag1" })
        )
        expect(replies[1]).toEqual(new KeepAlive())
        expect(yield* simulator.keepAlives).toBe(1)
        expect(yield* simulator.isSubscribed).toBe(true)
      })
    ).pipe(Effect.provide(layerSimulated))
  )

  it.effect("starts every connection without the previous one's subscription", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint })
        const network = yield* InMemoryNetwork
        const first = yield* network.connect(endpoint)
        yield* exchange(first, [new CommunicationStart(), new SubscribeResults()])

        // The first connection is still open when the second one arrives.
        const second = yield* network.connect(endpoint)
        yield* exchange(second, [new KeepAlive()])

        expect(yield* simulator.isSubscribed).toBe(false)
      })
    ).pipe(Effect.provide(layerSimulated))
  )

  it.effect("rejects the handshake when configured to", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint, rejectStartWith: 96 })
        const network = yield* InMemoryNetwork
        const connection = yield* network.connect(endpoint)

        const replies = yield* exchange(connection, [new CommunicationStart()])

        expect(replies).toEqual([new CommandError({ mid: 1, code: 96 })])
      })
    ).pipe(Effect.provide(layerSimulated))
  )

  it.effect("fails to connect when nothing is bound", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const network = yield* InMemoryNetwork
        const outcome = yield* Effect.result(network.connect(endpoint))
        expect(Result.isFailure(outcome)).toBe(true)
      })
    ).pipe(Effect.provide(layerSimulated))
  )

  it.effect("refuses connections while the endpoint is closed off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint })
        const network = yield* InMemoryNetwork
        yield* simulator.refuse(true)
        const refused = yield* Effect.result(network.connect(endpoint))
        expect(Result.isFailure(refused)).toBe(true)
        yield* simulator.refuse(false)
        const accepted = yield* Effect.result(network.connect(endpoint))
        expect(Result.isSuccess(accepted)).toBe(true)
      })
    ).pipe(Effect.provide(layerSimulated))
  )

  it.effect("refuses a MID it does not know and a revision it does not support", () =>
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          yield* ControllerSimulator.make({ endpoint })
          const network = yield* InMemoryNetwork
          const connection = yield* network.connect(endpoint)

          const replies = yield* exchange(connection, [
            new UnknownMessage({ mid: 900, revision: 1, data: "" }),
            new UnknownMessage({ mid: 9999, revision: 2, data: "" })
          ])

          expect(replies).toEqual([
            new CommandError({ mid: 900, code: ControllerBehaviour.refusalCodes.unknownMid }),
            new CommandError({ mid: 9999, code: ControllerBehaviour.refusalCodes.unsupportedRevision })
          ])
        })
      ),
      layerSimulated
    )
  )
})
