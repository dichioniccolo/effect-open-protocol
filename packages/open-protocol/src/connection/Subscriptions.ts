/**
 * The subscriptions a connection holds, and the frames they claim.
 *
 * A subscription outlives the sessions it runs on: it is sent again after
 * every handshake, and its stream keeps emitting across reconnects until the
 * consumer stops, the controller refuses it, or the connection closes. The
 * registry is its own structure, not `RequestReply`'s slot: there is one
 * request in flight, but any number of subscriptions, each lasting as long as
 * its consumer. It shares only the way a frame is offered: `RequestReply`
 * first, then here, and whatever nobody claims is unsolicited traffic.
 *
 * @since 0.0.0
 */
import { type Cause, Data, Effect, HashMap, Match, Queue, Ref, type Scope, Semaphore, Stream } from "effect"
import * as O from "effect/Option"
import type { Incoming } from "../protocol/Messages.ts"
import * as Mid from "../protocol/Mid.ts"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import type { ConnectionLost } from "../transport/Transport.ts"
import { AlreadySubscribed, type CommandRejected } from "./ConnectionError.ts"
import { lostOn, orLost } from "./RequestReply.ts"
import type { Session } from "./Session.ts"

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

/**
 * An open subscription: the values the controller pushes, and the ack that
 * goes with every one of them.
 *
 * **Details**
 *
 * An ack names no value, so `ack` is the one each `Pushed` carries, handy for
 * acknowledging something that did not come through `values`. `values` fails
 * with `CommandRejected` when the controller refuses the subscription, now or
 * at a later handshake; the subscription is forgotten then.
 *
 * @category models
 * @since 0.0.0
 */
export interface Subscribed<A> {
  readonly values: Stream.Stream<Pushed<A>, CommandRejected>
  readonly ack: Effect.Effect<void, ConnectionLost>
}

/** One active subscription, its value type kept inside the closures that use it. */
interface Entry {
  readonly subscription: Mid.AnySubscription
  /** Hands a frame of the data MID to the stream; `false` if it is not the subscribed revision or does not decode. */
  readonly push: (incoming: Incoming) => Effect.Effect<boolean>
  /** Completes the stream once what is buffered has been taken. */
  readonly end: Effect.Effect<void>
  /** Fails the stream once what is buffered has been taken. */
  readonly fail: (rejected: CommandRejected) => Effect.Effect<void>
  /** Drops what is buffered and lets go of a read loop waiting to push. */
  readonly shutdown: Effect.Effect<void>
}

/** Everything the registry knows, changed in one step so no update is ever half applied. */
type State = Data.TaggedEnum<{
  Open: {
    readonly entries: HashMap.HashMap<number, Entry>
    /** The session every entry has been sent on, once it is restored. */
    readonly live: O.Option<Session>
  }
  Closed: {}
}>

const State = Data.taggedEnum<State>()

type Open = Data.TaggedEnum.Value<State, "Open">

/**
 * The subscription registry of one connection.
 *
 * @category models
 * @since 0.0.0
 */
export interface Subscriptions {
  /**
   * Registers a subscription for the calling scope, buffering up to
   * `bufferSize` values for its consumer; closing the scope unsubscribes.
   * Sent right away when a session is up, otherwise at the next handshake.
   */
  readonly open: <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>,
    bufferSize: number
  ) => Effect.Effect<Subscribed<Mid.Type<Data>>, AlreadySubscribed, Scope.Scope>
  /** Hands an incoming frame to the subscription of its MID; `true` if one took it. */
  readonly offer: (incoming: Incoming) => Effect.Effect<boolean>
  /**
   * Sends every active subscription on a session that just opened. A refusal
   * ends that subscription; any other failure costs the session.
   */
  readonly restore: (session: Session) => Effect.Effect<void, ConnectionLost>
  /** Forgets the session that ended: nothing is sent until the next `restore`. */
  readonly detach: Effect.Effect<void>
  /** Completes every stream: the connection is gone. */
  readonly close: Effect.Effect<void>
}

/**
 * Builds the registry of one connection. `send` is how acknowledgements reach
 * the controller: bare, on whichever session is open when they run.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly deviceId: DeviceId
  readonly send: (revision: Mid.AnyRevision) => Effect.Effect<void, ConnectionLost>
}) {
  const state = yield* Ref.make<State>(State.Open({ entries: HashMap.empty(), live: O.none() }))
  // Only the sends take turns, so a subscription added while a session is
  // being restored is neither sent twice nor missed.
  const gate = yield* Semaphore.make(1)

  const annotated = <A, E>(effect: Effect.Effect<A, E>, mid: number) =>
    Effect.annotateLogs(effect, { deviceId: options.deviceId, mid })

  /** The open state, or nothing once closed. */
  const opened: Effect.Effect<O.Option<Open>> = Effect.map(Ref.get(state), O.liftPredicate(State.$is("Open")))

  const whileOpen = (f: (registry: Open) => Open): Effect.Effect<void> =>
    Ref.update(state, (current) => (State.$is("Open")(current) ? f(current) : current))

  /** Takes `entry` out of the registry; `true` if it was still the one registered for its MID. */
  const unregister = (entry: Entry): Effect.Effect<boolean> =>
    Ref.modify(state, (current): readonly [boolean, State] => {
      const mid = entry.subscription.data.mid

      return State.$is("Open")(current) && O.exists(HashMap.get(current.entries, mid), (found) => found === entry)
        ? [true, State.Open({ ...current, entries: HashMap.remove(current.entries, mid) })]
        : [false, current]
    })

  /**
   * Sends the subscribe MID. A refusal is final, so the subscription is
   * forgotten and its stream fails with it; any other failure means the
   * session is on its way out.
   */
  const subscribeOn = (session: Session, entry: Entry): Effect.Effect<void, ConnectionLost> =>
    session.replies.request(entry.subscription.subscribe, {}).pipe(
      Effect.catchTags({
        ...lostOn("subscribe"),
        CommandRejected: (rejected: CommandRejected) => Effect.andThen(unregister(entry), entry.fail(rejected))
      }),
      Effect.asVoid
    )

  const entryOf = <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>,
    queue: Queue.Queue<Pushed<Mid.Type<Data>>, CommandRejected | Cause.Done>,
    ack: Effect.Effect<void, ConnectionLost>
  ): Entry => ({
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
    fail: (rejected) => Effect.asVoid(Queue.fail(queue, rejected)),
    shutdown: Effect.asVoid(Queue.shutdown(queue))
  })

  /** What registering does next, and the state it leaves behind. */
  type Decision = readonly [Effect.Effect<void, AlreadySubscribed>, State]

  const add = (entry: Entry): Effect.Effect<void, AlreadySubscribed> =>
    Effect.gen(function* () {
      const mid = entry.subscription.data.mid

      // A session that fails to answer is on its way out, and the next
      // handshake sends the subscription again.
      const sendNow = (session: Session): Effect.Effect<void> =>
        Effect.catchTag(subscribeOn(session, entry), "ConnectionLost", (lost) =>
          annotated(Effect.logWarning("could not subscribe yet, retrying at the next handshake", lost.reason), mid)
        )

      // Checked and registered in one step, so `close` can never slip in
      // between and leave a stream nobody will end.
      const next = yield* Ref.modify(state, (current) =>
        State.$match(current, {
          Closed: (): Decision => [entry.end, current],
          Open: (registry): Decision =>
            HashMap.has(registry.entries, mid)
              ? [Effect.fail(new AlreadySubscribed({ mid })), current]
              : [
                  O.match(registry.live, { onNone: () => Effect.void, onSome: sendNow }),
                  State.Open({ ...registry, entries: HashMap.set(registry.entries, mid, entry) })
                ]
        })
      )

      yield* next
    })

  const remove = (entry: Entry): Effect.Effect<void> =>
    Effect.gen(function* () {
      const mid = entry.subscription.data.mid

      // Out of the registry first, and without waiting for the gate: a read
      // loop blocked on a full queue nobody drains any more must be let go.
      const registered = yield* unregister(entry)
      yield* entry.shutdown

      yield* gate.withPermits(1)(
        Effect.gen(function* () {
          // Checked in the same turn of the gate as the send: a consumer that
          // took the MID meanwhile has had its subscribe sent already, and
          // unsubscribing now would stop its pushes.
          const live = O.flatMap(yield* opened, (registry) =>
            HashMap.has(registry.entries, mid) ? O.none() : registry.live
          )

          // A refused subscription was never taken, so there is nothing to stop.
          if (!registered || O.isNone(live) || O.isNone(entry.subscription.unsubscribe)) {
            return
          }

          // Best effort: the consumer is gone either way.
          yield* Effect.catchCause(
            orLost("unsubscribe")(live.value.replies.request(entry.subscription.unsubscribe.value, {})),
            (cause) => annotated(Effect.logWarning("could not unsubscribe", cause), mid)
          )
        })
      )
    })

  const open = <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>,
    bufferSize: number
  ): Effect.Effect<Subscribed<Mid.Type<Data>>, AlreadySubscribed, Scope.Scope> =>
    Effect.gen(function* () {
      const queue = yield* Queue.bounded<Pushed<Mid.Type<Data>>, CommandRejected | Cause.Done>(bufferSize)
      const ack = O.match(subscription.ack, { onNone: () => Effect.void, onSome: options.send })
      const entry = entryOf(subscription, queue, ack)

      yield* Effect.acquireRelease(gate.withPermits(1)(add(entry)), () => remove(entry))

      return { values: Stream.fromQueue(queue), ack }
    })

  const offer = (incoming: Incoming): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const entry = O.flatMap(yield* opened, (registry) => HashMap.get(registry.entries, incoming.header.mid))

      return O.isSome(entry) ? yield* entry.value.push(incoming) : false
    })

  const restore = (session: Session): Effect.Effect<void, ConnectionLost> =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        const active = O.match(yield* opened, {
          onNone: () => [],
          onSome: (registry) => Array.from(HashMap.values(registry.entries))
        })

        // A session missing a subscription would silently drop what its
        // consumer is waiting for, so anything but a refusal costs it.
        yield* Effect.forEach(active, (entry) => subscribeOn(session, entry), { discard: true })

        yield* whileOpen((registry) => State.Open({ ...registry, live: O.some(session) }))
      })
    )

  const close = Effect.gen(function* () {
    const previous = yield* Ref.getAndSet(state, State.Closed())

    yield* Match.valueTags(previous, {
      Closed: () => Effect.void,
      Open: (registry) => Effect.forEach(HashMap.values(registry.entries), (entry) => entry.end, { discard: true })
    })
  })

  return {
    open,
    offer,
    restore,
    detach: whileOpen((registry) => State.Open({ ...registry, live: O.none() })),
    close
  } satisfies Subscriptions
})
