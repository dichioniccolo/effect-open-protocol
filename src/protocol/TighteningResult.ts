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
export const TighteningId = S.Number.check(
  S.isInt(),
  S.isBetween({ minimum: 0, maximum: 4294967295 })
).pipe(S.brand("TighteningId")).annotate({
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
      A.every(
        [...value],
        (char, index) =>
          A.contains([4, 7, 10, 13, 16], index) ? char === "-" || char === ":" : char >= "0" && char <= "9"
      ),
    {
      identifier: "ControllerTimestamp",
      title: "controller timestamp",
      description: "a controller local timestamp formatted as YYYY-MM-DD:HH:MM:SS"
    }
  )
).pipe(S.brand("ControllerTimestamp")).annotate({
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
export class TighteningResult extends S.Class<TighteningResult>("TighteningResult")({
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
}, { description: "One tightening reported by a controller" }) {}

interface Scan {
  readonly offset: number
  readonly values: ReadonlyArray<string>
}

/** A parameter slot inside a fixed MID layout: its id and value width. */
interface Slot {
  readonly id: string
  readonly width: number
}

const slot = (id: string, width: number): Slot => ({ id, width })

const emptyScan: Result.Result<Scan, PayloadDecodeError> = Result.succeed({ offset: 0, values: [] })

const readSlots = (
  mid: number,
  data: string,
  slots: ReadonlyArray<Slot>
): Result.Result<ReadonlyArray<string>, PayloadDecodeError> =>
  pipe(
    A.reduce(
      slots,
      emptyScan,
      (accumulated, current) =>
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
            ? Result.fail(
              new PayloadDecodeError({ mid, reason: `parameter ${current.id} is truncated` })
            )
            : Result.succeed({
              offset: offset + 2 + current.width,
              values: A.append(values, value)
            })
        })
    ),
    Result.map(({ values }) => values)
  )

const digitsValue = (
  mid: number,
  parameter: string,
  raw: string
): Result.Result<number, PayloadDecodeError> =>
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
        Result.fromOption(
          () => new PayloadDecodeError({ mid, reason: `parameter ${parameter} has value ${raw}` })
        )
      )
    )
  )

const decodeWith = (
  mid: number,
  slots: ReadonlyArray<Slot>,
  pick: {
    readonly tighteningId: number
    readonly vin: number
    readonly parameterSetId: number
    readonly status: number
    readonly torqueStatus: number
    readonly angleStatus: number
    readonly torque: number
    readonly angle: number
    readonly timestamp: number
  }
) =>
(deviceId: DeviceId, data: string): Result.Result<TighteningResult, PayloadDecodeError> =>
  Result.gen(function* () {
    const values = yield* readSlots(mid, data, slots)
    const at = (index: number): string => pipe(A.get(values, index), O.getOrElse(() => ""))
    const tighteningId = yield* digitsValue(mid, "tighteningId", at(pick.tighteningId))
    const parameterSetId = yield* digitsValue(mid, "parameterSetId", at(pick.parameterSetId))
    const status = yield* enumValue(mid, "status", at(pick.status), TighteningStatus.literals)
    const torqueStatus = yield* enumValue(mid, "torqueStatus", at(pick.torqueStatus), LimitStatus.literals)
    const angleStatus = yield* enumValue(mid, "angleStatus", at(pick.angleStatus), LimitStatus.literals)
    const torqueCentiNm = yield* digitsValue(mid, "torque", at(pick.torque))
    const angle = yield* digitsValue(mid, "angle", at(pick.angle))
    const timestamp = at(pick.timestamp)
    return yield* pipe(
      S.decodeResult(TighteningResult)({
        deviceId,
        tighteningId,
        vin: Str.trimEnd(at(pick.vin)),
        parameterSetId,
        status,
        torqueStatus,
        angleStatus,
        torque: torqueCentiNm / 100,
        angle,
        timestamp
      }),
      Result.mapError((issue) => new PayloadDecodeError({ mid, reason: `${issue}` }))
    )
  })

const tighteningResultSlots: ReadonlyArray<Slot> = [
  slot("01", 4),
  slot("02", 2),
  slot("03", 25),
  slot("04", 25),
  slot("05", 2),
  slot("06", 3),
  slot("07", 4),
  slot("08", 4),
  slot("09", 1),
  slot("10", 1),
  slot("11", 1),
  slot("12", 6),
  slot("13", 6),
  slot("14", 6),
  slot("15", 6),
  slot("16", 5),
  slot("17", 5),
  slot("18", 5),
  slot("19", 5),
  slot("20", 19),
  slot("21", 19),
  slot("22", 1),
  slot("23", 10)
]

const oldResultSlots: ReadonlyArray<Slot> = [
  slot("01", 10),
  slot("02", 25),
  slot("03", 3),
  slot("04", 4),
  slot("05", 1),
  slot("06", 1),
  slot("07", 1),
  slot("08", 6),
  slot("09", 5),
  slot("10", 19),
  slot("11", 1)
]

/**
 * Decodes the data field of MID 0061 revision 1.
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeLastResult = decodeWith(61, tighteningResultSlots, {
  tighteningId: 22,
  vin: 3,
  parameterSetId: 5,
  status: 8,
  torqueStatus: 9,
  angleStatus: 10,
  torque: 14,
  angle: 18,
  timestamp: 19
})

/**
 * Decodes the data field of MID 0065 revision 1.
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeOldResult = decodeWith(65, oldResultSlots, {
  tighteningId: 0,
  vin: 1,
  parameterSetId: 2,
  status: 4,
  torqueStatus: 5,
  angleStatus: 6,
  torque: 7,
  angle: 8,
  timestamp: 9
})

const statusIndex = <A extends string>(values: ReadonlyArray<A>, value: A): number =>
  pipe(A.findFirstIndex(values, (candidate) => candidate === value), O.getOrElse(() => 0))

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
export const encodeLastResult = (result: TighteningResult): string =>
  "01" + padNumber(1, 4) +
  "02" + padNumber(1, 2) +
  "03" + padText("", 25) +
  "04" + padText(result.vin, 25) +
  "05" + padNumber(0, 2) +
  "06" + padNumber(result.parameterSetId, 3) +
  "07" + padNumber(0, 4) +
  "08" + padNumber(0, 4) +
  "09" + padNumber(statusIndex(TighteningStatus.literals, result.status), 1) +
  "10" + padNumber(statusIndex(LimitStatus.literals, result.torqueStatus), 1) +
  "11" + padNumber(statusIndex(LimitStatus.literals, result.angleStatus), 1) +
  "12" + padNumber(0, 6) +
  "13" + padNumber(0, 6) +
  "14" + padNumber(0, 6) +
  "15" + padNumber(result.torque * 100, 6) +
  "16" + padNumber(0, 5) +
  "17" + padNumber(0, 5) +
  "18" + padNumber(0, 5) +
  "19" + padNumber(result.angle, 5) +
  "20" + result.timestamp +
  "21" + result.timestamp +
  "22" + padNumber(2, 1) +
  "23" + padNumber(result.tighteningId, 10)

/**
 * Renders a result as the data field of MID 0065 revision 1.
 *
 * @category encoding
 * @since 0.0.0
 */
export const encodeOldResult = (result: TighteningResult): string =>
  "01" + padNumber(result.tighteningId, 10) +
  "02" + padText(result.vin, 25) +
  "03" + padNumber(result.parameterSetId, 3) +
  "04" + padNumber(0, 4) +
  "05" + padNumber(statusIndex(TighteningStatus.literals, result.status), 1) +
  "06" + padNumber(statusIndex(LimitStatus.literals, result.torqueStatus), 1) +
  "07" + padNumber(statusIndex(LimitStatus.literals, result.angleStatus), 1) +
  "08" + padNumber(result.torque * 100, 6) +
  "09" + padNumber(result.angle, 5) +
  "10" + result.timestamp +
  "11" + padNumber(2, 1)
