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
import * as S from "effect/Schema"
import * as Str from "effect/String"
import * as Field from "./Field.ts"
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

const limitStatus = (id: string) => Field.enumerated({ id, width: 1, literals: LimitStatus })

/**
 * The MID 0061 revision 1 data field. Parameters this library does not model
 * are fillers; parameter 21 (last change of the parameter set) is written with
 * the tightening timestamp and ignored on decode.
 *
 * @category layouts
 * @since 0.0.0
 */
export const LastResultBody = Field.layout([
  Field.filler({ id: "01", width: 4, value: "0001" }),
  Field.filler({ id: "02", width: 2, value: "01" }),
  Field.filler({ id: "03", width: 25, value: Str.repeat(25)(" ") }),
  ["vin", Field.text({ id: "04", width: 25 })],
  Field.filler({ id: "05", width: 2 }),
  ["parameterSetId", Field.digits({ id: "06", width: 3 })],
  Field.filler({ id: "07", width: 4 }),
  Field.filler({ id: "08", width: 4 }),
  ["status", Field.enumerated({ id: "09", width: 1, literals: TighteningStatus })],
  ["torqueStatus", limitStatus("10")],
  ["angleStatus", limitStatus("11")],
  Field.filler({ id: "12", width: 6 }),
  Field.filler({ id: "13", width: 6 }),
  Field.filler({ id: "14", width: 6 }),
  ["torque", Field.digits({ id: "15", width: 6 })],
  Field.filler({ id: "16", width: 5 }),
  Field.filler({ id: "17", width: 5 }),
  Field.filler({ id: "18", width: 5 }),
  ["angle", Field.digits({ id: "19", width: 5 })],
  ["timestamp", Field.raw({ id: "20", width: 19, schema: ControllerTimestamp })],
  ["parameterSetChangedAt", Field.raw({ id: "21", width: 19 })],
  Field.filler({ id: "22", width: 1, value: "2" }),
  ["tighteningId", Field.digits({ id: "23", width: 10, schema: TighteningId })]
])

/**
 * The MID 0065 revision 1 data field.
 *
 * @category layouts
 * @since 0.0.0
 */
export const OldResultBody = Field.layout([
  ["tighteningId", Field.digits({ id: "01", width: 10, schema: TighteningId })],
  ["vin", Field.text({ id: "02", width: 25 })],
  ["parameterSetId", Field.digits({ id: "03", width: 3 })],
  Field.filler({ id: "04", width: 4 }),
  ["status", Field.enumerated({ id: "05", width: 1, literals: TighteningStatus })],
  ["torqueStatus", limitStatus("06")],
  ["angleStatus", limitStatus("07")],
  ["torque", Field.digits({ id: "08", width: 6 })],
  ["angle", Field.digits({ id: "09", width: 5 })],
  ["timestamp", Field.raw({ id: "10", width: 19, schema: ControllerTimestamp })],
  Field.filler({ id: "11", width: 1, value: "2" })
])

/**
 * What both layouts carry of a result: everything but the device, which never
 * travels on the wire, with the torque in hundredths of a newton metre.
 *
 * @category models
 * @since 0.0.0
 */
export interface ResultFields {
  readonly tighteningId: TighteningId
  readonly vin: string
  readonly parameterSetId: number
  readonly status: TighteningStatus
  readonly torqueStatus: LimitStatus
  readonly angleStatus: LimitStatus
  readonly torque: number
  readonly angle: number
  readonly timestamp: ControllerTimestamp
}

/**
 * Builds the domain result from what a layout decoded, stamping the device it
 * came from.
 *
 * @category decoding
 * @since 0.0.0
 */
export const resultFrom = (deviceId: DeviceId, fields: ResultFields): Result.Result<TighteningResult, S.SchemaError> =>
  S.decodeResult(TighteningResult)({
    deviceId,
    tighteningId: fields.tighteningId,
    vin: fields.vin,
    parameterSetId: fields.parameterSetId,
    status: fields.status,
    torqueStatus: fields.torqueStatus,
    angleStatus: fields.angleStatus,
    torque: fields.torque / 100,
    angle: fields.angle,
    timestamp: fields.timestamp
  })

/**
 * The layout fields of a domain result, torque back in hundredths.
 *
 * @category encoding
 * @since 0.0.0
 */
export const fieldsOf = (result: TighteningResult): ResultFields => ({
  tighteningId: result.tighteningId,
  vin: result.vin,
  parameterSetId: result.parameterSetId,
  status: result.status,
  torqueStatus: result.torqueStatus,
  angleStatus: result.angleStatus,
  torque: Math.round(result.torque * 100),
  angle: result.angle,
  timestamp: result.timestamp
})

const decodeError = (mid: number) => (error: S.SchemaError) => new PayloadDecodeError({ mid, reason: error.message })

/**
 * @category decoding
 * @since 0.0.0
 */
export const decodeLastResult = (
  deviceId: DeviceId,
  data: string
): Result.Result<TighteningResult, PayloadDecodeError> =>
  pipe(
    S.decodeResult(LastResultBody)(data),
    Result.flatMap((fields) => resultFrom(deviceId, fields)),
    Result.mapError(decodeError(61))
  )

/**
 * @category decoding
 * @since 0.0.0
 */
export const decodeOldResult = (
  deviceId: DeviceId,
  data: string
): Result.Result<TighteningResult, PayloadDecodeError> =>
  pipe(
    S.decodeResult(OldResultBody)(data),
    Result.flatMap((fields) => resultFrom(deviceId, fields)),
    Result.mapError(decodeError(65))
  )

/**
 * @category encoding
 * @since 0.0.0
 */
export const encodeLastResult = (result: TighteningResult): string =>
  Result.getOrThrowWith(
    S.encodeResult(LastResultBody)({ ...fieldsOf(result), parameterSetChangedAt: result.timestamp }),
    decodeError(61)
  )

/**
 * @category encoding
 * @since 0.0.0
 */
export const encodeOldResult = (result: TighteningResult): string =>
  Result.getOrThrowWith(S.encodeResult(OldResultBody)(fieldsOf(result)), decodeError(65))
