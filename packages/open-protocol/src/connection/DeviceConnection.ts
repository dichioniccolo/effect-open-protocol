/**
 * A supervised connection to one controller.
 *
 * The connection owns the lifecycle the application should not have to think
 * about: opening the socket, the communication start handshake, restoring the
 * subscription, keep-alives, detecting a silent socket, backing off and
 * reconnecting, and failing in-flight requests when the session dies. Every
 * attempt runs in its own `Scope`, so a lost connection releases its socket
 * and fibers before the next attempt begins.
 *
 * The parts that are policies of their own live next door: the defaults in
 * `DeviceSettings`, the live session and its loops in `Session`, the opening
 * exchange in `Handshake`, and the result gap policy in `GapRecovery`.
 *
 * @since 0.0.0
 */
import { Effect, Fiber, Layer, Match, pipe, Ref, SubscriptionRef } from "effect"
import * as Context from "effect/Context"
import * as O from "effect/Option"
import { AcknowledgeResultMid, CommunicationStopMid, type Message } from "../protocol/Messages.ts"
import type * as Mid from "../protocol/Mid.ts"
import type { PayloadEncodeError } from "../protocol/ProtocolError.ts"
import type { DeviceId, TighteningResult } from "../protocol/TighteningResult.ts"
import * as Dedup from "../results/Dedup.ts"
import * as ResultDelivery from "../results/ResultDelivery.ts"
import { type ConnectionFailed, ConnectionLost, Transport } from "../transport/Transport.ts"
import { HandshakeRejected, NotReady } from "./ConnectionError.ts"
import {
  Accepted,
  AttemptStarted,
  CloseRequested,
  type ConnectionEvent,
  type ConnectionState,
  Failed,
  initial,
  type InvalidTransition,
  isClosedOrClosing,
  isReady,
  Opened,
  Recovered,
  Released,
  Subscribed,
  transition
} from "./ConnectionState.ts"
import { type DeviceConfig, type DeviceSettings, resolveSettings } from "./DeviceSettings.ts"
import * as GapRecovery from "./GapRecovery.ts"
import { startCommunication, subscribeResults } from "./Handshake.ts"
import * as RequestReply from "./RequestReply.ts"
import { keepAliveLoop, readLoop, sendFrame, sendPayload, type Session } from "./Session.ts"

/**
 * A live connection as the rest of the library sees it.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceConnectionService {
  readonly deviceId: DeviceId
  /** Current state, observable as a stream of changes. */
  readonly state: SubscriptionRef.SubscriptionRef<ConnectionState>
  /** Sends a message and waits for its reply; fails fast when not `Ready`. */
  readonly request: <Rev extends Mid.AnyRequestRevision, A>(
    revision: RequestReply.Expecting<Rev, A>,
    payload: Mid.Payload<Rev>
  ) => Effect.Effect<A, NotReady | RequestReply.RequestError>
  /** Sends a value of a revision without waiting for anything; fails fast when not `Ready`. */
  readonly send: <Rev extends Mid.AnyRevision>(
    revision: Rev,
    payload: Mid.Payload<Rev>
  ) => Effect.Effect<void, NotReady | ConnectionLost | PayloadEncodeError>
  /** Stops the connection and returns once every resource is released. */
  readonly close: Effect.Effect<void>
  /** Results handed to the handler, duplicates excluded. */
  readonly delivered: Effect.Effect<number>
  /** Results recognised as resends of something already delivered. */
  readonly duplicates: Effect.Effect<number>
}

/**
 * What a connection does with the results a controller produces, decided once
 * from whether an `onResult` handler was configured.
 */
interface Results {
  readonly delivery: ResultDelivery.ResultDelivery
  /** Takes a pushed result, which may reveal a gap. */
  readonly pushed: (session: Session, result: TighteningResult) => Effect.Effect<void>
  /** Fetches what the controller produced while no session was listening. */
  readonly recover: (session: Session) => Effect.Effect<void>
  /** Asks the controller to push its results on this session. */
  readonly subscribe: (session: Session) => Effect.Effect<void, ConnectionLost>
  /** Background work that lasts as long as the session. */
  readonly reconcile: (session: Session) => Effect.Effect<never>
}

/**
 * No handler means nothing is listening: the connection still runs, but it
 * neither subscribes nor recovers, and every result that arrives is dropped.
 */
const ignoring: Results = {
  delivery: ResultDelivery.dropping,
  pushed: (_, result) => ResultDelivery.dropping.submit(result),
  recover: () => Effect.void,
  subscribe: () => Effect.void,
  reconcile: () => Effect.never
}

/** One dedup window, one delivery queue and one gap policy, all for this device only. */
const collecting = Effect.fnUntraced(function* (options: {
  readonly settings: DeviceSettings
  readonly handler: ResultDelivery.ResultHandler
  readonly acknowledge: (result: TighteningResult) => Effect.Effect<void, ConnectionLost>
}) {
  const { settings } = options
  const dedup = yield* Dedup.make(settings.dedupCapacity)

  const delivery = yield* ResultDelivery.make({
    handler: options.handler,
    handlerRetry: settings.handlerRetry,
    bufferSize: settings.resultBuffer,
    dedup,
    acknowledge: options.acknowledge
  })

  const recovery = yield* GapRecovery.make({ settings, dedup, pipeline: delivery })

  return {
    delivery,
    pushed: recovery.submitResult,
    recover: recovery.recoverGap,
    subscribe: subscribeResults,
    // Recovery is driven by events: a session starting, and a pushed result
    // whose identifier sits above the watermark. A caller who also wants the
    // line polled asks for it with `recoveryInterval`, and pays one MID 0064
    // per interval for the one case events miss: results lost while the
    // session stayed up, with no later tightening to reveal the gap.
    reconcile: (session) =>
      O.match(O.fromNullishOr(settings.recoveryInterval), {
        onNone: (): Effect.Effect<never> => Effect.never,
        onSome: (interval) => Effect.forever(Effect.andThen(Effect.sleep(interval), recovery.recoverGap(session)))
      })
  } satisfies Results
})

const reasonOf = (error: ConnectionFailed | ConnectionLost | HandshakeRejected): string =>
  Match.valueTags(error, {
    ConnectionLost: (lost) => lost.reason,
    HandshakeRejected: (rejected) => `handshake rejected with code ${rejected.code}`,
    ConnectionFailed: () => "connection attempt failed"
  })

/**
 * Opens a supervised connection that reconnects until it is closed.
 *
 * The returned connection belongs to the calling `Scope`: closing that scope
 * (or calling `close`) interrupts the supervisor and releases the socket.
 *
 * **Example** (Watching a device come up)
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { DeviceConnection, DeviceId, Endpoint } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const connection = yield* DeviceConnection.make({
 *     id: DeviceId.make("line-1-tool-3"),
 *     endpoint: new Endpoint({ host: "10.0.0.31", port: 4545 })
 *   })
 *   return yield* Stream.runHead(connection.state.changes)
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (config: DeviceConfig) {
  const settings = resolveSettings(config)
  const transport = yield* Transport
  const state = yield* SubscriptionRef.make(initial)
  const session = yield* Ref.make(O.none<Session>())

  const acknowledge = Effect.fnUntraced(function* (result: TighteningResult) {
    const open = yield* Ref.get(session)

    if (O.isNone(open)) {
      return yield* Effect.fail(new ConnectionLost({ reason: "no session to acknowledge on" }))
    }

    // An empty payload always fits: failing to encode it would be a bug here.
    yield* Effect.catchTag(
      sendPayload(open.value.duplex, AcknowledgeResultMid.rev(1), {}),
      "PayloadEncodeError",
      Effect.die
    )
    yield* Effect.logDebug("acknowledged a result").pipe(
      Effect.annotateLogs({ deviceId: settings.id, tighteningId: result.tighteningId })
    )
  })

  const results = yield* O.match(O.fromNullishOr(settings.onResult), {
    onNone: () => Effect.succeed(ignoring),
    onSome: (handler) => collecting({ settings, handler, acknowledge })
  })

  /**
   * Applies an event to the state machine. A transition the machine refuses is
   * a wiring bug and dies, except for the events that merely report something
   * that already happened to the socket: a session can fail while the
   * application is already closing, and the state machine is the one place
   * that decides whether that is worth recording.
   */
  const emitWith = (onRefused: (error: InvalidTransition) => Effect.Effect<void>) =>
    Effect.fnUntraced(function* (event: ConnectionEvent) {
      const current = yield* SubscriptionRef.get(state)

      yield* Effect.fromResult(transition(current, event)).pipe(
        Effect.flatMap((next) => SubscriptionRef.set(state, next)),
        Effect.catchTag("InvalidTransition", onRefused)
      )
    })

  const emit = emitWith((error) => Effect.die(error))

  const emitIfLegal = emitWith(() => Effect.void)

  const routeUnsolicited = (current: Session, message: Message): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tag("LastResult", (carrier) => results.pushed(current, carrier.result)),
      Match.tag("OldResult", (carrier) => results.delivery.submit(carrier.result)),
      Match.orElse((other) =>
        Effect.logWarning("unsolicited message dropped").pipe(
          Effect.annotateLogs({ deviceId: settings.id, message: other._tag })
        )
      )
    )

  const attempt = Effect.gen(function* () {
    yield* emit(new AttemptStarted())

    const duplex = yield* transport
      .connect(settings.endpoint)
      .pipe(Effect.tapError((error) => emit(new Failed({ reason: error.reason }))))

    yield* emit(new Opened())
    const lastSent = yield* Ref.make(0)

    const replies = yield* RequestReply.make({
      deviceId: settings.id,
      send: (frame) =>
        pipe(
          sendFrame(duplex, frame),
          Effect.tap(() =>
            Effect.clockWith((clock) => clock.currentTimeMillis).pipe(Effect.flatMap((now) => Ref.set(lastSent, now)))
          )
        ),
      responseTimeout: settings.responseTimeout
    })

    const current: Session = { duplex, replies }
    yield* Ref.set(session, O.some(current))
    yield* Effect.addFinalizer(() =>
      pipe(
        // Whatever ended the session, nobody is left waiting on a reply that
        // can no longer arrive.
        replies.interruptAll(new ConnectionLost({ reason: "the session ended" })),
        Effect.andThen(Ref.set(session, O.none()))
      )
    )

    const reader = yield* Effect.forkChild(
      readLoop(current, settings.id, (message) => routeUnsolicited(current, message))
    )

    // A socket that dies during the handshake, the subscription or recovery
    // must fail the attempt immediately instead of waiting for a timeout.
    const readerFailed = Effect.flatMap(Fiber.join(reader), () =>
      Effect.fail(new ConnectionLost({ reason: "the controller closed the connection" }))
    )

    yield* Effect.raceFirst(
      Effect.gen(function* () {
        const controllerName = yield* startCommunication(current)
        yield* emit(new Accepted({ controllerName }))

        // Recovery runs before the subscription: a result produced between the
        // two would otherwise be treated as history by the first baseline.
        yield* results.recover(current)
        yield* emit(new Recovered())

        yield* results.subscribe(current)
        yield* emit(new Subscribed())
      }),
      readerFailed
    )

    const keepAlive = yield* Effect.forkChild(keepAliveLoop(current, lastSent, settings.keepAliveInterval))
    const reconcile = yield* Effect.forkChild(results.reconcile(current))

    return yield* readerFailed.pipe(
      Effect.raceFirst(Fiber.join(keepAlive)),
      Effect.onExit(
        Effect.fnUntraced(function* () {
          yield* Fiber.interrupt(reconcile)
          yield* Fiber.interrupt(keepAlive)
          yield* Fiber.interrupt(reader)
        })
      )
    )
  }).pipe(Effect.scoped)

  const supervisor = pipe(
    attempt,
    Effect.tapError((error) => emitIfLegal(new Failed({ reason: reasonOf(error) }))),
    Effect.retry(settings.reconnect),
    Effect.catchCause((cause) => Effect.logError("device connection stopped", cause)),
    Effect.forever
  )

  const fiber = yield* Effect.forkChild(supervisor)

  const withSession = <A, E>(use: (current: Session) => Effect.Effect<A, E>): Effect.Effect<A, E | NotReady> =>
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state)
      const open = yield* Ref.get(session)

      const found = yield* O.match(open, {
        onNone: (): Effect.Effect<Session, NotReady> => Effect.fail(new NotReady({ state: current._tag })),
        onSome: (value): Effect.Effect<Session, NotReady> =>
          isReady(current) ? Effect.succeed(value) : Effect.fail(new NotReady({ state: current._tag }))
      })

      return yield* use(found)
    })

  /**
   * Tells the controller we are leaving, so it can release the client slot
   * instead of waiting for its own 15 second idle timeout. Best effort: the
   * socket may already be gone, and shutdown must not block on it.
   */
  const sayGoodbye = Effect.gen(function* () {
    const open = yield* Ref.get(session)

    if (O.isNone(open)) {
      return
    }

    yield* sendPayload(open.value.duplex, CommunicationStopMid.rev(1), {}).pipe(
      Effect.timeoutOption(settings.stopTimeout)
    )
  }).pipe(Effect.ignore)

  const closeOnce = Effect.gen(function* () {
    yield* emit(new CloseRequested())
    yield* sayGoodbye
    yield* Fiber.interrupt(fiber)
    yield* emit(new Released())
  })

  // Closing an already closed connection is a normal thing for an application
  // to do (a scope finalizer and an explicit close can both fire), so it is a
  // no-op rather than a defect.
  const close = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(state)

    if (!isClosedOrClosing(current)) {
      yield* closeOnce
    }
  })

  yield* Effect.addFinalizer(() => Effect.ignore(close))

  return {
    deviceId: settings.id,
    state,
    request: (revision, payload) => withSession((current) => current.replies.request(revision, payload)),
    send: (revision, payload) => withSession((current) => sendPayload(current.duplex, revision, payload)),
    close,
    delivered: results.delivery.delivered,
    duplicates: results.delivery.duplicates
  } satisfies DeviceConnectionService
})

/**
 * One controller, as a service.
 *
 * A pool holds many connections, so `make` stays the way to build them: a
 * service has one instance per context. This class is for the other case, an
 * application that talks to a single controller and wants it wired like any
 * other dependency.
 *
 * **Example** (A single controller as a dependency)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { DeviceConnection, DeviceId, Endpoint, TcpTransport } from "effect-open-protocol"
 *
 * const layer = DeviceConnection.layer({
 *   id: DeviceId.make("line-1-tool-3"),
 *   endpoint: new Endpoint({ host: "10.0.0.31", port: 4545 })
 * })
 *
 * const program = Effect.gen(function* () {
 *   const connection = yield* DeviceConnection.DeviceConnection
 *   return yield* connection.state
 * }).pipe(Effect.provide(layer), Effect.provide(TcpTransport.layer))
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class DeviceConnection extends Context.Service<DeviceConnection, DeviceConnectionService>()(
  "effect-open-protocol/DeviceConnection"
) {}

/**
 * Provides one supervised connection for the lifetime of the layer, closing it
 * gracefully when the layer goes away.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer = (config: DeviceConfig): Layer.Layer<DeviceConnection, never, Transport> =>
  Layer.effect(DeviceConnection)(make(config))
