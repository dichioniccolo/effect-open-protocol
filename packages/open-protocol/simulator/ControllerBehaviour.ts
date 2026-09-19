/**
 * What a well-behaved controller answers, and what it remembers.
 *
 * These are pure functions over one message: no socket, no faults, no timing.
 * A test that asks "what does a controller reply to MID 0064" reads this file
 * and nothing else.
 *
 * @since 0.0.0
 */
import { Match } from "effect"
import * as A from "effect/Array"
import * as MutableHashMap from "effect/MutableHashMap"
import * as O from "effect/Option"
import {
  builtIns,
  CommandAccepted,
  CommandError,
  CommunicationStartAccepted,
  KeepAlive,
  type Message,
  OldResult,
  type UnknownMessage
} from "../src/protocol/Messages.ts"
import { ControllerTimestamp, DeviceId, TighteningId, TighteningResult } from "../src/protocol/TighteningResult.ts"
import type { SessionState } from "./SessionState.ts"

/**
 * The device identifier every simulated result is stamped with.
 *
 * @category constants
 * @since 0.0.0
 */
export const simulatorDevice = DeviceId.make("simulator")

/**
 * How a simulated controller introduces itself, and when it refuses to.
 *
 * It is the only part of the simulator's configuration the reply logic reads,
 * so that is all it asks for.
 *
 * @category models
 * @since 0.0.0
 */
export interface ControllerIdentity {
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
 * What a controller reports about itself when nothing else was asked for.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultIdentity = {
  cellId: 1,
  channelId: 1,
  controllerName: "Simulator",
  silent: false
}

/**
 * A `ControllerIdentity` with every default filled in; only the refusal stays
 * optional, because its absence is what "accept" means.
 *
 * @category models
 * @since 0.0.0
 */
export interface ResolvedIdentity
  extends
    Omit<ControllerIdentity, keyof typeof defaultIdentity>,
    Required<Pick<ControllerIdentity, keyof typeof defaultIdentity>> {}

const timestamp = ControllerTimestamp.make("2026-09-17:10:14:16")

/**
 * The result a controller would report for the nth tightening.
 *
 * @category constructors
 * @since 0.0.0
 */
export const resultFor = (id: number): TighteningResult =>
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

/**
 * The Open Protocol error codes a controller answers a message it cannot
 * handle with: `99` for a MID it does not know, `97` for a revision of a known
 * MID it does not support.
 *
 * **Example** (The code a MID nobody models gets)
 *
 * ```ts
 * import { refusalCodes } from "effect-open-protocol/simulator/ControllerBehaviour.ts"
 *
 * console.log(refusalCodes.unknownMid) // 99
 * ```
 *
 * @category constants
 * @since 0.0.0
 */
export const refusalCodes = { unknownMid: 99, unsupportedRevision: 97 } as const

const refuse = (message: UnknownMessage): CommandError =>
  new CommandError({
    mid: message.mid,
    code: A.some(builtIns, (definition) => definition.mid === message.mid)
      ? refusalCodes.unsupportedRevision
      : refusalCodes.unknownMid
  })

/**
 * The reply a controller owes an incoming message, if it owes one at all.
 *
 * @category behaviour
 * @since 0.0.0
 */
export const replyTo = (
  message: Message,
  identity: ResolvedIdentity,
  store: MutableHashMap.MutableHashMap<number, TighteningResult>,
  latest: O.Option<number>
): O.Option<Message> =>
  Match.value(message).pipe(
    Match.tag("CommunicationStart", () =>
      O.some(
        O.match(O.fromNullishOr(identity.rejectStartWith), {
          onNone: (): Message =>
            new CommunicationStartAccepted({
              cellId: identity.cellId,
              channelId: identity.channelId,
              controllerName: identity.controllerName
            }),
          onSome: (code): Message => new CommandError({ mid: 1, code })
        })
      )
    ),
    Match.tag("KeepAlive", (): O.Option<Message> => (identity.silent ? O.none() : O.some(new KeepAlive()))),
    Match.tag("SubscribeResults", (): O.Option<Message> => O.some(new CommandAccepted({ mid: 60 }))),
    Match.tag("UnsubscribeResults", (): O.Option<Message> => O.some(new CommandAccepted({ mid: 63 }))),
    Match.tag("CommunicationStop", (): O.Option<Message> => O.some(new CommandAccepted({ mid: 3 }))),
    Match.tag("RequestOldResult", (request): O.Option<Message> => {
      const wanted = request.tighteningId === 0 ? latest : O.some<number>(request.tighteningId)

      return O.some(
        O.match(
          O.flatMap(wanted, (id) => MutableHashMap.get(store, id)),
          {
            onNone: (): Message => new CommandError({ mid: 64, code: 15 }),
            onSome: (result): Message => new OldResult({ result })
          }
        )
      )
    }),
    Match.tag("UnknownMessage", (unknown): O.Option<Message> => O.some(refuse(unknown))),
    Match.orElse((): O.Option<Message> => O.none())
  )

/**
 * What an incoming message changes about the controller's own bookkeeping.
 *
 * @category behaviour
 * @since 0.0.0
 */
export const observe = (message: Message, current: SessionState): SessionState =>
  Match.value(message).pipe(
    Match.tag("SubscribeResults", () => ({ ...current, subscribed: true, everSubscribed: true })),
    Match.tag("UnsubscribeResults", () => ({ ...current, subscribed: false })),
    Match.tag("KeepAlive", () => ({ ...current, keepAlives: current.keepAlives + 1 })),
    Match.tag("CommunicationStop", () => ({ ...current, subscribed: false, stops: current.stops + 1 })),
    Match.orElse(() => current)
  )
