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
import { Effect, Fiber, Match, pipe, Queue, Ref, Stream } from "effect"
import * as O from "effect/Option"
import { frames } from "../src/protocol/Framer.ts"
import {
  CommandAccepted,
  CommandError,
  CommunicationStartAccepted,
  decodeMessage,
  encodeMessage,
  KeepAlive,
  type Message
} from "../src/protocol/Messages.ts"
import { DeviceId } from "../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, type ServerSide } from "../src/transport/InMemoryTransport.ts"
import type { Endpoint } from "../src/transport/Transport.ts"

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
}

interface SessionState {
  readonly subscribed: boolean
  readonly keepAlives: number
}

const replyTo = (
  message: Message,
  options: SimulatorOptions
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
    Match.orElse((): O.Option<Message> => O.none())
  )

const observe = (message: Message, current: SessionState): SessionState =>
  Match.value(message).pipe(
    Match.tag("SubscribeResults", () => ({ ...current, subscribed: true })),
    Match.tag("UnsubscribeResults", () => ({ ...current, subscribed: false })),
    Match.tag("KeepAlive", () => ({ ...current, keepAlives: current.keepAlives + 1 })),
    Match.orElse(() => current)
  )

const encoder = new TextEncoder()

const serve = (
  connection: ServerSide,
  state: Ref.Ref<SessionState>,
  options: SimulatorOptions
): Effect.Effect<void> =>
  pipe(
    connection.incoming,
    frames,
    Stream.runForEach((frame) =>
      pipe(
        decodeMessage(frame, simulatorDevice),
        Effect.fromResult,
        Effect.flatMap((message) =>
          pipe(
            Ref.update(state, (current) => observe(message, current)),
            Effect.andThen(
              O.match(replyTo(message, options), {
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
export const make = Effect.fnUntraced(function* (options: SimulatorOptions) {
  const network = yield* InMemoryNetwork
  const state = yield* Ref.make<SessionState>({ subscribed: false, keepAlives: 0 })
  const accepted = yield* network.bind(options.endpoint)
  const acceptLoop = yield* pipe(
    Queue.take(accepted),
    Effect.flatMap((connection) => Effect.forkChild(serve(connection, state, options))),
    Effect.forever,
    Effect.forkChild
  )
  yield* Effect.addFinalizer(() => Fiber.interrupt(acceptLoop))
  return {
    isSubscribed: Effect.map(Ref.get(state), (current) => current.subscribed),
    keepAlives: Effect.map(Ref.get(state), (current) => current.keepAlives)
  } satisfies Simulator
})
