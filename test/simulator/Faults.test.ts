import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Predicate, Random } from "effect"
import * as A from "effect/Array"
import { FaultConfig, FaultKind, next } from "../../simulator/Faults.ts"

describe("FaultConfig", () => {
  it("fills the knobs a chaos run leaves out", () => {
    const config = new FaultConfig({ rate: 0.5 })

    expect(config.kinds).toEqual(FaultKind.literals)
    expect(Duration.toMillis(config.maxDelay)).toBe(8000)
    expect(Duration.toMillis(config.maxOutage)).toBe(5000)
  })

  it("keeps the knobs a chaos run does set", () => {
    const config = new FaultConfig({
      rate: 1,
      kinds: ["goSilent"],
      maxOutage: Duration.millis(20)
    })

    expect(config.kinds).toEqual(["goSilent"])
    expect(Duration.toMillis(config.maxOutage)).toBe(20)
    expect(Duration.toMillis(config.maxDelay)).toBe(8000)
  })
})

describe("next", () => {
  it.effect("never injects a fault at rate 0", () =>
    Effect.gen(function* () {
      const decisions = yield* Effect.forEach(A.range(1, 20), () => next(new FaultConfig({ rate: 0 })))

      expect(A.every(decisions, (fault) => Predicate.isTagged(fault, "None"))).toBe(true)
    }).pipe(Random.withSeed(42))
  )

  it.effect("only injects the kinds it was allowed", () =>
    Effect.gen(function* () {
      const config = new FaultConfig({ rate: 1, kinds: ["dropConnection"] })
      const decisions = yield* Effect.forEach(A.range(1, 20), () => next(config))

      expect(A.every(decisions, (fault) => Predicate.isTagged(fault, "DropConnection"))).toBe(true)
    }).pipe(Random.withSeed(42))
  )

  it.effect("draws a silence no longer than the outage bound", () =>
    Effect.gen(function* () {
      const config = new FaultConfig({ rate: 1, kinds: ["goSilent"], maxOutage: Duration.millis(30) })
      const decisions = yield* Effect.forEach(A.range(1, 20), () => next(config))

      expect(
        A.every(decisions, (fault) => Predicate.isTagged(fault, "GoSilent") && Duration.toMillis(fault.duration) <= 30)
      ).toBe(true)
    }).pipe(Random.withSeed(42))
  )
})
