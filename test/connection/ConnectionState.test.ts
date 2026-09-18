import { describe, expect, it } from "@effect/vitest"
import { assertFailure, assertSuccess } from "@effect/vitest/utils"
import { pipe, Result } from "effect"
import * as A from "effect/Array"
import {
  Accepted,
  AttemptStarted,
  Closed,
  CloseRequested,
  Closing,
  Connecting,
  type ConnectionEvent,
  type ConnectionState,
  Disconnected,
  Failed,
  Handshaking,
  initial,
  InvalidTransition,
  isFinal,
  isReady,
  Opened,
  Ready,
  Recovered,
  Recovering,
  Released,
  Subscribed,
  Subscribing,
  transition,
  WaitingToReconnect
} from "../../src/connection/ConnectionState.ts"

const run = (
  state: ConnectionState,
  events: ReadonlyArray<ConnectionEvent>
): Result.Result<ConnectionState, InvalidTransition> =>
  A.reduce(events, Result.succeed(state) as Result.Result<ConnectionState, InvalidTransition>, (current, event) =>
    Result.flatMap(current, (value) => transition(value, event))
  )

const toReady: ReadonlyArray<ConnectionEvent> = [
  new AttemptStarted(),
  new Opened(),
  new Accepted({ controllerName: "Airbag1" }),
  new Subscribed(),
  new Recovered()
]

describe("ConnectionState", () => {
  it("walks the happy path and keeps the controller name", () => {
    assertSuccess(run(initial, toReady), new Ready({ controllerName: "Airbag1" }))
  })

  it("names each intermediate state", () => {
    assertSuccess(transition(initial, new AttemptStarted()), new Connecting({ attempt: 1 }))
    assertSuccess(transition(new Connecting({ attempt: 1 }), new Opened()), new Handshaking({ attempt: 1 }))
    assertSuccess(
      transition(new Handshaking({ attempt: 2 }), new Accepted({ controllerName: "c" })),
      new Subscribing({ attempt: 2, controllerName: "c" })
    )
    assertSuccess(
      transition(new Subscribing({ attempt: 2, controllerName: "c" }), new Subscribed()),
      new Recovering({ attempt: 2, controllerName: "c" })
    )
  })

  it("counts attempts across reconnects and resets them after a live session", () => {
    const afterFirstFailure = run(initial, [new AttemptStarted(), new Failed({ reason: "refused" })])
    assertSuccess(afterFirstFailure, new WaitingToReconnect({ attempt: 1, reason: "refused" }))

    const secondAttempt = run(initial, [
      new AttemptStarted(),
      new Failed({ reason: "refused" }),
      new AttemptStarted(),
      new Failed({ reason: "refused again" })
    ])
    assertSuccess(secondAttempt, new WaitingToReconnect({ attempt: 2, reason: "refused again" }))

    const afterReady = run(initial, [...toReady, new Failed({ reason: "socket closed" })])
    assertSuccess(afterReady, new WaitingToReconnect({ attempt: 1, reason: "socket closed" }))
  })

  it("fails from every stage of a connection attempt", () => {
    A.forEach(
      [
        new Connecting({ attempt: 3 }),
        new Handshaking({ attempt: 3 }),
        new Subscribing({ attempt: 3, controllerName: "c" }),
        new Recovering({ attempt: 3, controllerName: "c" })
      ] as ReadonlyArray<ConnectionState>,
      (state) => {
        assertSuccess(
          transition(state, new Failed({ reason: "boom" })),
          new WaitingToReconnect({ attempt: 3, reason: "boom" })
        )
      }
    )
  })

  it("closes from any non final state", () => {
    A.forEach(
      [
        new Disconnected(),
        new Connecting({ attempt: 1 }),
        new Handshaking({ attempt: 1 }),
        new Subscribing({ attempt: 1, controllerName: "c" }),
        new Recovering({ attempt: 1, controllerName: "c" }),
        new Ready({ controllerName: "c" }),
        new WaitingToReconnect({ attempt: 1, reason: "boom" })
      ] as ReadonlyArray<ConnectionState>,
      (state) => {
        assertSuccess(transition(state, new CloseRequested()), new Closing())
      }
    )
    assertSuccess(transition(new Closing(), new Released()), new Closed())
  })

  it("treats Closed as final", () => {
    const closed = new Closed()
    expect(isFinal(closed)).toBe(true)
    A.forEach(
      [new AttemptStarted(), new CloseRequested(), new Released()] as ReadonlyArray<ConnectionEvent>,
      (event) => {
        assertFailure(transition(closed, event), new InvalidTransition({ state: "Closed", event: event._tag }))
      }
    )
  })

  it("rejects out of order events", () => {
    assertFailure(transition(initial, new Opened()), new InvalidTransition({ state: "Disconnected", event: "Opened" }))
    assertFailure(
      transition(new Connecting({ attempt: 1 }), new Subscribed()),
      new InvalidTransition({ state: "Connecting", event: "Subscribed" })
    )
    assertFailure(
      transition(new Ready({ controllerName: "c" }), new AttemptStarted()),
      new InvalidTransition({ state: "Ready", event: "AttemptStarted" })
    )
    assertFailure(
      transition(new WaitingToReconnect({ attempt: 1, reason: "boom" }), new Opened()),
      new InvalidTransition({ state: "WaitingToReconnect", event: "Opened" })
    )
    assertFailure(
      transition(new Closing(), new AttemptStarted()),
      new InvalidTransition({ state: "Closing", event: "AttemptStarted" })
    )
  })

  it("reports readiness only when Ready", () => {
    expect(pipe(run(initial, toReady), Result.map(isReady))).toEqual(Result.succeed(true))
    expect(isReady(new Recovering({ attempt: 1, controllerName: "c" }))).toBe(false)
  })
})
