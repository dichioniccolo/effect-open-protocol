/**
 * A controller for the worked example, scripted by the test: it answers the
 * handshake itself and every other MID through `answer`, records what it
 * receives, and hands each session to the test so it can push on it or drop
 * it.
 */
import { Effect, Predicate, Queue, Ref, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as Str from "effect/String"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import { frames } from "../../src/protocol/Framer.ts"
import { decodeHeader, type Header, headerLength } from "../../src/protocol/Header.ts"
import { CommunicationStartAccepted, encodeMessage } from "../../src/protocol/Messages.ts"
import { DeviceId } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layerComplete, type ServerSide } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

export const endpoint = new Endpoint({ host: "tool-controller", port: 4545 })

export const deviceId = DeviceId.make("tool-1")

const encoder = new TextEncoder()

const accepted = encodeMessage(new CommunicationStartAccepted({ cellId: 1, channelId: 1, controllerName: "Tools" }))

/** Binds the example endpoint; `answer` returns the frame to send back, if any. */
export const scriptedController = (answer: (header: Header, data: string) => Effect.Effect<O.Option<string>>) =>
  Effect.gen(function* () {
    const network = yield* InMemoryNetwork
    const incoming = yield* network.bind(endpoint)
    const received = yield* Queue.unbounded<number>()
    const seen = yield* Ref.make<ReadonlyArray<number>>([])
    const sessions = yield* Queue.unbounded<ServerSide>()

    const reply = (header: Header, data: string): Effect.Effect<O.Option<string>> =>
      header.mid === 1 ? Effect.succeedSome(accepted) : answer(header, data)

    const serve = (server: ServerSide) =>
      Stream.runForEach(frames(server.incoming), (frame) =>
        Effect.gen(function* () {
          const header = yield* Effect.orDie(Effect.fromResult(decodeHeader(frame)))

          yield* Queue.offer(received, header.mid)
          yield* Ref.update(seen, A.append(header.mid))
          const sent = yield* reply(header, Str.substring(headerLength, Str.length(frame))(frame))

          if (O.isSome(sent)) {
            yield* server.send(encoder.encode(sent.value))
          }
        })
      )

    yield* Effect.forkChild(
      Effect.forever(
        Effect.gen(function* () {
          const server = yield* Queue.take(incoming)

          yield* Queue.offer(sessions, server)
          yield* Effect.forkChild(Effect.ignore(serve(server)))
        })
      )
    )

    /** Waits until the controller has received MID `mid`. */
    const awaitMid = (mid: number): Effect.Effect<void> =>
      Effect.flatMap(Queue.take(received), (next) => (next === mid ? Effect.void : awaitMid(mid)))

    const push = (server: ServerSide, frame: string) => Effect.orDie(server.send(encoder.encode(frame)))

    return { sessions, awaitMid, push, seen: Ref.get(seen) }
  })

export const awaitReady = (state: SubscriptionRef.SubscriptionRef<ConnectionState>) =>
  Effect.gen(function* () {
    const ready = yield* Stream.runHead(
      Stream.filter(SubscriptionRef.changes(state), (current) => Predicate.isTagged(current, "Ready"))
    )

    return yield* O.match(ready, { onNone: () => Effect.never, onSome: Effect.succeed })
  })

export const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provide(Effect.scoped(effect), layerComplete)
