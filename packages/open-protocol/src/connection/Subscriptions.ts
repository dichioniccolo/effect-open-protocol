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
import { type Cause, Data, Effect, Match, Queue, Ref, type Scope, Semaphore, Stream } from "effect"
import * as O from "effect/Option"
import * as R from "effect/Record"
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
 * Sends a control MID bare on whichever session is open, failing when none is.
 *
 * @category models
 * @since 0.0.0
 */
export type SendBare = (revision: Mid.AnyRevision) => Effect.Effect<void, ConnectionLost>

/**
 * What acknowledging a value of `subscription` does: its ack MID sent bare,
 * or nothing when it has none. Also what a result recovered with MID 0064 is
 * acknowledged with: an ack that names no value is the same for every one.
 *
 * @category constructors
 * @since 0.0.0
 */
export const ackOf = (send: SendBare, subscription: Mid.AnySubscription): Effect.Effect<void, ConnectionLost> =>
  O.match(subscription.ack, { onNone: () => Effect.void, onSome: send })

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

/** Everything the registry knows, changed in one step so no update is ever half applied. */
type State = Data.TaggedEnum<{
  Open: {
    readonly entries: R.ReadonlyRecord<string, Entry>
    /** The session every entry has been sent on, once it is restored. */
    readonly live: O.Option<Session>
  }
  Closed: {}
}>

const State = Data.taggedEnum<State>()

type Open = Data.TaggedEnum.Value<State, "Open">

/** What registering an entry found. */
type Added = Data.TaggedEnum<{
  Registered: { readonly live: O.Option<Session> }
  Taken: {}
  Closed: {}
}>

const Added = Data.taggedEnum<Added>()

const decided = (added: Added, next: State): readonly [Added, State] => [added, next]

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
 * Builds the registry of one connection. `send` is how acknowledgements reach
 * the controller: bare, on whichever session is open when they run.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly deviceId: DeviceId
  readonly send: SendBare
  /** How many pushed values may wait for their consumer before the read loop waits too. */
  readonly bufferSize: number
}) {
  const state = yield* Ref.make<State>(State.Open({ entries: {}, live: O.none() }))
  // Only the sends take turns, so a subscription added while a session is
  // being restored is neither sent twice nor missed.
  const gate = yield* Semaphore.make(1)

  const annotated = <A, E>(effect: Effect.Effect<A, E>, mid: number) =>
    Effect.annotateLogs(effect, { deviceId: options.deviceId, mid })

  /** The open state, or nothing once closed. */
  const opened: Effect.Effect<O.Option<Open>> = Effect.map(Ref.get(state), O.liftPredicate(State.$is("Open")))

  const whileOpen = (f: (registry: Open) => Open): Effect.Effect<void> =>
    Ref.update(state, (current) => (State.$is("Open")(current) ? f(current) : current))

  const without =
    (key: string) =>
    (registry: Open): Open =>
      State.Open({ ...registry, entries: R.remove(registry.entries, key) })

  const entryOf = <Data extends Mid.AnyRevision>(
    subscription: Mid.Subscription<Data>,
    queue: Queue.Queue<Pushed<Mid.Type<Data>>, Cause.Done>
  ): Entry => {
    const ack = ackOf(options.send, subscription)

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

      // Checked and registered in one step, so `close` can never slip in
      // between and leave a stream nobody will end.
      const added = yield* Ref.modify(state, (current) =>
        State.$match(current, {
          Closed: () => decided(Added.Closed(), current),
          Open: (registry) =>
            R.has(registry.entries, key)
              ? decided(Added.Taken(), current)
              : decided(
                  Added.Registered({ live: registry.live }),
                  State.Open({ ...registry, entries: R.set(registry.entries, key, entry) })
                )
        })
      )

      // A refusal is final, so the subscription is not kept; a session that
      // fails to answer is on its way out, and the next handshake sends it.
      const send = (session: Session): Effect.Effect<void, CommandRejected> =>
        session.replies.request(entry.subscription.subscribe, {}).pipe(
          Effect.catchTags({
            ...lostOn("subscribe"),
            CommandRejected: (rejected: CommandRejected) =>
              Effect.andThen(whileOpen(without(key)), Effect.fail(rejected))
          }),
          Effect.catchTag("ConnectionLost", (lost) =>
            annotated(Effect.logWarning("could not subscribe yet, retrying at the next handshake", lost.reason), mid)
          ),
          Effect.asVoid
        )

      yield* Added.$match(added, {
        Closed: () => entry.end,
        Taken: () => Effect.fail(new AlreadySubscribed({ mid })),
        Registered: (registered) => O.match(registered.live, { onNone: () => Effect.void, onSome: send })
      })
    })

  const remove = (key: string, entry: Entry): Effect.Effect<void> =>
    Effect.gen(function* () {
      // Out of the registry first, and without waiting for the gate: a read
      // loop blocked on a full queue nobody drains any more must be let go.
      yield* whileOpen(without(key))
      yield* entry.shutdown

      yield* gate.withPermits(1)(
        Effect.gen(function* () {
          const live = O.flatMap(yield* opened, (registry) => registry.live)

          if (O.isNone(live) || O.isNone(entry.subscription.unsubscribe)) {
            return
          }

          // Best effort: the consumer is gone either way.
          yield* Effect.catchCause(
            orLost("unsubscribe")(live.value.replies.request(entry.subscription.unsubscribe.value, {})),
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
      const entry = O.flatMap(yield* opened, (registry) => R.get(registry.entries, `${incoming.header.mid}`))

      return O.isSome(entry) ? yield* entry.value.push(incoming) : false
    })

  const restore = (session: Session): Effect.Effect<void, ConnectionLost> =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        const active = O.match(yield* opened, { onNone: () => [], onSome: (registry) => R.values(registry.entries) })

        // Every subscription or none: a session missing one of them would
        // silently drop what the consumer is waiting for. A refusal here costs
        // the session, as a refused MID 0060 always has.
        yield* Effect.forEach(
          active,
          (entry) => orLost("subscribe")(session.replies.request(entry.subscription.subscribe, {})),
          { discard: true }
        )

        yield* whileOpen((registry) => State.Open({ ...registry, live: O.some(session) }))
      })
    )

  const close = Effect.gen(function* () {
    const previous = yield* Ref.getAndSet(state, State.Closed())

    yield* Match.valueTags(previous, {
      Closed: () => Effect.void,
      Open: (registry) => Effect.forEach(R.values(registry.entries), (entry) => entry.end, { discard: true })
    })
  })

  return {
    open,
    subscribe: (subscription) => Stream.unwrap(open(subscription)),
    offer,
    restore,
    detach: whileOpen((registry) => State.Open({ ...registry, live: O.none() })),
    close
  } satisfies Subscriptions
})
