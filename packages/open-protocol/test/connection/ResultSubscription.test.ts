import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Match, Predicate, Queue, Ref, Schedule, SubscriptionRef } from "effect"
import * as O from "effect/Option"
import { TestClock } from "effect/testing"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import { CommandAccepted, CommandError, encodeMessage } from "../../src/protocol/Messages.ts"
import { deviceId, endpoint, provided, scriptedController } from "../example/ScriptedController.ts"

/** Moves the clock in small steps until `check` holds. */
const advanceUntil = (check: Effect.Effect<boolean>, steps = 200): Effect.Effect<void> =>
  Effect.flatMap(check, (done) =>
    done || steps <= 0
      ? Effect.void
      : Effect.andThen(TestClock.adjust(Duration.millis(100)), advanceUntil(check, steps - 1))
  )

describe("the results subscription", () => {
  it.effect("survives a session that ends while it is being taken again", () =>
    provided(
      Effect.gen(function* () {
        const subscribes = yield* Ref.make(0)

        // The first subscribe is refused, the second is never answered, and
        // every later one is accepted. The controller holds no results.
        const controller = yield* scriptedController((header) =>
          header.mid === 60
            ? Effect.map(
                Ref.updateAndGet(subscribes, (n) => n + 1),
                (n) =>
                  Match.value(n).pipe(
                    Match.when(1, () => O.some(encodeMessage(new CommandError({ mid: 60, code: 99 })))),
                    Match.when(2, () => O.none<string>()),
                    Match.orElse(() => O.some(encodeMessage(new CommandAccepted({ mid: 60 }))))
                  )
              )
            : Effect.succeed(
                header.mid === 64 ? O.some(encodeMessage(new CommandError({ mid: 64, code: 15 }))) : O.none()
              )
        )

        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          reconnect: Schedule.spaced(Duration.millis(100)),
          onResult: () => Effect.void
        })

        const ready = Effect.map(SubscriptionRef.get(connection.state), (state) => Predicate.isTagged(state, "Ready"))

        // Session one loses its subscription to the refusal. Session two takes
        // it again, and the controller drops that session while the subscribe
        // is still waiting for its answer.
        yield* advanceUntil(Effect.map(Ref.get(subscribes), (n) => n === 2))
        yield* Queue.take(controller.sessions)
        const second = yield* Queue.take(controller.sessions)
        yield* second.close("the controller dropped the session")

        // Session three restores the subscription and stays up.
        yield* advanceUntil(Effect.zipWith(ready, Ref.get(subscribes), (up, n) => up && n >= 3))
        yield* Queue.take(controller.sessions)
        yield* TestClock.adjust(Duration.seconds(10))

        expect(yield* ready).toBe(true)
        expect(yield* Queue.size(controller.sessions)).toBe(0)
      })
    )
  )
})
