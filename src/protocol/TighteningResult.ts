/**
 * The tightening result domain model and its two wire layouts.
 *
 * MID 0061 revision 1 (push after every tightening) and MID 0065 revision 1
 * (reply to an old-result request) carry the same facts in different parameter
 * slots. Both decode into `TighteningResult`.
 *
 * @since 0.0.0
 */
import { pipe, Result } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { padNumber, padText, parseDigits } from "./Ascii.ts"
import { PayloadDecodeError } from "./ProtocolError.ts"

/**
 * Identifier of the device a result came from. Assigned by this library, not
 * carried on the wire.
 *
 * @category models
 * @since 0.0.0
 */
export const DeviceId = S.String.check(S.isMinLength(1)).pipe(S.brand("DeviceId")).annotate({
  identifier: "DeviceId",
  description: "Identifier of a configured controller"
})

/**
 * @category models
 * @since 0.0.0
 */
export type DeviceId = typeof DeviceId.Type

/**
 * Controller-assigned identifier of a tightening, incremented per result.
 *
 * @category models
 * @since 0.0.0
 */
export const TighteningId = S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 4294967295 }))
  .pipe(S.brand("TighteningId"))
  .annotate({
    identifier: "TighteningId",
    description: "Unique incrementing identifier of a tightening result"
  })

/**
 * @category models
 * @since 0.0.0
 */
export type TighteningId = typeof TighteningId.Type

/**
 * Controller local timestamp, `YYYY-MM-DD:HH:MM:SS`, without time zone.
 *
 * @category models
 * @since 0.0.0
 */
export const ControllerTimestamp = S.String.check(
  S.makeFilter(
    (value) =>
      Str.length(value) === 19 &&
      A.every([...value], (char, index) =>
        A.contains([4, 7, 10, 13, 16], index) ? char === "-" || char === ":" : char >= "0" && char <= "9"
      ),
    {
      identifier: "ControllerTimestamp",
      title: "controller timestamp",
      description: "a controller local timestamp formatted as YYYY-MM-DD:HH:MM:SS"
    }
  )
)
  .pipe(S.brand("ControllerTimestamp"))
  .annotate({
    identifier: "ControllerTimestamp",
    description: "Controller local timestamp without time zone"
  })

/**
 * @category models
 * @since 0.0.0
 */
export type ControllerTimestamp = typeof ControllerTimestamp.Type

/**
 * Overall verdict of a tightening.
 *
 * @category models
 * @since 0.0.0
 */
export const TighteningStatus = S.Literals(["NOK", "OK"]).annotate({
  identifier: "TighteningStatus",
  description: "Whether the tightening met its program"
})

/**
 * @category models
 * @since 0.0.0
 */
export type TighteningStatus = typeof TighteningStatus.Type

/**
 * Where a measured value landed relative to its limits.
 *
 * @category models
 * @since 0.0.0
 */
export const LimitStatus = S.Literals(["Low", "OK", "High"]).annotate({
  identifier: "LimitStatus",
  description: "Position of a measured value relative to its configured limits"
})

/**
 * @category models
 * @since 0.0.0
 */
export type LimitStatus = typeof LimitStatus.Type

/**
 * A single tightening result, the unit of traceability this library delivers.
 *
 * **Example** (Constructing a result)
 *
 * ```ts
 * import { ControllerTimestamp, DeviceId, TighteningId, TighteningResult } from "effect-open-protocol"
 *
 * const result = new TighteningResult({
 *   deviceId: DeviceId.make("line-1-tool-3"),
 *   tighteningId: TighteningId.make(42),
 *   vin: "VIN000123",
 *   parameterSetId: 3,
 *   status: "OK",
 *   torqueStatus: "OK",
 *   angleStatus: "OK",
 *   torque: 12.34,
 *   angle: 90,
 *   timestamp: ControllerTimestamp.make("2026-09-17:10:14:16")
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class TighteningResult extends S.Class<TighteningResult>("TighteningResult")(
  {
    deviceId: DeviceId,
    tighteningId: TighteningId,
    vin: S.String,
    parameterSetId: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 999 })),
    status: TighteningStatus,
    torqueStatus: LimitStatus,
    angleStatus: LimitStatus,
    torque: S.Number,
    angle: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99999 })),
    timestamp: ControllerTimestamp
  },
  { description: "One tightening reported by a controller" }
) {}

interface Scan {
  readonly offset: number
  readonly values: ReadonlyArray<string>
}

/** The fields of a result that a wire layout carries. */
type Field =
  | "tighteningId"
  | "vin"
  | "parameterSetId"
  | "status"
  | "torqueStatus"
  | "angleStatus"
  | "torque"
  | "angle"
  | "timestamp"

/**
 * A parameter slot inside a fixed MID layout: its id, its value width, the
 * field it carries when this library models one, and how it renders.
 *
 * A layout is declared once and read in both directions, so a slot cannot be
 * decoded at one width and encoded at another.
 */
interface Slot {
  readonly id: string
  readonly width: number
  readonly field: O.Option<Field>
  readonly render: (result: TighteningResult) => string
}

/** A slot this library does not model: it decodes to nothing and renders a neutral value. */
const unused = (id: string, width: number, render: (result: TighteningResult) => string): Slot => ({
  id,
  width,
  field: O.none(),
  render
})

const zeros = (id: string, width: number): Slot => unused(id, width, () => padNumber(0, width))

const digits = (id: string, width: number, field: Field, get: (result: TighteningResult) => number): Slot => ({
  id,
  width,
  field: O.some(field),
  render: (result) => padNumber(get(result), width)
})

const text = (id: string, width: number, field: Field, get: (result: TighteningResult) => string): Slot => ({
  id,
  width,
  field: O.some(field),
  render: (result) => padText(get(result), width)
})

/** A slot whose value is already exactly `width` characters, such as a timestamp. */
const verbatim = (id: string, width: number, field: Field, get: (result: TighteningResult) => string): Slot => ({
  id,
  width,
  field: O.some(field),
  render: get
})

const emptyScan: Result.Result<Scan, PayloadDecodeError> = Result.succeed({ offset: 0, values: [] })

const readSlots = (
  mid: number,
  data: string,
  slots: ReadonlyArray<Slot>
): Result.Result<ReadonlyArray<string>, PayloadDecodeError> =>
  pipe(
    A.reduce(slots, emptyScan, (accumulated, current) =>
      Result.flatMap(accumulated, ({ offset, values }) => {
        const id = Str.substring(offset, offset + 2)(data)
        const value = Str.substring(offset + 2, offset + 2 + current.width)(data)

        return id !== current.id
          ? Result.fail(
              new PayloadDecodeError({
                mid,
                reason: `expected parameter ${current.id} at offset ${offset}, found "${id}"`
              })
            )
          : Str.length(value) !== current.width
            ? Result.fail(new PayloadDecodeError({ mid, reason: `parameter ${current.id} is truncated` }))
            : Result.succeed({
                offset: offset + 2 + current.width,
                values: A.append(values, value)
              })
      })
    ),
    Result.map(({ values }) => values)
  )

const renderSlots =
  (slots: ReadonlyArray<Slot>) =>
  (result: TighteningResult): string =>
    A.join(
      A.map(slots, (slot) => slot.id + slot.render(result)),
      ""
    )

const digitsValue = (mid: number, parameter: string, raw: string): Result.Result<number, PayloadDecodeError> =>
  parseDigits(raw, () => new PayloadDecodeError({ mid, reason: `parameter ${parameter} is not numeric` }))

const enumValue = <A>(
  mid: number,
  parameter: string,
  raw: string,
  values: ReadonlyArray<A>
): Result.Result<A, PayloadDecodeError> =>
  pipe(
    digitsValue(mid, parameter, raw),
    Result.flatMap((index) =>
      pipe(
        A.get(values, index),
        Result.fromOption(() => new PayloadDecodeError({ mid, reason: `parameter ${parameter} has value ${raw}` }))
      )
    )
  )

const decodeWith = (mid: number, slots: ReadonlyArray<Slot>) => {
  const positions = new Map(
    A.getSomes(A.map(slots, (slot, index) => O.map(slot.field, (field) => [field, index] as const)))
  )

  return (deviceId: DeviceId, data: string): Result.Result<TighteningResult, PayloadDecodeError> =>
    Result.gen(function* () {
      const values = yield* readSlots(mid, data, slots)

      const at = (field: Field): string =>
        pipe(
          O.fromNullishOr(positions.get(field)),
          O.flatMap((index) => A.get(values, index)),
          O.getOrElse(() => "")
        )

      const tighteningId = yield* digitsValue(mid, "tighteningId", at("tighteningId"))
      const parameterSetId = yield* digitsValue(mid, "parameterSetId", at("parameterSetId"))
      const status = yield* enumValue(mid, "status", at("status"), TighteningStatus.literals)
      const torqueStatus = yield* enumValue(mid, "torqueStatus", at("torqueStatus"), LimitStatus.literals)
      const angleStatus = yield* enumValue(mid, "angleStatus", at("angleStatus"), LimitStatus.literals)
      const torqueCentiNm = yield* digitsValue(mid, "torque", at("torque"))
      const angle = yield* digitsValue(mid, "angle", at("angle"))

      return yield* pipe(
        S.decodeResult(TighteningResult)({
          deviceId,
          tighteningId,
          vin: Str.trimEnd(at("vin")),
          parameterSetId,
          status,
          torqueStatus,
          angleStatus,
          torque: torqueCentiNm / 100,
          angle,
          timestamp: at("timestamp")
        }),
        Result.mapError((issue) => new PayloadDecodeError({ mid, reason: `${issue}` }))
      )
    })
}

const statusIndex = <A extends string>(values: ReadonlyArray<A>, value: A): number =>
  pipe(
    A.findFirstIndex(values, (candidate) => candidate === value),
    O.getOrElse(() => 0)
  )

const tighteningResultSlots: ReadonlyArray<Slot> = [
  unused("01", 4, () => padNumber(1, 4)),
  unused("02", 2, () => padNumber(1, 2)),
  unused("03", 25, () => padText("", 25)),
  text("04", 25, "vin", (result) => result.vin),
  zeros("05", 2),
  digits("06", 3, "parameterSetId", (result) => result.parameterSetId),
  zeros("07", 4),
  zeros("08", 4),
  digits("09", 1, "status", (result) => statusIndex(TighteningStatus.literals, result.status)),
  digits("10", 1, "torqueStatus", (result) => statusIndex(LimitStatus.literals, result.torqueStatus)),
  digits("11", 1, "angleStatus", (result) => statusIndex(LimitStatus.literals, result.angleStatus)),
  zeros("12", 6),
  zeros("13", 6),
  zeros("14", 6),
  digits("15", 6, "torque", (result) => result.torque * 100),
  zeros("16", 5),
  zeros("17", 5),
  zeros("18", 5),
  digits("19", 5, "angle", (result) => result.angle),
  verbatim("20", 19, "timestamp", (result) => result.timestamp),
  // The layout carries the timestamp twice; only the first one is read back.
  unused("21", 19, (result) => result.timestamp),
  unused("22", 1, () => padNumber(2, 1)),
  digits("23", 10, "tighteningId", (result) => result.tighteningId)
]

const oldResultSlots: ReadonlyArray<Slot> = [
  digits("01", 10, "tighteningId", (result) => result.tighteningId),
  text("02", 25, "vin", (result) => result.vin),
  digits("03", 3, "parameterSetId", (result) => result.parameterSetId),
  zeros("04", 4),
  digits("05", 1, "status", (result) => statusIndex(TighteningStatus.literals, result.status)),
  digits("06", 1, "torqueStatus", (result) => statusIndex(LimitStatus.literals, result.torqueStatus)),
  digits("07", 1, "angleStatus", (result) => statusIndex(LimitStatus.literals, result.angleStatus)),
  digits("08", 6, "torque", (result) => result.torque * 100),
  digits("09", 5, "angle", (result) => result.angle),
  verbatim("10", 19, "timestamp", (result) => result.timestamp),
  unused("11", 1, () => padNumber(2, 1))
]

/**
 * Decodes the data field of MID 0061 revision 1.
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeLastResult = decodeWith(61, tighteningResultSlots)

/**
 * Decodes the data field of MID 0065 revision 1.
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeOldResult = decodeWith(65, oldResultSlots)

/**
 * Renders a result as the data field of MID 0061 revision 1.
 *
 * Fields this library does not model (limits, batch, job, cell and channel
 * identifiers) are filled with neutral values, so a round trip through
 * `decodeLastResult` returns an equal `TighteningResult`.
 *
 * @category encoding
 * @since 0.0.0
 */
export const encodeLastResult: (result: TighteningResult) => string = renderSlots(tighteningResultSlots)

/**
 * Renders a result as the data field of MID 0065 revision 1.
 *
 * @category encoding
 * @since 0.0.0
 */
export const encodeOldResult: (result: TighteningResult) => string = renderSlots(oldResultSlots)
