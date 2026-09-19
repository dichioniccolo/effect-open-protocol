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
import { Deferred, Duration, Effect, Fiber, pipe, Predicate, Queue, Ref, Stream } from "effect"
import * as A from "effect/Array"
import * as MutableHashMap from "effect/MutableHashMap"
import * as O from "effect/Option"
import { frames } from "../src/protocol/Framer.ts"
import { decodeMessage, LastResult, type Message } from "../src/protocol/Messages.ts"
import { type TighteningId, TighteningResult } from "../src/protocol/TighteningResult.ts"
import type { ServerSide } from "../src/transport/InMemoryTransport.ts"
import type { Endpoint } from "../src/transport/Transport.ts"
import {
  type ControllerIdentity,
  defaultIdentity,
  observe,
  replyTo,
  resultFor,
  simulatorDevice
} from "./ControllerBehaviour.ts"
import type * as Faults from "./Faults.ts"
import { sendWithFaults } from "./FaultyWire.ts"
import { forget, initialSessionState, latestOf, type SessionState } from "./SessionState.ts"
import { type Listener, SimulatorNetwork } from "./SimulatorNetwork.ts"

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
  /** Attempts before the controller gives up on a result and drops the session. Defaults to 3. */
  readonly ackAttempts?: number | undefined
  /**
   * Seeded misbehaviour injected while the session runs. Absent rather than a
   * zero rate on purpose: a run without faults draws nothing from `Random`, so
   * it replays the same whether or not a fault config type ever changes.
   */
  readonly faults?: Faults.FaultConfig | undefined
}

/** Every simulator knob that has a default, and what it falls back to. */
const defaultOptions = {
  ...defaultIdentity,
  ackTimeout: Duration.seconds(5),
  ackAttempts: 3
}

/** `SimulatorOptions` with every default filled in. */
interface SimulatorSettings
  extends
    Omit<SimulatorOptions, keyof typeof defaultOptions>,
    Required<Pick<SimulatorOptions, keyof typeof defaultOptions>> {}

/** Fills in every default once, key by key so an explicit `undefined` cannot erase one. */
const resolveOptions = (options: SimulatorOptions): SimulatorSettings => ({
  ...options,
  cellId: options.cellId ?? defaultOptions.cellId,
  channelId: options.channelId ?? defaultOptions.channelId,
  controllerName: options.controllerName ?? defaultOptions.controllerName,
  silent: options.silent ?? defaultOptions.silent,
  ackTimeout: options.ackTimeout ?? defaultOptions.ackTimeout,
  ackAttempts: options.ackAttempts ?? defaultOptions.ackAttempts
})

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
  /** Stops accepting connections, the way a rebooting controller does, or starts again. */
  readonly refuse: (refused: boolean) => Effect.Effect<void>
  /** Stops producing results and injecting faults, so a run can settle before it is judged. */
  readonly quiesce: Effect.Effect<void>
  /** Results still waiting to be pushed or acknowledged. */
  readonly backlog: Effect.Effect<number>
}

/** Serves the connections a bound endpoint accepts, for the lifetime of the calling scope. */
const start = Effect.fnUntraced(function* (options: SimulatorSettings, listener: Listener) {
  const store = MutableHashMap.empty<number, TighteningResult>()
  const state = yield* Ref.make<SessionState>(initialSessionState)

  // Outage windows run on the simulator's own fiber, one at a time, so the
  // endpoint always starts accepting again even if the session that triggered
  // the outage is long gone.
  const outages = yield* Queue.unbounded<Duration.Duration>()
  yield* Effect.forkChild(
    Effect.forever(
      Effect.flatMap(Queue.take(outages), (duration) =>
        pipe(listener.refuse(true), Effect.andThen(Effect.sleep(duration)), Effect.andThen(listener.refuse(false)))
      )
    )
  )
  const refuseFor = (duration: Duration.Duration): Effect.Effect<void> => Effect.asVoid(Queue.offer(outages, duration))

  // No finalizer clearing the outage here: with a real listener, "accept again"
  // at shutdown would rebind the port the scope is about to release. An outage
  // in flight dies with the simulator either way.

  const send = (connection: ServerSide, message: Message): Effect.Effect<void> =>
    sendWithFaults(connection, message, options.faults, state, refuseFor)

  /** Serves one accepted connection until it ends. */
  const serve = Effect.fnUntraced(function* (connection: ServerSide) {
    yield* Ref.update(state, (current) => ({ ...current, connection: O.some(connection) }))

    const onFrame = Effect.fnUntraced(function* (frame: string) {
      const message = yield* Effect.fromResult(decodeMessage(frame, simulatorDevice))
      const current = yield* Ref.modify(state, (value) => [value, observe(message, value)])

      if (Predicate.isTagged(message, "AcknowledgeResult")) {
        const pending = current.pendingAck

        if (O.isSome(pending)) {
          yield* Deferred.succeed(pending.value, undefined)
        }

        return
      }

      const reply = replyTo(message, options, store, latestOf(current))

      if (O.isSome(reply)) {
        yield* send(connection, reply.value)
      }
    })

    yield* frames(connection.incoming).pipe(
      Stream.runForEach((frame) =>
        onFrame(frame).pipe(Effect.catchCause((cause) => Effect.logWarning("simulator dropped a frame", cause)))
      ),
      Effect.catchCause((cause) => Effect.logDebug("simulator session ended", cause))
    )

    yield* Ref.update(state, (current) => forget(current, connection))
  })

  const acceptLoop = yield* pipe(
    Queue.take(listener.accepted),
    Effect.flatMap((connection) => Effect.forkChild(serve(connection))),
    Effect.forever,
    Effect.forkChild
  )

  /** Pushes a result and waits for its acknowledgement, resending as the specification prescribes. */
  const push = Effect.fnUntraced(function* (result: TighteningResult) {
    const current = yield* Ref.get(state)

    if (O.isNone(current.connection) || !current.subscribed) {
      return
    }

    const connection = current.connection.value
    const acknowledged = yield* Deferred.make<void>()
    yield* Ref.update(state, (value) => ({ ...value, pendingAck: O.some(acknowledged) }))

    const attempt = send(connection, new LastResult({ result })).pipe(
      Effect.andThen(Deferred.await(acknowledged)),
      Effect.timeoutOption(options.ackTimeout),
      Effect.catchCause(() => Effect.succeed(O.none<void>()))
    )

    const tryDeliver = (remaining: number): Effect.Effect<boolean> =>
      remaining <= 0
        ? Effect.succeed(false)
        : Effect.flatMap(attempt, (acknowledgement) =>
            O.isSome(acknowledgement) ? Effect.succeed(true) : tryDeliver(remaining - 1)
          )

    const delivered = yield* tryDeliver(options.ackAttempts)
    yield* Ref.update(state, (value) => ({ ...value, pendingAck: O.none() }))

    if (delivered) {
      return
    }

    yield* Ref.update(state, (value) => ({ ...value, abandoned: A.append(value.abandoned, result.tighteningId) }))
    yield* Effect.logWarning("giving up on an unacknowledged result").pipe(
      Effect.annotateLogs({ tighteningId: result.tighteningId })
    )
    yield* connection.close("no acknowledgement for the last tightening result")
  })

  const outbox = yield* Queue.unbounded<TighteningResult>()

  // The controller sends one result at a time and waits for its acknowledgement
  // (confirmed behaviour), so pushes are serialised through this queue.
  yield* Effect.forkChild(Effect.forever(Effect.flatMap(Queue.take(outbox), push)))

  const produce = Effect.gen(function* () {
    const id = yield* Ref.modify(state, (current) => [
      current.nextId,
      {
        ...current,
        nextId: current.nextId + 1,
        generated: current.generated + 1
      }
    ])

    const result = resultFor(id)
    MutableHashMap.set(store, id, result)
    yield* Queue.offer(outbox, result)

    return result
  })

  /** Produces a result on each tick, once a client has subscribed and until the run quiesces. */
  const tick = Effect.fnUntraced(function* (interval: Duration.Duration) {
    yield* Effect.sleep(interval)

    const current = yield* Ref.get(state)

    if (!current.quiet && current.everSubscribed) {
      yield* produce
    }
  })

  if (options.resultInterval !== undefined) {
    yield* Effect.forkChild(Effect.forever(tick(options.resultInterval)))
  }

  yield* Effect.addFinalizer(() => Fiber.interrupt(acceptLoop))

  const drop = Effect.gen(function* () {
    const current = yield* Ref.getAndUpdate(state, (value) => ({ ...value, subscribed: false, connection: O.none() }))

    if (O.isSome(current.connection)) {
      yield* current.connection.value.close("the controller dropped the connection")
    }
  })

  return {
    quiesce: Ref.update(state, (current) => ({ ...current, quiet: true })),
    backlog: Queue.size(outbox),
    isSubscribed: Effect.map(Ref.get(state), (current) => current.subscribed),
    keepAlives: Effect.map(Ref.get(state), (current) => current.keepAlives),
    stops: Effect.map(Ref.get(state), (current) => current.stops),
    generated: Effect.map(Ref.get(state), (current) => current.generated),
    abandoned: Effect.map(Ref.get(state), (current) => current.abandoned),
    produce,
    drop,
    refuse: listener.refuse
  } satisfies Simulator
})

/**
 * Starts a simulated controller on the `SimulatorNetwork` in context, for the
 * lifetime of the calling scope.
 *
 * **Example** (Running a client against a simulated controller)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Endpoint } from "effect-open-protocol"
 * import * as ControllerSimulator from "effect-open-protocol/simulator/ControllerSimulator.ts"
 *
 * const program = Effect.gen(function* () {
 *   const simulator = yield* ControllerSimulator.make({ endpoint: new Endpoint({ host: "sim", port: 4545 }) })
 *   return yield* simulator.keepAlives
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: SimulatorOptions) {
  const network = yield* SimulatorNetwork
  const listener = yield* network.bind(options.endpoint)

  return yield* start(resolveOptions(options), listener)
})
