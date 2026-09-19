/**
 * The worked example of a user-defined MID: two revisions, a request whose
 * every revision declares its reply, and a typed exchange over the in-memory
 * transport. The definitions are in `ToolStatus.ts`.
 */
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import { Effect, Predicate } from "effect"
import * as O from "effect/Option"
import * as Str from "effect/String"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import { headerLength } from "../../src/protocol/Header.ts"
import * as Mid from "../../src/protocol/Mid.ts"
import { awaitReady, deviceId, endpoint, provided, scriptedController } from "./ScriptedController.ts"
import { ToolStatus, ToolStatusRequest } from "./ToolStatus.ts"

const statusOf = (toolId: number, revision: number) =>
  revision === 2
    ? Mid.encode(ToolStatus.rev(2), ToolStatus.rev(2).codec.make({ toolId, temperature: 412, motorHours: 1234 }))
    : Mid.encode(ToolStatus.rev(1), ToolStatus.rev(1).codec.make({ toolId, temperature: 412 }))

/** A controller that knows MID 9100 and answers it at the revision it was asked. */
const controller = scriptedController((header, data) =>
  header.mid !== 9100
    ? Effect.succeedNone
    : Effect.gen(function* () {
        const request = yield* O.match(ToolStatusRequest.lookup(header.revision), {
          onNone: () => Effect.die("unsupported revision"),
          onSome: (revision) => Effect.orDie(Mid.decode(revision, data))
        })

        const toolId = Predicate.hasProperty(request, "toolId") ? Number(request.toolId) : 0

        return yield* Effect.map(Effect.orDie(Effect.fromResult(statusOf(toolId, header.revision))), O.some)
      })
)

const dataOf = (frame: string) => Str.substring(headerLength, Str.length(frame) - 1)(frame)

describe("a user-defined MID", () => {
  it("has one exact type per revision, and so does its reply", () => {
    expectTypeOf<Mid.Type<ReturnType<typeof ToolStatus.rev<1>>>>().toEqualTypeOf<{
      readonly _tag: "ToolStatus"
      readonly revision: 1
      readonly toolId: number
      readonly temperature: number
    }>()
    expectTypeOf<Mid.Type<ReturnType<typeof ToolStatus.rev<2>>>>().toEqualTypeOf<{
      readonly _tag: "ToolStatus"
      readonly revision: 2
      readonly toolId: number
      readonly temperature: number
      readonly motorHours: number
    }>()
  })

  it.effect("round trips both revisions through frames", () =>
    Effect.gen(function* () {
      const values = [
        ToolStatus.rev(1).codec.make({ toolId: 7, temperature: 380 }),
        ToolStatus.rev(2).codec.make({ toolId: 7, temperature: 380, motorHours: 99 })
      ] as const

      const first = yield* Effect.fromResult(Mid.encode(ToolStatus.rev(1), values[0]))
      const second = yield* Effect.fromResult(Mid.encode(ToolStatus.rev(2), values[1]))

      expect(dataOf(first)).toBe("01007" + "020380")
      expect(dataOf(second)).toBe("01007" + "020380" + "03000099")
      expect(yield* Mid.decode(ToolStatus.rev(1), dataOf(first))).toEqual(values[0])
      expect(yield* Mid.decode(ToolStatus.rev(2), dataOf(second))).toEqual(values[1])
    })
  )

  it.effect("asks for each revision over the transport and gets exactly that revision back", () =>
    provided(
      Effect.gen(function* () {
        yield* controller
        const connection = yield* DeviceConnection.make({ id: deviceId, endpoint })
        yield* awaitReady(connection.state)

        const first = yield* connection.request(ToolStatusRequest.rev(1), { toolId: 7 })
        const second = yield* connection.request(ToolStatusRequest.rev(2), { toolId: 7 })

        expectTypeOf(first.revision).toEqualTypeOf<1>()
        expectTypeOf(second.motorHours).toEqualTypeOf<number>()
        expect(first).toEqual(ToolStatus.rev(1).codec.make({ toolId: 7, temperature: 412 }))
        expect(second).toEqual(ToolStatus.rev(2).codec.make({ toolId: 7, temperature: 412, motorHours: 1234 }))
      })
    )
  )
})
