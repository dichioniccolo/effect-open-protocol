import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, pipe, Stream } from "effect"
import { frames } from "../../src/protocol/Framer.ts"
import {
  CommandError,
  CommunicationStart,
  CommunicationStartAccepted,
  decodeMessage,
  encodeMessage,
  KeepAlive,
  type Message,
  SubscribeResults
} from "../../src/protocol/Messages.ts"
import { DeviceId } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layerNetwork } from "../../src/transport/InMemoryTransport.ts"
import { type Duplex, Endpoint } from "../../src/transport/Transport.ts"
import { make } from "../../simulator/ControllerSimulator.ts"

const deviceId = DeviceId.make("test-client")
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
    return yield* Effect.forEach(collected, (frame) => Effect.fromResult(decodeMessage(frame, deviceId)))
  })

describe("ControllerSimulator", () => {
  it.effect("answers the handshake, mirrors keep-alives and accepts subscriptions", () =>
    Effect.scoped(Effect.gen(function* () {
      const simulator = yield* make({ endpoint, controllerName: "Airbag1" })
      const network = yield* InMemoryNetwork
      const connection = yield* network.connect(endpoint)

      const replies = yield* exchange(connection, [
        new CommunicationStart(),
        new KeepAlive(),
        new SubscribeResults()
      ])

      expect(replies.length).toBe(3)
      expect(replies[0]).toEqual(
        new CommunicationStartAccepted({ cellId: 1, channelId: 1, controllerName: "Airbag1" })
      )
      expect(replies[1]).toEqual(new KeepAlive())
      expect(yield* simulator.keepAlives).toBe(1)
      expect(yield* simulator.isSubscribed).toBe(true)
    })).pipe(Effect.provide(layerNetwork)))

  it.effect("rejects the handshake when configured to", () =>
    Effect.scoped(Effect.gen(function* () {
      yield* make({ endpoint, rejectStartWith: 96 })
      const network = yield* InMemoryNetwork
      const connection = yield* network.connect(endpoint)

      const replies = yield* exchange(connection, [new CommunicationStart()])

      expect(replies).toEqual([new CommandError({ mid: 1, code: 96 })])
    })).pipe(Effect.provide(layerNetwork)))

  it.effect("fails to connect when nothing is bound", () =>
    Effect.scoped(Effect.gen(function* () {
      const network = yield* InMemoryNetwork
      const outcome = yield* Effect.result(network.connect(endpoint))
      expect(outcome._tag).toBe("Failure")
    })).pipe(Effect.provide(layerNetwork)))

  it.effect("refuses connections while the endpoint is closed off", () =>
    Effect.scoped(Effect.gen(function* () {
      yield* make({ endpoint })
      const network = yield* InMemoryNetwork
      yield* network.refuse(endpoint, true)
      const refused = yield* Effect.result(network.connect(endpoint))
      expect(refused._tag).toBe("Failure")
      yield* network.refuse(endpoint, false)
      const accepted = yield* Effect.result(network.connect(endpoint))
      expect(accepted._tag).toBe("Success")
    })).pipe(Effect.provide(layerNetwork)))
})
