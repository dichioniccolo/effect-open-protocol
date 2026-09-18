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
import { Context, Effect, Fiber, Layer, Match, pipe, Ref, type Scope, SubscriptionRef } from "effect"
import * as O from "effect/Option"
import { AcknowledgeResult, CommunicationStop, type Message } from "../protocol/Messages.ts"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import { makeDedup } from "../results/Dedup.ts"
import { dropping, makeResultDelivery, type ResultDelivery } from "../results/ResultDelivery.ts"
import { ConnectionLost, Transport } from "../transport/Transport.ts"
import { CommandRejected, HandshakeRejected, NotReady, RequestTimeout } from "./ConnectionError.ts"
import {
  Accepted,
  AttemptStarted,
  CloseRequested,
  type ConnectionEvent,
  type ConnectionState,
  Failed,
  initial,
  isReady,
  Opened,
  Recovered,
  Released,
  Subscribed,
  transition
} from "./ConnectionState.ts"
import { type DeviceConfig, resolveSettings } from "./DeviceSettings.ts"
import { makeGapRecovery } from "./GapRecovery.ts"
import { startCommunication, subscribeResults } from "./Handshake.ts"
import { expectReply, makeRequestReply } from "./RequestReply.ts"
import { keepAliveLoop, readLoop, sendRaw, type Session } from "./Session.ts"

/**
 * A live connection as the rest of the library sees it.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceConnectionShape {
  readonly deviceId: DeviceId
  /** Current state, observable as a stream of changes. */
  readonly state: SubscriptionRef.SubscriptionRef<ConnectionState>
  /** Sends a message and waits for its reply; fails fast when not `Ready`. */
  readonly request: (
    message: Message,
    mid: number,
    direct?: Message["_tag"] | undefined
  ) => Effect.Effect<Message, NotReady | RequestTimeout | CommandRejected | ConnectionLost>
  /** Sends a message without expecting a reply. */
  readonly send: (message: Message) => Effect.Effect<void, NotReady | ConnectionLost>
  /** Stops the connection and returns once every resource is released. */
  readonly close: Effect.Effect<void>
  /** Results handed to the handler, duplicates excluded. */
  readonly delivered: Effect.Effect<number>
  /** Results recognised as resends of something already delivered. */
  readonly duplicates: Effect.Effect<number>
}

const reasonOf = (error: unknown): string =>
  error instanceof ConnectionLost
    ? error.reason
    : error instanceof HandshakeRejected
      ? `handshake rejected with code ${error.code}`
      : "connection attempt failed"

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
 * import { DeviceId, Endpoint, makeDeviceConnection } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const connection = yield* makeDeviceConnection({
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
export const makeDeviceConnection = Effect.fnUntraced(function* (config: DeviceConfig) {
  const settings = resolveSettings(config)
  const transport = yield* Transport
  const state = yield* SubscriptionRef.make(initial)
  const session = yield* Ref.make(O.none<Session>())
  const dedup = yield* makeDedup(settings.dedupCapacity)

  // No handler means nothing is listening: the connection still runs, but it
  // neither subscribes nor recovers, and every result that arrives is dropped.
  const collectsResults = settings.onResult !== undefined

  const delivery = yield* O.match(O.fromNullishOr(settings.onResult), {
    onNone: (): Effect.Effect<ResultDelivery, never, Scope.Scope> => Effect.succeed(dropping),
    onSome: (handler) =>
      makeResultDelivery({
        delivery: { handler, handlerRetry: settings.handlerRetry, bufferSize: settings.resultBuffer },
        dedup,
        acknowledge: (result) =>
          pipe(
            Ref.get(session),
            Effect.flatMap((open) =>
              O.match(open, {
                onNone: () => Effect.fail(new ConnectionLost({ reason: "no session to acknowledge on" })),
                onSome: (current) => sendRaw(current.duplex, new AcknowledgeResult())
              })
            ),
            Effect.tap(() =>
              Effect.logDebug("acknowledged a result").pipe(
                Effect.annotateLogs({ deviceId: settings.id, tighteningId: result.tighteningId })
              )
            )
          )
      })
  })

  const recovery = yield* makeGapRecovery({ settings, dedup })

  /**
   * Applies an event to the state machine. A transition the machine refuses is
   * a wiring bug and dies, except for the events that merely report something
   * that already happened to the socket: a session can fail while the
   * application is already closing, and the state machine is the one place
   * that decides whether that is worth recording.
   */
  const emitWith = (onRefused: (error: unknown) => Effect.Effect<void>) => (event: ConnectionEvent) =>
    pipe(
      SubscriptionRef.get(state),
      Effect.flatMap((current) =>
        pipe(
          transition(current, event),
          Effect.fromResult,
          Effect.flatMap((next) => SubscriptionRef.set(state, next)),
          Effect.catchTag("InvalidTransition", onRefused)
        )
      )
    )

  const emit = emitWith((error) => Effect.die(error))

  const emitIfLegal = emitWith(() => Effect.void)

  const routeUnsolicited = (current: Session, message: Message): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tag("LastResult", (carrier) => recovery.submitResult(current, delivery, carrier.result)),
      Match.tag("OldResult", (carrier) => delivery.submit(carrier.result)),
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
    const replies = yield* makeRequestReply({
      send: (message) =>
        pipe(
          sendRaw(duplex, message),
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
        yield* collectsResults ? recovery.recoverGap(current, delivery) : Effect.void

        yield* collectsResults ? subscribeResults(current) : Effect.void
        yield* emit(new Subscribed())

        yield* emit(new Recovered())
      }),
      readerFailed
    )

    const keepAlive = yield* Effect.forkChild(keepAliveLoop(current, lastSent, settings.keepAliveInterval))
    // Recovery is driven by events: a session starting, and a pushed result
    // whose identifier sits above the watermark. A caller who also wants the
    // line polled asks for it with `recoveryInterval`, and pays one MID 0064
    // per interval for the one case events miss: results lost while the
    // session stayed up, with no later tightening to reveal the gap.
    const reconcile = yield* Effect.forkChild(
      O.match(collectsResults ? O.fromNullishOr(settings.recoveryInterval) : O.none(), {
        onNone: (): Effect.Effect<never> => Effect.never,
        onSome: (interval) =>
          Effect.forever(Effect.andThen(Effect.sleep(interval), recovery.recoverGap(current, delivery)))
      })
    )
    return yield* pipe(
      readerFailed,
      Effect.raceFirst(Fiber.join(keepAlive)),
      Effect.onExit(() =>
        pipe(
          Fiber.interrupt(reconcile),
          Effect.andThen(Fiber.interrupt(keepAlive)),
          Effect.andThen(Fiber.interrupt(reader))
        )
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
  const sayGoodbye = pipe(
    Ref.get(session),
    Effect.flatMap((open) =>
      O.match(open, {
        onNone: () => Effect.void,
        onSome: (current) =>
          pipe(
            sendRaw(current.duplex, new CommunicationStop()),
            Effect.timeoutOption(settings.stopTimeout),
            Effect.asVoid
          )
      })
    ),
    Effect.ignore
  )

  const closeOnce = pipe(
    emit(new CloseRequested()),
    Effect.andThen(sayGoodbye),
    Effect.andThen(Fiber.interrupt(fiber)),
    Effect.andThen(emit(new Released()))
  )

  // Closing an already closed connection is a normal thing for an application
  // to do (a scope finalizer and an explicit close can both fire), so it is a
  // no-op rather than a defect.
  const close = pipe(
    SubscriptionRef.get(state),
    Effect.flatMap((current) => (current._tag === "Closed" || current._tag === "Closing" ? Effect.void : closeOnce))
  )

  yield* Effect.addFinalizer(() =>
    pipe(
      SubscriptionRef.get(state),
      Effect.flatMap((current) => (current._tag === "Closed" ? Effect.void : Effect.ignore(close)))
    )
  )

  return {
    deviceId: settings.id,
    state,
    request: (message, mid, direct) =>
      withSession((current) => current.replies.request(message, mid, expectReply(mid, direct))),
    send: (message) => withSession((current) => sendRaw(current.duplex, message)),
    close,
    delivered: delivery.delivered,
    duplicates: delivery.duplicates
  } satisfies DeviceConnectionShape
})

/**
 * One controller, as a service.
 *
 * A pool holds many connections, so `makeDeviceConnection` stays the way to
 * build them: a service has one instance per context. This class is for the
 * other case, an application that talks to a single controller and wants it
 * wired like any other dependency.
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
 *   const connection = yield* DeviceConnection
 *   return yield* connection.state
 * }).pipe(Effect.provide(layer), Effect.provide(TcpTransport.layer))
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class DeviceConnection extends Context.Service<DeviceConnection, DeviceConnectionShape>()(
  "effect-open-protocol/DeviceConnection"
) {
  /**
   * Provides one supervised connection for the lifetime of the layer, closing
   * it gracefully when the layer goes away.
   *
   * @since 0.0.0
   */
  static readonly layer = (config: DeviceConfig): Layer.Layer<DeviceConnection, never, Transport> =>
    Layer.effect(DeviceConnection)(makeDeviceConnection(config))
}
