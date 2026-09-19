/**
 * A supervised connection to one controller.
 *
 * The connection owns the lifecycle the application should not have to think
 * about: opening the socket, the communication start handshake, restoring the
 * subscriptions, keep-alives, detecting a silent socket, backing off and
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
import { Duration, Effect, Fiber, Layer, Match, pipe, Ref, Schedule, Scope, Stream, SubscriptionRef } from "effect"
import * as Context from "effect/Context"
import * as O from "effect/Option"
import { CommunicationStopMid, LastResults, type Message } from "../protocol/Messages.ts"
import type * as Mid from "../protocol/Mid.ts"
import type { PayloadEncodeError } from "../protocol/ProtocolError.ts"
import { type DeviceId, resultOf } from "../protocol/TighteningResult.ts"
import * as Dedup from "../results/Dedup.ts"
import * as ResultDelivery from "../results/ResultDelivery.ts"
import { ConnectionFailed, ConnectionLost, Transport } from "../transport/Transport.ts"
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
  isStreakStart,
  Opened,
  Recovered,
  Released,
  Subscribed,
  transition
} from "./ConnectionState.ts"
import { type DeviceConfig, type DeviceSettings, resolveSettings } from "./DeviceSettings.ts"
import * as GapRecovery from "./GapRecovery.ts"
import { startCommunication } from "./Handshake.ts"
import * as RequestReply from "./RequestReply.ts"
import { keepAliveLoop, readLoop, sendFrame, sendPayload, type Session } from "./Session.ts"
import * as Subscriptions from "./Subscriptions.ts"
import type { Pushed, SubscribeError } from "./Subscriptions.ts"

/**
 * @since 0.0.0
 */
export type { Pushed, SubscribeError } from "./Subscriptions.ts"

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
  /**
   * The values the controller pushes for a subscription, each with the `ack`
   * to run once it is handled. Subscribed again after every reconnect; the
   * stream ends when the consumer stops (which unsubscribes) or the connection
   * closes, and fails when the controller refuses it, now or after a
   * reconnect.
   */
  readonly subscribe: <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>
  ) => Stream.Stream<Pushed<Mid.Type<Data>>, SubscribeError>
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
  /** Fetches what the controller produced while no session was listening. */
  readonly recover: (session: Session) => Effect.Effect<void>
  /** Background work that lasts as long as the session, failing when the session must go. */
  readonly during: (session: Session) => Effect.Effect<never, ConnectionLost>
}

/**
 * No handler means nothing is listening: the connection still runs, but it
 * neither subscribes nor recovers, and every result that arrives is dropped.
 */
const ignoring: Results = {
  delivery: ResultDelivery.dropping,
  recover: () => Effect.void,
  during: () => Effect.never
}

/**
 * One dedup window, one delivery queue and one gap policy, all for this device
 * only, fed by the `LastResults` subscription for as long as the connection
 * lives.
 */
const collecting = Effect.fnUntraced(function* (options: {
  readonly settings: DeviceSettings
  readonly handler: ResultDelivery.ResultHandler
  readonly subscriptions: Subscriptions.Subscriptions
}) {
  const { settings } = options
  const dedup = yield* Dedup.make(settings.dedupCapacity)

  // Held by the connection's scope, so it lasts as long as the connection.
  // Nothing else holds MID 0061 when this runs, and the delivery queue does
  // the buffering, so one pushed result waits here at most.
  const scope = yield* Effect.scope
  const subscribe = Effect.orDie(Scope.provide(options.subscriptions.open(LastResults.rev(1), 1), scope))

  // Registered before the first attempt, so the first handshake subscribes.
  const subscription = yield* Ref.make(O.some(yield* subscribe))

  const delivery = yield* ResultDelivery.make({
    handler: options.handler,
    handlerRetry: settings.handlerRetry,
    bufferSize: settings.resultBuffer,
    dedup
  })

  const recovery = yield* GapRecovery.make({ settings, dedup, pipeline: delivery })

  // Consumed by one session at a time, so a gap a pushed result reveals is
  // recovered on that session and stops with it. A connection that cannot
  // subscribe to its results is no use to its handler: a refusal costs the
  // session, as a refused MID 0060 always has, and the next one subscribes
  // again.
  const pushed = (session: Session): Effect.Effect<never, ConnectionLost> =>
    Effect.gen(function* () {
      const current = yield* O.match(yield* Ref.get(subscription), {
        // Registering and remembering are one step: interrupted between the
        // two, the registry would hold a subscription nobody consumes, and
        // every later attempt would fail with `AlreadySubscribed`.
        onNone: () => Effect.uninterruptible(Effect.tap(subscribe, (again) => Ref.set(subscription, O.some(again)))),
        onSome: Effect.succeed
      })

      yield* Stream.runForEach(current.values, (next) =>
        recovery.submitPushed(session, { ...next, value: resultOf(settings.id, next.value) })
      )

      // The stream ends only with the connection.
      return yield* Effect.never
    }).pipe(
      Effect.catchTag("CommandRejected", (rejected) =>
        Effect.andThen(
          Ref.set(subscription, O.none()),
          Effect.fail(new ConnectionLost({ reason: `results subscription refused with code ${rejected.code}` }))
        )
      )
    )

  // Recovery is driven by events: a session starting, the subscription
  // coming up, and a pushed result whose identifier sits above the
  // watermark. The pass after subscribing catches what the controller
  // produced during the handshake's own recovery, which it never pushes, and
  // whatever that pass left pending; after it, anything a pass had to leave
  // for later is retried until it is fetched. A caller who also wants the line polled
  // asks for it with `recoveryInterval`, and pays one MID 0064 per interval
  // for the one case events miss: results lost while the session stayed up,
  // with no later tightening to reveal the gap.
  const reconcile = (session: Session): Effect.Effect<never> =>
    Effect.andThen(
      recovery.recoverGap(session),
      Effect.raceFirst(
        recovery.keepUp(session),
        O.match(O.fromNullishOr(settings.recoveryInterval), {
          onNone: () => Effect.never,
          onSome: (interval) => Effect.forever(Effect.andThen(Effect.sleep(interval), recovery.recoverGap(session)))
        })
      )
    )

  return {
    delivery,
    recover: recovery.recoverGap,
    during: (session) => Effect.raceFirst(pushed(session), reconcile(session))
  } satisfies Results
})

/**
 * Runs `schedule`, and starts it over when `restart` is true at a failure.
 * `Effect.retry` keeps a schedule's state for as long as the retried effect
 * keeps failing. A session always ends by failing, so without this the
 * backoff an early outage used up would stay spent after hours of healthy
 * session. The supervisor records each failure in the state before the
 * schedule steps, so `restart` can read it there.
 */
const restartingWhen = <Input>(
  schedule: Schedule.Schedule<unknown, Input>,
  restart: Effect.Effect<boolean>
): Schedule.Schedule<unknown, Input> =>
  Schedule.fromStep(
    Effect.map(Effect.flatMap(Schedule.toStep(schedule), Ref.make), (current) =>
      Effect.fnUntraced(function* (now: number, input: Input) {
        if (yield* restart) {
          yield* Ref.set(current, yield* Schedule.toStep(schedule))
        }

        const step = yield* Ref.get(current)

        return yield* step(now, input)
      })
    )
  )

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
 * import { Effect, Stream, SubscriptionRef } from "effect"
 * import { DeviceConnection, DeviceId, Endpoint } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const connection = yield* DeviceConnection.make({
 *     id: DeviceId.make("line-1-tool-3"),
 *     endpoint: new Endpoint({ host: "10.0.0.31", port: 4545 })
 *   })
 *   return yield* Stream.runHead(SubscriptionRef.changes(connection.state))
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

  const noSession = new ConnectionLost({ reason: "no session is open" })

  /** The session that is open, handshake included, or `missing` when there is none. */
  const openSession = <E>(missing: E): Effect.Effect<Session, E> =>
    Effect.flatMap(
      Ref.get(session),
      O.match({ onNone: () => Effect.fail(missing), onSome: (open) => Effect.succeed(open) })
    )

  const subscriptions = yield* Subscriptions.make({
    deviceId: settings.id,
    // Acknowledgements go out on whatever session is open. A control MID
    // carries no field (its definition checks it), so failing to encode it
    // would be a bug here.
    send: (revision) =>
      Effect.flatMap(openSession(noSession), (open) =>
        Effect.catchTag(sendPayload(open.duplex, revision, {}), "PayloadEncodeError", Effect.die)
      )
  })

  const results = yield* O.match(O.fromNullishOr(settings.onResult), {
    onNone: () => Effect.succeed(ignoring),
    onSome: (handler) => collecting({ settings, handler, subscriptions })
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

  const routeUnsolicited = (message: Message): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tag("OldResult", (stored) => results.delivery.submitRecovered(resultOf(settings.id, stored))),
      Match.orElse((other) =>
        Effect.logWarning("unsolicited message dropped").pipe(
          Effect.annotateLogs({ deviceId: settings.id, message: other._tag })
        )
      )
    )

  const attempt = Effect.gen(function* () {
    yield* emit(new AttemptStarted())

    // An unreachable host does not refuse the connection, it stays silent.
    // Without a bound the attempt waits for the operating system to give up,
    // minutes on Linux, instead of retrying on the backoff schedule.
    const timedOut = new ConnectionFailed({
      endpoint: settings.endpoint,
      reason: `no connection within ${Duration.format(settings.connectTimeout)}`
    })

    const duplex = yield* Effect.tapError(
      Effect.timeoutOrElse(transport.connect(settings.endpoint), {
        duration: settings.connectTimeout,
        orElse: () => Effect.fail(timedOut)
      }),
      (error) => emit(new Failed({ reason: error.reason }))
    )

    yield* emit(new Opened())
    const lastSent = yield* Ref.make(0)

    const replies = yield* RequestReply.make({
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
        Effect.andThen(subscriptions.detach),
        Effect.andThen(Ref.set(session, O.none()))
      )
    )

    const reader = yield* Effect.forkChild(
      readLoop(current, { subscribed: subscriptions.offer, unsolicited: routeUnsolicited })
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

        yield* subscriptions.restore(current)
        yield* emit(new Subscribed())
      }),
      readerFailed
    )

    const keepAlive = yield* Effect.forkChild(keepAliveLoop(current, lastSent, settings.keepAliveInterval))
    const during = yield* Effect.forkChild(results.during(current))

    return yield* readerFailed.pipe(
      Effect.raceFirst(Fiber.join(keepAlive)),
      Effect.raceFirst(Fiber.join(during)),
      Effect.onExit(
        Effect.fnUntraced(function* () {
          yield* Fiber.interrupt(during)
          yield* Fiber.interrupt(keepAlive)
          yield* Fiber.interrupt(reader)
        })
      )
    )
  }).pipe(Effect.scoped)

  const supervisor = pipe(
    attempt,
    // A defect is a bug, but restarting at once would repeat it in a tight
    // loop from a state that no longer allows a new attempt. It is logged and
    // then handled like a lost session: recorded, and backed off.
    Effect.catchDefect((defect) =>
      Effect.andThen(
        Effect.logError("device connection defect", defect),
        Effect.fail(new ConnectionLost({ reason: `defect: ${defect}` }))
      )
    ),
    Effect.tapError((error) => emitIfLegal(new Failed({ reason: reasonOf(error) }))),
    Effect.retry(restartingWhen(settings.reconnect, Effect.map(SubscriptionRef.get(state), isStreakStart))),
    Effect.catchCause((cause) => Effect.logError("device connection stopped", cause)),
    Effect.forever
  )

  const fiber = yield* Effect.forkChild(supervisor)

  const withSession = <A, E>(use: (current: Session) => Effect.Effect<A, E>): Effect.Effect<A, E | NotReady> =>
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state)
      const notReady = new NotReady({ state: current._tag })

      if (!isReady(current)) {
        return yield* notReady
      }

      return yield* use(yield* openSession(notReady))
    })

  /**
   * Tells the controller we are leaving, so it can release the client slot
   * instead of waiting for its own 15 second idle timeout. Best effort: the
   * socket may already be gone, and shutdown must not block on it.
   */
  const sayGoodbye = Effect.flatMap(openSession(noSession), (open) =>
    sendPayload(open.duplex, CommunicationStopMid.rev(1), {}).pipe(Effect.timeoutOption(settings.stopTimeout))
  ).pipe(Effect.ignore)

  const closeOnce = Effect.gen(function* () {
    yield* emit(new CloseRequested())
    yield* sayGoodbye
    yield* Fiber.interrupt(fiber)
    yield* subscriptions.close
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
    subscribe: (subscription) =>
      Stream.unwrap(
        Effect.map(subscriptions.open(subscription, settings.subscriptionBuffer), (opened) => opened.values)
      ),
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
 * import { Effect, SubscriptionRef } from "effect"
 * import { DeviceConnection, DeviceId, Endpoint, TcpTransport } from "effect-open-protocol"
 *
 * const layer = DeviceConnection.layer({
 *   id: DeviceId.make("line-1-tool-3"),
 *   endpoint: new Endpoint({ host: "10.0.0.31", port: 4545 })
 * })
 *
 * const program = Effect.gen(function* () {
 *   const connection = yield* DeviceConnection.DeviceConnection
 *   return yield* SubscriptionRef.get(connection.state)
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
