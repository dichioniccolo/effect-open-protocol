import { describe, expect, it } from "@effect/vitest"
import { assertFailure, assertSuccess } from "@effect/vitest/utils"
import { Effect, Predicate } from "effect"
import * as A from "effect/Array"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { decodeHeader, encodeHeader, Header } from "../../src/protocol/Header.ts"
import {
  AcknowledgeResult,
  CommandAccepted,
  CommandAcceptedMid,
  CommandError,
  CommunicationStart,
  CommunicationStartAccepted,
  CommunicationStop,
  decodeMessage,
  encodeMessage,
  KeepAlive,
  LastResult,
  builtIns,
  type Message,
  OldResult,
  RequestOldResult,
  SubscribeResults,
  UnknownMessage,
  UnsubscribeResults
} from "../../src/protocol/Messages.ts"
import * as Mid from "../../src/protocol/Mid.ts"
import { MalformedHeader, UnsupportedFeature } from "../../src/protocol/ProtocolError.ts"
import {
  ControllerTimestamp,
  DeviceId,
  LimitStatus,
  TighteningId,
  TighteningResult,
  TighteningStatus
} from "../../src/protocol/TighteningResult.ts"

const deviceId = DeviceId.make("tool-1")

const result = (fields: {
  readonly tighteningId: number
  readonly torque: number
  readonly angle: number
  readonly status: typeof TighteningStatus.Type
  readonly torqueStatus: typeof LimitStatus.Type
  readonly angleStatus: typeof LimitStatus.Type
  readonly vin: string
  readonly parameterSetId: number
}): TighteningResult =>
  new TighteningResult({
    deviceId,
    tighteningId: TighteningId.make(fields.tighteningId),
    vin: fields.vin,
    parameterSetId: fields.parameterSetId,
    status: fields.status,
    torqueStatus: fields.torqueStatus,
    angleStatus: fields.angleStatus,
    torque: fields.torque,
    angle: fields.angle,
    timestamp: ControllerTimestamp.make("2026-09-17:10:14:16")
  })

const sample = result({
  tighteningId: 1234567,
  torque: 12.34,
  angle: 90,
  status: "OK",
  torqueStatus: "OK",
  angleStatus: "High",
  vin: "VIN000123",
  parameterSetId: 7
})

const messages: ReadonlyArray<Message> = [
  new CommunicationStart(),
  new CommunicationStartAccepted({ cellId: 1, channelId: 2, controllerName: "Airbag1" }),
  new CommunicationStop(),
  new CommandError({ mid: 18, code: 2 }),
  new CommandAccepted({ mid: 60 }),
  new SubscribeResults(),
  new LastResult({ result: sample }),
  new AcknowledgeResult(),
  new UnsubscribeResults(),
  new RequestOldResult({ tighteningId: TighteningId.make(0) }),
  new OldResult({ result: sample }),
  new KeepAlive(),
  new UnknownMessage({ mid: 900, revision: 1, data: "payload" })
]

const withoutTerminator = (frame: string): string => Str.substring(0, Str.length(frame) - 1)(frame)

const torqueValue = S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 999999 }))

const angleValue = S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99999 }))

const idValue = S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 4294967295 }))

describe("Header", () => {
  it("treats blank revision, station and spindle as their defaults", () => {
    assertSuccess(
      decodeHeader("00209999            "),
      new Header({ length: 20, mid: 9999, revision: 1, noAck: false, stationId: 1, spindleId: 1 })
    )
  })

  it("rejects link level sequence numbers", () => {
    assertFailure(
      decodeHeader("0020" + "9999" + "   " + " " + "  " + "  " + "01" + " " + " "),
      new UnsupportedFeature({ feature: "sequenceNumber", value: "01" })
    )
  })

  it("rejects message linking", () => {
    assertFailure(
      decodeHeader("0020" + "9999" + "   " + " " + "  " + "  " + "  " + "2" + "1"),
      new UnsupportedFeature({ feature: "messageParts", value: "2" })
    )
  })

  it("rejects a short header", () => {
    assertFailure(decodeHeader("0020"), new MalformedHeader({ field: "header", value: "0020" }))
  })

  it("round trips", () => {
    const header = new Header({ length: 42, mid: 61, revision: 1, noAck: false, stationId: 3, spindleId: 4 })
    assertSuccess(decodeHeader(encodeHeader(header)), header)
  })
})

const roundTrip = (message: Message) => decodeMessage(withoutTerminator(encodeMessage(message)), deviceId)

describe("Messages", () => {
  it.effect("round trips every supported message", () =>
    Effect.forEach(messages, (message) => Effect.map(roundTrip(message), (decoded) => expect(decoded).toEqual(message)))
  )

  it("gives every modelled message its own MID from the defined ones", () => {
    const defined = A.map(builtIns, (definition) => definition.mid)

    const mids = A.map(
      A.filter(messages, (message) => !Predicate.isTagged(message, "UnknownMessage")),
      (message) => Number(Str.substring(4, 8)(encodeMessage(message)))
    )

    A.forEach(mids, (mid) => expect(defined).toContain(mid))
    expect(A.length(A.dedupe(mids))).toBe(A.length(mids))
    expect(A.length(A.dedupe(defined))).toBe(A.length(defined))
  })

  it("announces a length that excludes the terminator", () => {
    const frame = encodeMessage(new KeepAlive())
    expect(Str.substring(0, 4)(frame)).toBe("0020")
    expect(Str.length(frame)).toBe(21)
  })

  it.effect("keeps an unsupported MID as an unknown message", () =>
    Effect.map(decodeMessage("00229900001         ab", deviceId), (decoded) =>
      expect(decoded).toEqual(new UnknownMessage({ mid: 9900, revision: 1, data: "ab" }))
    )
  )

  it.effect.prop(
    "round trips tightening results",
    [idValue, torqueValue, angleValue],
    ([tighteningId, torque, angle]) => {
      const message = new LastResult({
        result: result({
          tighteningId,
          torque: torque / 100,
          angle,
          status: "NOK",
          torqueStatus: "Low",
          angleStatus: "OK",
          vin: "VIN000123",
          parameterSetId: 12
        })
      })

      return Effect.map(roundTrip(message), (decoded) => expect(decoded).toEqual(message))
    }
  )

  it.effect.prop("round trips old results", [idValue, torqueValue, angleValue], ([tighteningId, torque, angle]) => {
    const message = new OldResult({
      result: result({
        tighteningId,
        torque: torque / 100,
        angle,
        status: "OK",
        torqueStatus: "High",
        angleStatus: "Low",
        vin: "",
        parameterSetId: 0
      })
    })

    return Effect.map(roundTrip(message), (decoded) => expect(decoded).toEqual(message))
  })

  it.effect("keeps a result whose data field does not decode as an unknown message", () =>
    Effect.gen(function* () {
      const frame = withoutTerminator(encodeMessage(new LastResult({ result: sample })))
      const truncated = Str.substring(0, Str.length(frame) - 4)(frame)
      const decoded = yield* decodeMessage(truncated, deviceId)

      expect(decoded).toEqual(
        new UnknownMessage({ mid: 61, revision: 1, data: Str.substring(20, Str.length(truncated))(truncated) })
      )
    })
  )

  it.effect("keeps a revision the library does not define as an unknown message", () =>
    Effect.map(decodeMessage("00229999002         ab", deviceId), (decoded) =>
      expect(decoded).toEqual(new UnknownMessage({ mid: 9999, revision: 2, data: "ab" }))
    )
  )

  it("writes the message's revision into the header", () => {
    const frame = encodeMessage(new CommandAccepted({ mid: 60 }))

    expect(Str.substring(8, 11)(frame)).toBe("001")
    assertSuccess(Mid.encode(CommandAcceptedMid.rev(1), new CommandAccepted({ mid: 60 })), frame)
  })
})
