import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import * as S from "effect/Schema"
import * as Field from "../../src/protocol/Field.ts"
import { ControllerTimestamp, TighteningId, TighteningStatus } from "../../src/protocol/TighteningResult.ts"

const accepted = Field.layout([
  ["cellId", Field.digits({ id: "01", width: 4 })],
  ["channelId", Field.digits({ id: "02", width: 2 })],
  ["controllerName", Field.text({ id: "03", width: 25 })]
])

const positional = Field.layout([
  ["mid", Field.digits({ width: 4 })],
  Field.filler({ width: 2, value: "  " }),
  ["status", Field.enumerated({ width: 1, literals: TighteningStatus })],
  ["tighteningId", Field.digits({ width: 10, schema: TighteningId })],
  ["timestamp", Field.raw({ width: 19, schema: ControllerTimestamp })]
])

describe("Field", () => {
  it("types a layout by its named entries only", () => {
    expectTypeOf<typeof accepted.Type>().toEqualTypeOf<{
      readonly cellId: number
      readonly channelId: number
      readonly controllerName: string
    }>()
    expectTypeOf<typeof positional.Type>().toEqualTypeOf<{
      readonly mid: number
      readonly status: "NOK" | "OK"
      readonly tighteningId: TighteningId
      readonly timestamp: ControllerTimestamp
    }>()
  })

  it.effect("round trips a parameter-id layout", () =>
    Effect.gen(function* () {
      const wire = "010001" + "0201" + "03" + "Airbag1".padEnd(25, " ")
      const value = yield* S.decodeEffect(accepted)(wire)

      expect(value).toEqual({ cellId: 1, channelId: 1, controllerName: "Airbag1" })
      expect(yield* S.encodeEffect(accepted)(value)).toBe(wire)
    })
  )

  it.effect("round trips a positional layout, writing fillers it never decodes", () =>
    Effect.gen(function* () {
      const value = {
        mid: 61,
        status: "OK" as const,
        tighteningId: TighteningId.make(42),
        timestamp: ControllerTimestamp.make("2026-09-19:10:00:00")
      }

      const wire = yield* S.encodeEffect(positional)(value)

      expect(wire).toBe("0061" + "  " + "1" + "0000000042" + "2026-09-19:10:00:00")
      expect(yield* S.decodeEffect(positional)(wire)).toEqual(value)
    })
  )

  it.effect("rejects a parameter id out of place", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(S.decodeEffect(accepted)("020001" + "0101" + "03" + " ".repeat(25)))
      expect(Exit.isFailure(exit)).toBe(true)
    })
  )

  it.effect("rejects a truncated data field", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(S.decodeEffect(accepted)("010001" + "0201" + "03Airbag"))
      expect(Exit.isFailure(exit)).toBe(true)
    })
  )

  it.effect("refuses to encode a value wider than its field", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        S.encodeEffect(accepted)({ cellId: 12345, channelId: 1, controllerName: "Airbag1" })
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })
  )

  it.effect("rejects a status code outside the literals", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(S.decodeEffect(Field.enumerated({ width: 1, literals: TighteningStatus }))("7"))
      expect(Exit.isFailure(exit)).toBe(true)
    })
  )
})
