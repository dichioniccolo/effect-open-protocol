/**
 * A simulated Open Protocol controller, written with Effect like the library
 * it exercises.
 *
 * Reviewers have no tightening tool on their desk, so the simulator is what
 * makes this project runnable and verifiable. This module owns the lifecycle
 * alone: accepting connections, serving a session, producing results and
 * waiting for their acknowledgement. What a controller answers lives in
 * `ControllerBehaviour`, how it misbehaves on the wire in `FaultyWire`, and
 * what it remembers in `SessionState`.
 *
 * @since 0.0.0
 */
import { Deferred, Duration, Effect, Fiber, pipe, Queue, Ref, Scope, Stream } from "effect"
import * as A from "effect/Array"
import * as MutableHashMap from "effect/MutableHashMap"
import * as O from "effect/Option"
import { frames } from "../src/protocol/Framer.ts"
import { decodeMessage, LastResult } from "../src/protocol/Messages.ts"
import { type TighteningId, TighteningResult } from "../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, type ServerSide } from "../src/transport/InMemoryTransport.ts"
import type { Endpoint } from "../src/transport/Transport.ts"
import {
  type ControllerIdentity,
  observe,
  replyTo,
  resultFor,
  simulatorDevice
} from "./ControllerBehaviour.ts"
import type * as Faults from "./Faults.ts"
import { sendWithFaults } from "./FaultyWire.ts"
import { forget, initialSessionState, latestOf, type SessionState } from "./SessionState.ts"
import { makeTcpListener } from "./TcpListener.ts"

export { SimulatorListenFailed } from "./TcpListener.ts"

/**
 * How a simulated controller should behave.
 *
 * @category models
 * @since 0.0.0
 */
export interface SimulatorOptions extends ControllerIdentity {
  readonly endpoint: Endpoint
  /** Produces a tightening result on this interval once a subscription exists. */
  readonly resultInterval?: Duration.Duration | undefined
  /** How long to wait for MID 0062 before resending a result. Defaults to 5 seconds. */
  readonly ackTimeout?: Duration.Duration | undefined
  /** Attempts before the controller gives up on a result and drops the session. */
  readonly ackAttempts?: number | undefined
  /** Seeded misbehaviour injected while the session runs. */
  readonly faults?: Faults.FaultConfig | undefined
  /**
   * Wraps every accepted connection before the simulator serves it. The CLI
   * uses it to trace and delay the bytes this controller writes.
   */
  readonly decorate?: ((side: ServerSide) => Effect.Effect<ServerSide>) | undefined
}

/**
 * What a running simulator exposes to a test or demo.
 *
 * @category models
 * @since 0.0.0
 */
export interface Simulator {
  /** Whether a client currently holds a subscription. */
  readonly isSubscribed: Effect.Effect<boolean>
  /** Number of keep-alives mirrored so far. */
  readonly keepAlives: Effect.Effect<number>
  /** Number of communication stop messages received: a client that left politely. */
  readonly stops: Effect.Effect<number>
  /** Results produced so far, acknowledged or not. */
  readonly generated: Effect.Effect<number>
  /** Results the controller gave up on: with Open Protocol semantics they are lost. */
  readonly abandoned: Effect.Effect<ReadonlyArray<TighteningId>>
  /** Produces one result immediately and returns it. */
  readonly produce: Effect.Effect<TighteningResult>
  /** Drops the current connection the way a controller does when it gives up. */
  readonly drop: Effect.Effect<void>
  /** Stops producing results and injecting faults, so a run can settle before it is judged. */
  readonly quiesce: Effect.Effect<void>
  /** Results still waiting to be pushed or acknowledged. */
  readonly backlog: Effect.Effect<number>
}

const serve = (
  connection: ServerSide,
  state: Ref.Ref<SessionState>,
  store: MutableHashMap.MutableHashMap<number, TighteningResult>,
  options: SimulatorOptions,
  refuseFor: (duration: Duration.Duration) => Effect.Effect<void>
): Effect.Effect<void> =>
  pipe(
    Ref.update(state, (current) => ({ ...current, connection: O.some(connection) })),
    Effect.andThen(
      pipe(
        frames(connection.incoming),
        Stream.runForEach((frame) =>
          pipe(
            decodeMessage(frame, simulatorDevice),
            Effect.fromResult,
            Effect.flatMap((message) =>
              pipe(
                Ref.modify(state, (current) => [current, observe(message, current)]),
                Effect.flatMap((current) =>
                  message._tag === "AcknowledgeResult"
                    ? O.match(current.pendingAck, {
                      onNone: () => Effect.void,
                      onSome: (deferred) => Effect.asVoid(Deferred.succeed(deferred, undefined))
                    })
                    : O.match(replyTo(message, options, store, latestOf(current)), {
                      onNone: () => Effect.void,
                      onSome: (reply) => sendWithFaults(connection, reply, options.faults, state, refuseFor)
                    })
                )
              )
            ),
            Effect.catchCause((cause) => Effect.logWarning("simulator dropped a frame", cause))
          )
        ),
        Effect.catchCause((cause) => Effect.logDebug("simulator session ended", cause))
      )
    ),
    Effect.andThen(Ref.update(state, (current) => forget(current, connection)))
  )

/**
 * Starts a simulated controller on the in-memory network for the lifetime of
 * the calling scope.
 *
 * **Example** (Running a client against a simulated controller)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Endpoint } from "effect-open-protocol"
 * import { make } from "../simulator/ControllerSimulator.ts"
 *
 * const program = Effect.gen(function* () {
 *   const simulator = yield* make({ endpoint: new Endpoint({ host: "sim", port: 4545 }) })
 *   return yield* simulator.keepAlives
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const makeWith = Effect.fnUntraced(function* (
  options: SimulatorOptions,
  accept: Effect.Effect<Queue.Dequeue<ServerSide>, never, Scope.Scope>,
  refuse: (refused: boolean) => Effect.Effect<void>
) {
  const store = MutableHashMap.empty<number, TighteningResult>()
  const state = yield* Ref.make<SessionState>(initialSessionState)
  const ackTimeout = options.ackTimeout ?? Duration.seconds(5)
  const ackAttempts = options.ackAttempts ?? 3
  const accepted = yield* accept

  // Outage windows run on the simulator's own fiber, one at a time, so the
  // endpoint always starts accepting again even if the session that triggered
  // the outage is long gone.
  const outages = yield* Queue.unbounded<Duration.Duration>()
  yield* Effect.forkChild(
    Effect.forever(
      Effect.flatMap(Queue.take(outages), (duration) =>
        pipe(
          refuse(true),
          Effect.andThen(Effect.sleep(duration)),
          Effect.andThen(refuse(false))
        ))
    )
  )
  const refuseFor = (duration: Duration.Duration): Effect.Effect<void> =>
    Effect.asVoid(Queue.offer(outages, duration))

  // No finalizer clearing the outage here: with a real listener, "accept again"
  // at shutdown would rebind the port the scope is about to release. An outage
  // in flight dies with the simulator either way.

  const acceptLoop = yield* pipe(
    Queue.take(accepted),
    Effect.flatMap((connection) => Effect.forkChild(serve(connection, state, store, options, refuseFor))),
    Effect.forever,
    Effect.forkChild
  )

  /** Pushes a result and waits for its acknowledgement, resending as the specification prescribes. */
  const push = (result: TighteningResult): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      return yield* O.match(current.connection, {
        onNone: () => Effect.void,
        onSome: (connection) =>
          current.subscribed
            ? Effect.gen(function* () {
              const acknowledged = yield* Deferred.make<void>()
              yield* Ref.update(state, (value) => ({ ...value, pendingAck: O.some(acknowledged) }))
              const attempt = pipe(
                sendWithFaults(connection, new LastResult({ result }), options.faults, state, refuseFor),
                Effect.andThen(Deferred.await(acknowledged)),
                Effect.timeoutOption(ackTimeout),
                Effect.catchCause(() => Effect.succeed(O.none<void>()))
              )
              const tryDeliver = (remaining: number): Effect.Effect<boolean> =>
                remaining <= 0
                  ? Effect.succeed(false)
                  : Effect.flatMap(
                    attempt,
                    O.match({
                      onNone: () => tryDeliver(remaining - 1),
                      onSome: () => Effect.succeed(true)
                    })
                  )
              const delivered = yield* tryDeliver(ackAttempts)
              yield* Ref.update(state, (value) => ({ ...value, pendingAck: O.none() }))
              return yield* delivered
                ? Effect.void
                : pipe(
                  Ref.update(state, (value) => ({
                    ...value,
                    abandoned: A.append(value.abandoned, result.tighteningId)
                  })),
                  Effect.andThen(
                    Effect.logWarning("giving up on an unacknowledged result").pipe(
                      Effect.annotateLogs({ tighteningId: result.tighteningId })
                    )
                  ),
                  Effect.andThen(connection.close("no acknowledgement for the last tightening result"))
                )
            })
            : Effect.void
      })
    })

  const outbox = yield* Queue.unbounded<TighteningResult>()

  // The controller sends one result at a time and waits for its acknowledgement
  // (confirmed behaviour), so pushes are serialised through this queue.
  yield* Effect.forkChild(Effect.forever(Effect.flatMap(Queue.take(outbox), push)))

  const produce = Effect.gen(function* () {
    const id = yield* Ref.modify(state, (current) => [current.nextId, {
      ...current,
      nextId: current.nextId + 1,
      generated: current.generated + 1
    }])
    const result = resultFor(id)
    MutableHashMap.set(store, id, result)
    yield* Queue.offer(outbox, result)
    return result
  })

  yield* O.match(O.fromNullishOr(options.resultInterval), {
    onNone: () => Effect.void,
    onSome: (interval) =>
      Effect.asVoid(
        Effect.forkChild(
          Effect.forever(
            pipe(
              Effect.sleep(interval),
              Effect.andThen(Ref.get(state)),
              Effect.flatMap((current) =>
                current.quiet || !current.everSubscribed ? Effect.void : Effect.asVoid(produce)
              )
            )
          )
        )
      )
  })

  yield* Effect.addFinalizer(() => Fiber.interrupt(acceptLoop))

  const drop = pipe(
    Ref.getAndUpdate(state, (current) => ({ ...current, subscribed: false, connection: O.none() })),
    Effect.flatMap((current) =>
      O.match(current.connection, {
        onNone: () => Effect.void,
        onSome: (connection) => connection.close("the controller dropped the connection")
      })
    )
  )

  return {
    quiesce: Ref.update(state, (current) => ({ ...current, quiet: true })),
    backlog: Queue.size(outbox),
    isSubscribed: Effect.map(Ref.get(state), (current) => current.subscribed),
    keepAlives: Effect.map(Ref.get(state), (current) => current.keepAlives),
    stops: Effect.map(Ref.get(state), (current) => current.stops),
    generated: Effect.map(Ref.get(state), (current) => current.generated),
    abandoned: Effect.map(Ref.get(state), (current) => current.abandoned),
    produce,
    drop
  } satisfies Simulator
})

/**
 * Starts a simulated controller on the in-memory network.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: SimulatorOptions) {
  const network = yield* InMemoryNetwork
  return yield* makeWith(
    options,
    network.bind(options.endpoint),
    (refused) => network.refuse(options.endpoint, refused)
  )
})

/**
 * Starts a simulated controller on a real TCP port.
 *
 * Used by the localhost smoke test and by the demo when it runs over TCP: the
 * same behaviour as the in-memory simulator, one socket layer lower.
 *
 * @category constructors
 * @since 0.0.0
 */
export const makeTcp = Effect.fnUntraced(function* (options: SimulatorOptions) {
  const listener = yield* makeTcpListener({ endpoint: options.endpoint, decorate: options.decorate })
  return yield* makeWith(options, Effect.succeed(listener.accept), listener.refuse)
})
