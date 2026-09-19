import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import { Effect, Exit, Result } from "effect"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import * as Field from "../../src/protocol/Field.ts"
import { decodeHeader, headerLength } from "../../src/protocol/Header.ts"
import { type CommandAccepted, commandAccepted } from "../../src/protocol/Messages.ts"
import * as Mid from "../../src/protocol/Mid.ts"

// Illustrative definitions: the layouts are made up for the test, not taken
// from the Open Protocol specification.
const selected = [["parameterSetId", Field.digits({ width: 3 })]] as const

const ParameterSetSelected = Mid.define({
  tag: "ParameterSetSelected",
  mid: 15,
  revisions: {
    1: Field.layout(selected),
    2: Field.layout([...selected, ["name", Field.text({ width: 10 })]])
  }
})

class JobSelected extends S.TaggedClass<JobSelected>()("JobSelected", {
  revision: S.tag(1),
  jobId: S.Number
}) {}

const Job = Mid.define({
  tag: "JobSelected",
  mid: 35,
  revisions: { 1: Mid.as(JobSelected, Field.layout([["jobId", Field.digits({ width: 4 })]])) }
})

const SelectParameterSet = Mid.request(
  Mid.define({ tag: "SelectParameterSet", mid: 18, revisions: { 1: Field.layout(selected) } }),
  { 1: commandAccepted }
)

const AskParameterSet = Mid.request(
  Mid.define({ tag: "AskParameterSet", mid: 14, revisions: { 1: Field.layout([]), 2: Field.layout([]) } }),
  { 1: ParameterSetSelected.rev(1), 2: ParameterSetSelected.rev(2) }
)

const dataOf = (frame: string): string => Str.substring(headerLength, Str.length(frame) - 1)(frame)

describe("Mid", () => {
  it("types each revision exactly", () => {
    expectTypeOf<Mid.Type<ReturnType<typeof ParameterSetSelected.rev<1>>>>().toEqualTypeOf<{
      readonly _tag: "ParameterSetSelected"
      readonly revision: 1
      readonly parameterSetId: number
    }>()
    expectTypeOf<Mid.Type<ReturnType<typeof ParameterSetSelected.rev<2>>>>().toEqualTypeOf<{
      readonly _tag: "ParameterSetSelected"
      readonly revision: 2
      readonly parameterSetId: number
      readonly name: string
    }>()
    expectTypeOf<Mid.Type<ReturnType<typeof Job.rev<1>>>>().toEqualTypeOf<JobSelected>()
    expectTypeOf(AskParameterSet.rev(2).reply).toEqualTypeOf(ParameterSetSelected.rev(2))
    expectTypeOf(SelectParameterSet.rev(1).reply).toEqualTypeOf<Mid.Reply<CommandAccepted>>()
    expect(ParameterSetSelected.revisions).toEqual([1, 2])

    // @ts-expect-error revision 3 is not declared
    expect(() => ParameterSetSelected.rev(3)).toBeDefined()
  })

  it("rejects a class whose tag or revision disagrees with its declaration", () => {
    const jobLayout = Field.layout([["jobId", Field.digits({ width: 4 })]])

    expect(() =>
      // @ts-expect-error JobSelected is tagged "JobSelected", not "Job"
      Mid.define({ tag: "Job", mid: 36, revisions: { 1: Mid.as(JobSelected, jobLayout) } })
    ).toBeDefined()
    expect(() =>
      // @ts-expect-error JobSelected is revision 1, declared here as 2
      Mid.define({ tag: "JobSelected", mid: 37, revisions: { 2: Mid.as(JobSelected, jobLayout) } })
    ).toBeDefined()
  })

  it("returns the same revision, reply included, from rev and lookup", () => {
    const first = AskParameterSet.rev(1)

    expect(AskParameterSet.rev(1)).toBe(first)
    expect(O.getOrThrow(AskParameterSet.lookup(1))).toBe(first)
    expect(first.reply).toBe(ParameterSetSelected.rev(1))
    expect(ParameterSetSelected.rev(2)).toBe(ParameterSetSelected.rev(2))
  })

  it.effect("round trips every revision through a frame", () =>
    Effect.gen(function* () {
      const second = ParameterSetSelected.rev(2)
      const value = second.codec.make({ parameterSetId: 7, name: "tight" })
      const frame = yield* Effect.fromResult(Mid.encode(second, value))
      const header = yield* Effect.fromResult(decodeHeader(frame))

      expect(header.mid).toBe(15)
      expect(header.revision).toBe(2)
      expect(dataOf(frame)).toBe("007tight     ")
      expect(yield* Mid.decode(second, dataOf(frame))).toEqual(value)
    })
  )

  it.effect("decodes a class-backed revision into instances", () =>
    Effect.gen(function* () {
      const frame = yield* Effect.fromResult(Mid.encode(Job.rev(1), new JobSelected({ jobId: 12 })))
      const decoded = yield* Mid.decode(Job.rev(1), dataOf(frame))

      expect(dataOf(frame)).toBe("0012")
      expect(decoded).toBeInstanceOf(JobSelected)
      expect(decoded).toEqual(new JobSelected({ jobId: 12 }))
    })
  )

  it("refuses a value that does not fit, when built and when encoded", () => {
    const first = ParameterSetSelected.rev(1)

    expect(O.isNone(first.codec.makeOption({ parameterSetId: 1234 }))).toBe(true)
    expect(
      Result.isFailure(Mid.encode(first, first.codec.make({ parameterSetId: 1234 }, { disableChecks: true })))
    ).toBe(true)
  })

  it.effect("reports a body that does not decode", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Mid.decode(ParameterSetSelected.rev(1), "0x7"))

      expect(Exit.isFailure(exit)).toBe(true)
    })
  )
})
