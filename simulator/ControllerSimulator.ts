/**
 * A simulated Open Protocol controller, written with Effect like the library
 * it exercises.
 *
 * Reviewers have no tightening tool on their desk, so the simulator is what
 * makes this project runnable and verifiable. This module holds the minimal
 * behaviour: accept connections, answer the handshake, mirror keep-alives and
 * accept subscriptions. Fault injection and result generation arrive with the
 * later phases.
 *
 * @since 0.0.0
 */
import { NodeSocketServer } from "@effect/platform-node"
import { Deferred, Duration, Effect, Fiber, Match, pipe, Queue, Ref, Scope, Stream } from "effect"
import * as A from "effect/Array"
import * as MutableHashMap from "effect/MutableHashMap"
import * as O from "effect/Option"
import { frames } from "../src/protocol/Framer.ts"
import {
  CommandAccepted,
  CommandError,
  CommunicationStartAccepted,
  decodeMessage,
  encodeMessage,
  KeepAlive,
  LastResult,
  type Message,
  OldResult
} from "../src/protocol/Messages.ts"
import {
  ControllerTimestamp,
  DeviceId,
  TighteningId,
  TighteningResult
} from "../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, type ServerSide } from "../src/transport/InMemoryTransport.ts"
import { ConnectionLost, type Endpoint } from "../src/transport/Transport.ts"

const simulatorDevice = DeviceId.make("simulator")

/**
 * How a simulated controller should behave.
 *
 * @category models
 * @since 0.0.0
 */
export interface SimulatorOptions {
  readonly endpoint: Endpoint
  /** Controller identity reported in the handshake reply. */
  readonly cellId?: number | undefined
  readonly channelId?: number | undefined
  readonly controllerName?: string | undefined
  /** Rejects the handshake with this Open Protocol error code when set. */
  readonly rejectStartWith?: number | undefined
  /** Stops answering once the session is established: the socket stays open but goes quiet. */
  readonly silent?: boolean | undefined
  /** Produces a tightening result on this interval once a subscription exists. */
  readonly resultInterval?: Duration.Duration | undefined
  /** How long to wait for MID 0062 before resending a result. Defaults to 5 seconds. */
  readonly ackTimeout?: Duration.Duration | undefined
  /** Attempts before the controller gives up on a result and drops the session. */
  readonly ackAttempts?: number | undefined
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
  /** Results produced so far, acknowledged or not. */
  readonly generated: Effect.Effect<number>
  /** Results the controller gave up on: with Open Protocol semantics they are lost. */
  readonly abandoned: Effect.Effect<ReadonlyArray<TighteningId>>
  /** Produces one result immediately and returns it. */
  readonly produce: Effect.Effect<TighteningResult>
  /** Drops the current connection the way a controller does when it gives up. */
  readonly drop: Effect.Effect<void>
}

interface SessionState {
  readonly subscribed: boolean
  readonly keepAlives: number
  readonly nextId: number
  readonly generated: number
  readonly abandoned: ReadonlyArray<TighteningId>
  readonly connection: O.Option<ServerSide>
  readonly pendingAck: O.Option<Deferred.Deferred<void>>
}

const encoder = new TextEncoder()

const timestamp = ControllerTimestamp.make("2026-09-17:10:14:16")

const resultFor = (id: number): TighteningResult =>
  new TighteningResult({
    deviceId: simulatorDevice,
    tighteningId: TighteningId.make(id),
    vin: `VIN${id}`,
    parameterSetId: id % 1000,
    status: id % 10 === 0 ? "NOK" : "OK",
    torqueStatus: "OK",
    angleStatus: "OK",
    torque: (1000 + (id % 500)) / 100,
    angle: 90 + (id % 10),
    timestamp
  })

const replyTo = (
  message: Message,
  options: SimulatorOptions,
  store: MutableHashMap.MutableHashMap<number, TighteningResult>,
  latest: O.Option<number>
): O.Option<Message> =>
  Match.value(message).pipe(
    Match.tag("CommunicationStart", () =>
      O.some(
        O.match(O.fromNullishOr(options.rejectStartWith), {
          onNone: (): Message =>
            new CommunicationStartAccepted({
              cellId: options.cellId ?? 1,
              channelId: options.channelId ?? 1,
              controllerName: options.controllerName ?? "Simulator"
            }),
          onSome: (code): Message => new CommandError({ mid: 1, code })
        })
      )),
    Match.tag(
      "KeepAlive",
      (): O.Option<Message> => options.silent === true ? O.none() : O.some(new KeepAlive())
    ),
    Match.tag("SubscribeResults", (): O.Option<Message> => O.some(new CommandAccepted({ mid: 60 }))),
    Match.tag("UnsubscribeResults", (): O.Option<Message> => O.some(new CommandAccepted({ mid: 63 }))),
    Match.tag("CommunicationStop", (): O.Option<Message> => O.some(new CommandAccepted({ mid: 3 }))),
    Match.tag("RequestOldResult", (request): O.Option<Message> => {
      const wanted = request.tighteningId === 0 ? latest : O.some(request.tighteningId as number)
      return O.some(
        O.match(O.flatMap(wanted, (id) => MutableHashMap.get(store, id)), {
          onNone: (): Message => new CommandError({ mid: 64, code: 15 }),
          onSome: (result): Message => new OldResult({ result })
        })
      )
    }),
    Match.orElse((): O.Option<Message> => O.none())
  )

const observe = (message: Message, current: SessionState): SessionState =>
  Match.value(message).pipe(
    Match.tag("SubscribeResults", () => ({ ...current, subscribed: true })),
    Match.tag("UnsubscribeResults", () => ({ ...current, subscribed: false })),
    Match.tag("KeepAlive", () => ({ ...current, keepAlives: current.keepAlives + 1 })),
    Match.orElse(() => current)
  )

const serve = (
  connection: ServerSide,
  state: Ref.Ref<SessionState>,
  store: MutableHashMap.MutableHashMap<number, TighteningResult>,
  options: SimulatorOptions
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
                      onSome: (reply) => connection.send(encoder.encode(encodeMessage(reply)))
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
    Effect.andThen(Ref.update(state, (current) => ({ ...current, connection: O.none() })))
  )

const latestOf = (current: SessionState): O.Option<number> =>
  current.nextId <= 1 ? O.none() : O.some(current.nextId - 1)

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
  accept: Effect.Effect<Queue.Dequeue<ServerSide>, never, Scope.Scope>
) {
  const store = MutableHashMap.empty<number, TighteningResult>()
  const state = yield* Ref.make<SessionState>({
    subscribed: false,
    keepAlives: 0,
    nextId: 1,
    generated: 0,
    abandoned: [],
    connection: O.none(),
    pendingAck: O.none()
  })
  const ackTimeout = options.ackTimeout ?? Duration.seconds(5)
  const ackAttempts = options.ackAttempts ?? 3
  const accepted = yield* accept

  const acceptLoop = yield* pipe(
    Queue.take(accepted),
    Effect.flatMap((connection) => Effect.forkChild(serve(connection, state, store, options))),
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
                connection.send(encoder.encode(encodeMessage(new LastResult({ result })))),
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

  const produce = Effect.gen(function* () {
    const id = yield* Ref.modify(state, (current) => [current.nextId, {
      ...current,
      nextId: current.nextId + 1,
      generated: current.generated + 1
    }])
    const result = resultFor(id)
    MutableHashMap.set(store, id, result)
    yield* Effect.forkChild(push(result))
    return result
  })

  yield* O.match(O.fromNullishOr(options.resultInterval), {
    onNone: () => Effect.void,
    onSome: (interval) =>
      Effect.asVoid(
        Effect.forkChild(
          Effect.forever(Effect.andThen(Effect.sleep(interval), produce))
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
    isSubscribed: Effect.map(Ref.get(state), (current) => current.subscribed),
    keepAlives: Effect.map(Ref.get(state), (current) => current.keepAlives),
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
  return yield* makeWith(options, network.bind(options.endpoint))
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
  const server = yield* Effect.mapError(
    NodeSocketServer.make({ host: options.endpoint.host, port: options.endpoint.port }),
    (error) => new Error(`could not listen: ${error}`)
  )
  const queue = yield* Queue.bounded<ServerSide>(64)
  const openSockets = yield* Ref.make<ReadonlyArray<Deferred.Deferred<void>>>([])

  // Node keeps a listening server alive until its sockets are gone, so the
  // scope finalizer releases every accepted connection first.
  yield* Effect.addFinalizer(() =>
    pipe(
      Ref.getAndSet(openSockets, []),
      Effect.flatMap((pending) =>
        Effect.forEach(pending, (closed) => Deferred.succeed(closed, undefined), { discard: true })
      )
    )
  )

  yield* Effect.forkChild(
    server.run((socket) =>
      Effect.gen(function* () {
        const reader = yield* socket.reader
        const writer = yield* socket.writer
        const closed = yield* Deferred.make<void>()
        yield* Ref.update(openSockets, (current) => A.append(current, closed))
        const side: ServerSide = {
          incoming: pipe(
            Stream.fromPull(Effect.succeed(reader.pull)),
            Stream.map((chunk) => typeof chunk === "string" ? encoder.encode(chunk) : chunk),
            Stream.mapError((error) => new ConnectionLost({ reason: `${error}` }))
          ),
          send: (bytes) =>
            Effect.mapError(writer.write(bytes), (error) => new ConnectionLost({ reason: `${error}` })),
          close: () => Effect.asVoid(Deferred.succeed(closed, undefined))
        }
        yield* Queue.offer(queue, side)
        return yield* Deferred.await(closed)
      }).pipe(Effect.scoped, Effect.catchCause((cause) => Effect.logDebug("simulator socket ended", cause)))
    )
  )

  return yield* makeWith(options, Effect.succeed(queue))
})
