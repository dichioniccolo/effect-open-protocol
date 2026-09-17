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
 * @since 0.0.0
 */
import { Duration, Effect, Fiber, Match, pipe, Ref, Schedule, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { frames } from "../protocol/Framer.ts"
import {
  AcknowledgeResult,
  CommunicationStart,
  CommunicationStop,
  decodeMessage,
  encodeMessage,
  KeepAlive,
  type Message,
  SubscribeResults
} from "../protocol/Messages.ts"
import type { DeviceId, TighteningResult } from "../protocol/TighteningResult.ts"
import { make as makeDedup } from "../results/Dedup.ts"
import { make as makeDelivery, type ResultDelivery, type ResultHandler } from "../results/ResultDelivery.ts"
import { run as runRecovery } from "../results/ResultRecovery.ts"
import { ConnectionLost, type Duplex, type Endpoint, Transport } from "../transport/Transport.ts"
import { ConnectionClosed, HandshakeRejected, NotReady } from "./ConnectionError.ts"
import {
  Accepted,
  CloseRequested,
  Connect,
  type ConnectionEvent,
  type ConnectionState,
  Failed,
  initial,
  isReady,
  Opened,
  Recovered,
  Released,
  RetryDue,
  Subscribed,
  transition
} from "./ConnectionState.ts"
import { expectReply, make as makeRequestReply, type RequestReply } from "./RequestReply.ts"

/**
 * How one device should be connected and kept alive.
 *
 * Defaults follow the Open Protocol specification: the controller drops a
 * connection after 15 seconds without traffic, so a keep-alive goes out after
 * 10 seconds of silence.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceConfig {
  readonly id: DeviceId
  readonly endpoint: Endpoint
  /** Backoff between connection attempts. Defaults to jittered exponential, capped at 30 seconds. */
  readonly reconnect?: Schedule.Schedule<unknown> | undefined
  /** Idle time before a keep-alive is sent. Defaults to 10 seconds. */
  readonly keepAliveInterval?: Duration.Duration | undefined
  /** How long to wait for a reply before declaring the session dead. Defaults to 5 seconds. */
  readonly responseTimeout?: Duration.Duration | undefined
  /** Called for every result the controller pushes. Subscribing is skipped when absent. */
  readonly onResult?: ResultHandler | undefined
  /** Retries applied to a failing handler before the acknowledgement is skipped. */
  readonly handlerRetry?: Schedule.Schedule<unknown> | undefined
  /** How many results may wait for a slow handler. Defaults to 16. */
  readonly resultBuffer?: number | undefined
  /** How many identifiers the duplicate detector remembers. Defaults to 1000. */
  readonly dedupCapacity?: number | undefined
  /** Upper bound on results fetched after an outage. Defaults to 100. */
  readonly recoveryLimit?: number | undefined
}

/**
 * A live connection as the rest of the library sees it.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceConnection {
  readonly deviceId: DeviceId
  /** Current state, observable as a stream of changes. */
  readonly state: SubscriptionRef.SubscriptionRef<ConnectionState>
  /** Sends a message and waits for its reply; fails fast when not `Ready`. */
  readonly request: (
    message: Message,
    mid: number,
    direct?: Message["_tag"] | undefined
  ) => Effect.Effect<Message, NotReady | ConnectionClosed | ConnectionLost | Error>
  /** Sends a message without expecting a reply. */
  readonly send: (message: Message) => Effect.Effect<void, NotReady | ConnectionLost>
  /** Stops the connection and returns once every resource is released. */
  readonly close: Effect.Effect<void>
  /** Results handed to the handler, duplicates excluded. */
  readonly delivered: Effect.Effect<number>
  /** Results recognised as resends of something already delivered. */
  readonly duplicates: Effect.Effect<number>
}

const defaultReconnect: Schedule.Schedule<Duration.Duration> = pipe(
  Schedule.exponential("500 millis"),
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(30)))),
  Schedule.jittered
)

const encoder = new TextEncoder()

interface Session {
  readonly duplex: Duplex
  readonly replies: RequestReply
}

const protocolLost = (tag: string): Effect.Effect<never, ConnectionLost> =>
  Effect.fail(new ConnectionLost({ reason: `protocol error: ${tag}` }))

const sendRaw = (duplex: Duplex, message: Message): Effect.Effect<void, ConnectionLost> =>
  duplex.send(encoder.encode(encodeMessage(message)))

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
 * import { DeviceId, Endpoint, make } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const connection = yield* make({
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
  const transport = yield* Transport
  const state = yield* SubscriptionRef.make(initial)
  const session = yield* Ref.make(O.none<Session>())
  const keepAliveInterval = config.keepAliveInterval ?? Duration.seconds(10)
  const responseTimeout = config.responseTimeout ?? Duration.seconds(5)
  const reconnect = config.reconnect ?? defaultReconnect
  const dedup = yield* makeDedup(config.dedupCapacity)
  const delivery = yield* O.match(O.fromNullishOr(config.onResult), {
    onNone: () => Effect.succeed(O.none<ResultDelivery>()),
    onSome: (handler) =>
      Effect.map(
        makeDelivery({
          delivery: { handler, handlerRetry: config.handlerRetry, bufferSize: config.resultBuffer },
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
                  Effect.annotateLogs({ deviceId: config.id, tighteningId: result.tighteningId })
                )
              )
            )
        }),
        O.some
      )
  })

  const emit = (event: ConnectionEvent): Effect.Effect<void> =>
    pipe(
      SubscriptionRef.get(state),
      Effect.flatMap((current) =>
        pipe(
          transition(current, event),
          Effect.fromResult,
          Effect.flatMap((next) => SubscriptionRef.set(state, next)),
          Effect.catchTag("InvalidTransition", (error) => Effect.die(error))
        )
      )
    )

  const recovering = yield* Ref.make(false)

  /**
   * Fetches whatever sits between the last contiguously delivered result and
   * the newest one the controller holds. Runs at session start and whenever a
   * pushed result reveals a gap, which is how the specification suggests an
   * integrator notices missing results.
   */
  const recoverGap = (current: Session, pipeline: ResultDelivery): Effect.Effect<void> =>
    Effect.uninterruptibleMask(() =>
      Ref.getAndSet(recovering, true).pipe(
        Effect.flatMap((busy) =>
          busy ? Effect.void : pipe(
            runRecovery({
              dedup,
              request: (message, mid) => current.replies.request(message, mid, expectReply(mid, "OldResult")),
              submit: pipeline.submit,
              limit: config.recoveryLimit
            }),
            Effect.tap((recovery) =>
              A.length(recovery.recovered) === 0 && A.length(recovery.missing) === 0
                ? Effect.void
                : Effect.logInfo("recovered results missed during the outage").pipe(
                  Effect.annotateLogs({
                    deviceId: config.id,
                    recovered: A.length(recovery.recovered),
                    missing: A.length(recovery.missing),
                    skipped: recovery.skipped
                  })
                )
            ),
            Effect.catchCause((cause) => Effect.logWarning("gap recovery failed, continuing", cause)),
            Effect.asVoid,
            Effect.ensuring(Ref.set(recovering, false))
          )
        )
      )
    )

  const submitResult = (
    current: Session,
    pipeline: ResultDelivery,
    result: TighteningResult
  ): Effect.Effect<void> =>
    pipe(
      dedup.lastDelivered,
      Effect.flatMap((watermark) =>
        O.match(watermark, {
          onNone: () => Effect.void,
          onSome: (mark) =>
            result.tighteningId > mark + 1
              ? Effect.asVoid(Effect.forkChild(recoverGap(current, pipeline)))
              : Effect.void
        })
      ),
      Effect.andThen(pipeline.submit(result))
    )

  const routeUnsolicited = (current: Session, message: Message): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tag("LastResult", (carrier) =>
        O.match(delivery, {
          onNone: () => Effect.logDebug("dropping a result: no handler is configured"),
          onSome: (pipeline) => submitResult(current, pipeline, carrier.result)
        })),
      Match.tag("OldResult", (carrier) =>
        O.match(delivery, {
          onNone: () => Effect.logDebug("dropping a result: no handler is configured"),
          onSome: (pipeline) => pipeline.submit(carrier.result)
        })),
      Match.orElse((other) =>
        Effect.logWarning("unsolicited message dropped").pipe(
          Effect.annotateLogs({ deviceId: config.id, message: other._tag })
        )
      )
    )

  const readLoop = (current: Session): Effect.Effect<void, ConnectionLost> =>
    pipe(
      frames(current.duplex.incoming),
      Stream.runForEach((frame) =>
        pipe(
          Effect.fromResult(decodeMessage(frame, config.id)),
          Effect.flatMap((message) =>
            pipe(
              current.replies.offer(message),
              Effect.flatMap((consumed) => consumed ? Effect.void : routeUnsolicited(current, message))
            )
          )
        )
      ),
      Effect.catchTags({
        MalformedHeader: (error) => protocolLost(error._tag),
        InvalidLength: (error) => protocolLost(error._tag),
        MissingTerminator: (error) => protocolLost(error._tag),
        UnsupportedFeature: (error) => protocolLost(error._tag),
        PayloadDecodeError: (error) => protocolLost(error._tag)
      }),
      Effect.andThen(Effect.fail(new ConnectionLost({ reason: "the controller closed the connection" })))
    )

  const keepAliveLoop = (current: Session, lastSent: Ref.Ref<number>): Effect.Effect<never, ConnectionLost> =>
    pipe(
      Effect.sleep(keepAliveInterval),
      Effect.andThen(Effect.clockWith((clock) => clock.currentTimeMillis)),
      Effect.flatMap((now) =>
        pipe(
          Ref.get(lastSent),
          Effect.flatMap((sent) =>
            Duration.toMillis(keepAliveInterval) > now - sent
              ? Effect.void
              : pipe(
                current.replies.request(new KeepAlive(), 9999, expectReply(9999, "KeepAlive")),
                Effect.andThen(Ref.set(lastSent, now)),
                Effect.catchTag(
                  "RequestTimeout",
                  () => Effect.fail(new ConnectionLost({ reason: "keep-alive timed out" }))
                ),
                Effect.catchTag(
                  "CommandRejected",
                  () => Effect.fail(new ConnectionLost({ reason: "keep-alive rejected" }))
                )
              )
          )
        )
      ),
      Effect.forever
    )

  const attempt = Effect.gen(function* () {
    yield* SubscriptionRef.get(state).pipe(
      Effect.flatMap((current) => current._tag === "Disconnected" ? emit(new Connect()) : emit(new RetryDue()))
    )
    const duplex = yield* transport.connect(config.endpoint).pipe(
      Effect.tapError((error) => emit(new Failed({ reason: error.reason })))
    )
    yield* emit(new Opened())
    const lastSent = yield* Ref.make(0)
    const replies = yield* makeRequestReply({
      send: (message) =>
        pipe(
          sendRaw(duplex, message),
          Effect.tap(() => Effect.clockWith((clock) => clock.currentTimeMillis).pipe(Effect.flatMap((now) => Ref.set(lastSent, now))))
        ),
      responseTimeout
    })
    const current: Session = { duplex, replies }
    yield* Ref.set(session, O.some(current))
    yield* Effect.addFinalizer(() => Ref.set(session, O.none()))

    const reader = yield* Effect.forkChild(readLoop(current))
    // A socket that dies during the handshake, the subscription or recovery
    // must fail the attempt immediately instead of waiting for a timeout.
    const readerFailed = Effect.flatMap(
      Fiber.join(reader),
      () => Effect.fail(new ConnectionLost({ reason: "the controller closed the connection" }))
    )

    yield* Effect.raceFirst(
      Effect.gen(function* () {
      const accepted = yield* current.replies.request(
        new CommunicationStart(),
        1,
        expectReply(1, "CommunicationStartAccepted")
      ).pipe(
        Effect.catchTag("CommandRejected", (rejected) => Effect.fail(new HandshakeRejected({ code: rejected.code }))),
        Effect.catchTag("RequestTimeout", () => Effect.fail(new ConnectionLost({ reason: "handshake timed out" })))
      )
      const controllerName = accepted._tag === "CommunicationStartAccepted" ? accepted.controllerName : ""
      yield* emit(new Accepted({ controllerName }))

      // Recovery runs before the subscription: a result produced between the
      // two would otherwise be treated as history by the first baseline.
      yield* O.match(delivery, {
        onNone: () => Effect.void,
        onSome: (pipeline) => recoverGap(current, pipeline)
      })

      yield* O.match(O.fromNullishOr(config.onResult), {
        onNone: () => Effect.void,
        onSome: () =>
          pipe(
            current.replies.request(new SubscribeResults(), 60, expectReply(60)),
            Effect.asVoid,
            Effect.catchTag("CommandRejected", (rejected) =>
              Effect.fail(new ConnectionLost({ reason: `subscription refused with code ${rejected.code}` }))),
            Effect.catchTag("RequestTimeout", () => Effect.fail(new ConnectionLost({ reason: "subscribe timed out" })))
          )
      })
      yield* emit(new Subscribed())

      yield* emit(new Recovered())
      }),
      readerFailed
    )

    const keepAlive = yield* Effect.forkChild(keepAliveLoop(current, lastSent))
    return yield* pipe(
      readerFailed,
      Effect.raceFirst(Fiber.join(keepAlive)),
      Effect.onExit(() => Effect.andThen(Fiber.interrupt(keepAlive), Fiber.interrupt(reader)))
    )
  }).pipe(Effect.scoped)

  const supervisor = pipe(
    attempt,
    Effect.tapError((error) =>
      pipe(
        SubscriptionRef.get(state),
        Effect.flatMap((current) =>
          isReady(current) || current._tag === "Recovering" || current._tag === "Subscribing" ||
            current._tag === "Handshaking"
            ? emit(new Failed({ reason: reasonOf(error) }))
            : Effect.void
        )
      )
    ),
    Effect.retry(reconnect),
    Effect.catchCause((cause) => Effect.logError("device connection stopped", cause)),
    Effect.forever
  )

  const fiber = yield* Effect.forkChild(supervisor)

  const withSession = <A, E>(
    use: (current: Session) => Effect.Effect<A, E>
  ): Effect.Effect<A, E | NotReady> =>
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

  // Closing an already closed connection is a normal thing for an application
  // to do (a scope finalizer and an explicit close can both fire), so it is a
  // no-op rather than a defect.
  const closeOnce = pipe(
    emit(new CloseRequested()),
    Effect.andThen(
      withSession((current) =>
        pipe(
          sendRaw(current.duplex, new CommunicationStop()),
          Effect.timeoutOption(Duration.seconds(1))
        )
      ).pipe(Effect.ignore)
    ),
    Effect.andThen(Fiber.interrupt(fiber)),
    Effect.andThen(emit(new Released()))
  )

  const close = pipe(
    SubscriptionRef.get(state),
    Effect.flatMap((current) =>
      current._tag === "Closed" || current._tag === "Closing" ? Effect.void : closeOnce
    )
  )

  yield* Effect.addFinalizer(() =>
    pipe(
      SubscriptionRef.get(state),
      Effect.flatMap((current) => current._tag === "Closed" ? Effect.void : Effect.ignore(close))
    )
  )

  return {
    deviceId: config.id,
    state,
    request: (message, mid, direct) =>
      withSession((current) => current.replies.request(message, mid, expectReply(mid, direct))),
    send: (message) => withSession((current) => sendRaw(current.duplex, message)),
    close,
    delivered: O.match(delivery, {
      onNone: () => Effect.succeed(0),
      onSome: (pipeline) => pipeline.delivered
    }),
    duplicates: O.match(delivery, {
      onNone: () => Effect.succeed(0),
      onSome: (pipeline) => pipeline.duplicates
    })
  } satisfies DeviceConnection
})

const reasonOf = (error: unknown): string =>
  error instanceof ConnectionLost
    ? error.reason
    : error instanceof HandshakeRejected
    ? `handshake rejected with code ${error.code}`
    : "connection attempt failed"
