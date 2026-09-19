import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Exit, Fiber, pipe, Predicate, Ref, Schedule, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as ControllerSimulator from "../../simulator/ControllerSimulator.ts"
import * as TcpListener from "../../simulator/TcpListener.ts"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import * as TcpTransport from "../../src/transport/TcpTransport.ts"
import { Endpoint, Transport } from "../../src/transport/Transport.ts"

const deviceId = DeviceId.make("outage-tool")

const endpoint = new Endpoint({ host: "127.0.0.1", port: 45456 })

/** Waits on real time: this test talks to a socket. */
const settle = <A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, attempts = 300): Effect.Effect<A> =>
  Effect.flatMap(effect, (value) =>
    predicate(value) || attempts <= 0
      ? Effect.succeed(value)
      : Effect.andThen(Effect.sleep(Duration.millis(20)), settle(effect, predicate, attempts - 1))
  )

describe("a controller that loses its port", () => {
  it.live(
    "drops the session, refuses connections, and gives the results back on return",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* Transport
          const simulator = yield* ControllerSimulator.make({ endpoint, controllerName: "OutageSim" })

          const received = yield* Ref.make<ReadonlyArray<string>>([])

          const connection = yield* DeviceConnection.make({
            id: deviceId,
            endpoint,
            reconnect: Schedule.spaced(Duration.millis(100)),
            recoveryInterval: Duration.millis(200),
            onResult: (result: TighteningResult) =>
              Ref.update(received, (current) => A.append(current, `${result.tighteningId}`))
          })

          const ready = yield* pipe(
            SubscriptionRef.changes(connection.state),
            Stream.filter((current) => Predicate.isTagged(current, "Ready")),
            Stream.runHead
          )

          expect(O.isSome(ready)).toBe(true)

          // One result while the link is healthy, so the client has a baseline.
          yield* simulator.produce
          yield* settle(Ref.get(received), (current) => A.length(current) === 1)

          // The controller reboots: the listener goes, and the open session with it.
          yield* simulator.refuse(true)

          const dropped = yield* settle(
            SubscriptionRef.get(connection.state),
            (current) => !Predicate.isTagged(current, "Ready")
          )

          expect(Predicate.isTagged(dropped, "Ready")).toBe(false)

          // Nothing is listening now, so a fresh connection is refused outright.
          const attempt = yield* Effect.exit(Effect.scoped(transport.connect(endpoint)))
          expect(Exit.isFailure(attempt)).toBe(true)

          // A result produced while nobody could hear it is what recovery owes us.
          const missed = yield* simulator.produce
          const missedId = `${missed.tighteningId}`

          yield* simulator.refuse(false)

          const delivered = yield* settle(Ref.get(received), (current) => A.contains(current, missedId), 500)
          expect(A.contains(delivered, missedId)).toBe(true)
          expect(yield* connection.duplicates).toBe(0)
        })
      ).pipe(Effect.provide([TcpTransport.layer, TcpListener.layer()])),
    60_000
  )

  it.live("keeps the port it took back after the fiber that asked for it is gone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* Transport
        const port = new Endpoint({ host: "127.0.0.1", port: 45457 })
        const simulator = yield* ControllerSimulator.make({ endpoint: port })

        yield* simulator.refuse(true)
        // The rebind is asked for on a fiber that ends as soon as it returns.
        yield* Fiber.join(yield* Effect.forkChild(simulator.refuse(false)))

        const reached = yield* Effect.exit(Effect.scoped(transport.connect(port)))
        expect(Exit.isSuccess(reached)).toBe(true)
      })
    ).pipe(Effect.provide([TcpTransport.layer, TcpListener.layer()]))
  )
})
