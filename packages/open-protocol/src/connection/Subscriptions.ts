/**
 * The subscriptions a connection holds, and the frames they claim.
 *
 * A subscription outlives the sessions it runs on: it is sent again after
 * every handshake, and its stream keeps emitting across reconnects until the
 * consumer stops or the connection closes. The registry is its own structure,
 * not `RequestReply`'s slot: there is one request in flight, but any number
 * of subscriptions, each lasting as long as its consumer. It shares only the
 * way a frame is offered: `RequestReply` first, then here, and whatever
 * nobody claims is unsolicited traffic.
 *
 * @since 0.0.0
 */
import { type Cause, Effect, Queue, Ref, type Scope, Semaphore, Stream } from "effect"
import * as O from "effect/Option"
import * as R from "effect/Record"
import type { Incoming } from "../protocol/Messages.ts"
import * as Mid from "../protocol/Mid.ts"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import { ConnectionLost } from "../transport/Transport.ts"
import { AlreadySubscribed, type CommandRejected } from "./ConnectionError.ts"
import { subscribeTo } from "./Handshake.ts"
import { lostOn } from "./RequestReply.ts"
import { sendPayload, type Session } from "./Session.ts"

/**
 * One pushed value and the acknowledgement that goes with it.
 *
 * **Details**
 *
 * `ack` sends the subscription's ack MID on the session that is open when it
 * runs, and does nothing for a subscription without one. Run it once the value
 * is handled: a value never acknowledged is sent again by the controller, and
 * nothing here recognises the resend, so a consumer stays idempotent.
 *
 * @category models
 * @since 0.0.0
 */
export interface Pushed<A> {
  readonly value: A
  readonly ack: Effect.Effect<void, ConnectionLost>
}

/**
 * Every way subscribing can fail: the controller refused the subscribe MID,
 * or the data MID already has a consumer on this connection.
 *
 * @category models
 * @since 0.0.0
 */
export type SubscribeError = CommandRejected | AlreadySubscribed

/** One active subscription, its value type kept inside the closures that use it. */
interface Entry {
  readonly subscription: Mid.AnySubscription
  /** Hands a frame of the data MID to the stream; `false` if it is not the subscribed revision or does not decode. */
  readonly push: (incoming: Incoming) => Effect.Effect<boolean>
  /** Completes the stream once what is buffered has been taken. */
  readonly end: Effect.Effect<void>
  /** Drops what is buffered and lets go of a read loop waiting to push. */
  readonly shutdown: Effect.Effect<void>
}

/**
 * The subscription registry of one connection.
 *
 * @category models
 * @since 0.0.0
 */
export interface Subscriptions {
  /**
   * Registers a subscription for the calling scope and returns its stream;
   * closing the scope unsubscribes. Sent right away when a session is up,
   * otherwise at the next handshake.
   */
  readonly open: <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>
  ) => Effect.Effect<Stream.Stream<Pushed<Mid.Type<Data>>>, SubscribeError, Scope.Scope>
  /** `open`, for as long as the stream is consumed. */
  readonly subscribe: <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>
  ) => Stream.Stream<Pushed<Mid.Type<Data>>, SubscribeError>
  /** What `ack` does for the values of `subscription`. */
  readonly acknowledge: (subscription: Mid.AnySubscription) => Effect.Effect<void, ConnectionLost>
  /** Hands an incoming frame to the subscription of its MID; `true` if one took it. */
  readonly offer: (incoming: Incoming) => Effect.Effect<boolean>
  /** Sends every active subscription on a session that just opened; any failure costs the session. */
  readonly restore: (session: Session) => Effect.Effect<void, ConnectionLost>
  /** Forgets the session that ended: nothing is sent until the next `restore`. */
  readonly detach: Effect.Effect<void>
  /** Completes every stream: the connection is gone. */
  readonly close: Effect.Effect<void>
}

/**
 * Builds the registry of one connection.
 *
 * `session` is the connection's open session, if any: acknowledgements go to
 * whichever session is open when they run, as they always have.
 *
 * **Example** (A registry over a connection's session)
 *
 * ```ts
 * import { Effect, Ref } from "effect"
 * import * as O from "effect/Option"
 * import { DeviceId, type Session, Subscriptions } from "effect-open-protocol"
 *
 * const registry = Effect.gen(function* () {
 *   const session = yield* Ref.make(O.none<Session>())
 *   return yield* Subscriptions.make({ deviceId: DeviceId.make("line-1-tool-3"), session, bufferSize: 16 })
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly deviceId: DeviceId
  readonly session: Ref.Ref<O.Option<Session>>
  /** How many pushed values may wait for their consumer before the read loop waits too. */
  readonly bufferSize: number
}) {
  const entries = yield* Ref.make<R.ReadonlyRecord<string, Entry>>({})
  const live = yield* Ref.make(O.none<Session>())
  const closed = yield* Ref.make(false)
  // Subscribing, unsubscribing and restoring take turns, so a subscription
  // added while a session is being restored is neither sent twice nor missed.
  const gate = yield* Semaphore.make(1)

  const annotated = <A, E>(effect: Effect.Effect<A, E>, mid: number) =>
    Effect.annotateLogs(effect, { deviceId: options.deviceId, mid })

  const acknowledge = (subscription: Mid.AnySubscription): Effect.Effect<void, ConnectionLost> =>
    O.match(subscription.ack, {
      onNone: () => Effect.void,
      onSome: (revision) =>
        Effect.gen(function* () {
          const open = yield* Ref.get(options.session)

          if (O.isNone(open)) {
            return yield* new ConnectionLost({ reason: "no session to acknowledge on" })
          }

          // An ack carries no field (the definition checks it), so failing to
          // encode it would be a bug here.
          yield* Effect.catchTag(sendPayload(open.value.duplex, revision, {}), "PayloadEncodeError", Effect.die)
        })
    })

  const entryOf = <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>,
    queue: Queue.Queue<Pushed<Mid.Type<Data>>, Cause.Done>
  ): Entry => {
    const ack = acknowledge(subscription)

    return {
      subscription,
      push: (incoming) =>
        incoming.header.revision !== subscription.data.revision
          ? Effect.succeed(false)
          : Effect.matchEffect(Mid.decode(subscription.data, incoming.data), {
              onFailure: (error) =>
                Effect.as(annotated(Effect.logWarning("pushed frame does not decode", error.reason), error.mid), false),
              onSuccess: (value) => Effect.as(Queue.offer(queue, { value, ack }), true)
            }),
      end: Effect.asVoid(Queue.end(queue)),
      shutdown: Effect.asVoid(Queue.shutdown(queue))
    }
  }

  const add = (key: string, entry: Entry): Effect.Effect<void, SubscribeError> =>
    Effect.gen(function* () {
      const mid = entry.subscription.data.mid

      if (R.has(yield* Ref.get(entries), key)) {
        return yield* new AlreadySubscribed({ mid })
      }

      if (yield* Ref.get(closed)) {
        return yield* entry.end
      }

      yield* Ref.update(entries, R.set(key, entry))
      const session = yield* Ref.get(live)

      if (O.isNone(session)) {
        return
      }

      // A refusal is final, so the subscription is not kept; a session that
      // fails to answer is on its way out, and the next handshake sends it.
      yield* Effect.catchTags(subscribeTo(session.value, entry.subscription), {
        CommandRejected: (rejected) => Effect.andThen(Ref.update(entries, R.remove(key)), Effect.fail(rejected)),
        ConnectionLost: (lost) =>
          annotated(Effect.logWarning("could not subscribe yet, retrying at the next handshake", lost.reason), mid)
      })
    })

  const remove = (key: string, entry: Entry): Effect.Effect<void> =>
    Effect.gen(function* () {
      // Out of the registry first, and without waiting for the gate: a read
      // loop blocked on a full queue nobody drains any more must be let go.
      yield* Ref.update(entries, R.remove(key))
      yield* entry.shutdown

      yield* gate.withPermits(1)(
        Effect.gen(function* () {
          const session = yield* Ref.get(live)

          if (O.isNone(session) || O.isNone(entry.subscription.unsubscribe)) {
            return
          }

          // Best effort: the consumer is gone either way.
          yield* Effect.catchCause(
            Effect.catchTags(
              session.value.replies.request(entry.subscription.unsubscribe.value, {}),
              lostOn("unsubscribe")
            ),
            (cause) => annotated(Effect.logWarning("could not unsubscribe", cause), entry.subscription.data.mid)
          )
        })
      )
    })

  const open = <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>
  ): Effect.Effect<Stream.Stream<Pushed<Mid.Type<Data>>>, SubscribeError, Scope.Scope> =>
    Effect.gen(function* () {
      const queue = yield* Queue.bounded<Pushed<Mid.Type<Data>>, Cause.Done>(options.bufferSize)
      const key = `${subscription.data.mid}`
      const entry = entryOf(subscription, queue)

      yield* Effect.acquireRelease(gate.withPermits(1)(add(key, entry)), () => remove(key, entry))

      return Stream.fromQueue(queue)
    })

  const offer = (incoming: Incoming): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const entry = R.get(yield* Ref.get(entries), `${incoming.header.mid}`)

      return O.isSome(entry) ? yield* entry.value.push(incoming) : false
    })

  const restore = (session: Session): Effect.Effect<void, ConnectionLost> =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        const active = R.values(yield* Ref.get(entries))

        // Every subscription or none: a session missing one of them would
        // silently drop what the consumer is waiting for.
        yield* Effect.forEach(
          active,
          (entry) =>
            Effect.catchTag(
              subscribeTo(session, entry.subscription),
              "CommandRejected",
              lostOn("subscribe").CommandRejected
            ),
          { discard: true }
        )

        yield* Ref.set(live, O.some(session))
      })
    )

  const close = Effect.gen(function* () {
    yield* Ref.set(closed, true)
    const active = yield* Ref.getAndSet(entries, {})
    yield* Effect.forEach(R.values(active), (entry) => entry.end, { discard: true })
  })

  return {
    open,
    subscribe: (subscription) => Stream.unwrap(open(subscription)),
    acknowledge,
    offer,
    restore,
    detach: Ref.set(live, O.none()),
    close
  } satisfies Subscriptions
})
