import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe, Queue, Ref, Stream } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import { terminator } from "../../src/protocol/Header.ts"
import { encodeMessage, KeepAlive, SubscribeResults } from "../../src/protocol/Messages.ts"
import type { Duplex } from "../../src/transport/Transport.ts"
import { ConnectionLost } from "../../src/transport/Transport.ts"
import { escapeWire, unescapeWire } from "../../src/transport/WireEscape.ts"
import { tracedDuplex, type WireEvent, wireEventLine } from "../../src/transport/WireTrace.ts"

const encoder = new TextEncoder()

const byteValues = S.Array(S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 255 })))

/** A duplex whose reads come from `incoming` and whose writes land in a ref. */
const fixture = Effect.fnUntraced(function* (incoming: ReadonlyArray<Uint8Array>) {
  const written = yield* Ref.make<ReadonlyArray<Uint8Array>>([])
  const events = yield* Ref.make<ReadonlyArray<WireEvent>>([])
  const duplex: Duplex = {
    incoming: Stream.fromIterable(incoming),
    send: (bytes) => Ref.update(written, (current) => A.append(current, bytes))
  }
  const traced = yield* tracedDuplex(duplex, {
    source: "test",
    sink: (event) => Ref.update(events, (current) => A.append(current, event))
  })
  return { traced, written, events }
})

const kindsOf = (events: ReadonlyArray<WireEvent>, kind: WireEvent["kind"]): ReadonlyArray<WireEvent> =>
  A.filter(events, (event) => event.kind === kind)

describe("WireEscape", () => {
  it("escapes the bytes a terminal must not receive raw", () => {
    expect(escapeWire(encoder.encode(`00209999${terminator}`))).toBe("00209999\\0")
    expect(escapeWire(Uint8Array.from([92, 9, 10, 13, 1]))).toBe("\\\\\\t\\n\\r\\x01")
  })

  it("leaves field padding countable", () => {
    expect(escapeWire(encoder.encode("AB   "))).toBe("AB   ")
  })

  it.prop("round trips every byte sequence", [byteValues], ([values]) => {
    const bytes = Uint8Array.from(values)
    expect(A.fromIterable(unescapeWire(escapeWire(bytes)))).toEqual(A.fromIterable(bytes))
  })
})

describe("tracedDuplex", () => {
  it.effect("traces a chunk and the frame it completes", () =>
    Effect.gen(function* () {
      const wire = encodeMessage(new KeepAlive())
      const { events, traced } = yield* fixture([encoder.encode(wire)])
      yield* Stream.runDrain(traced.incoming)

      const recorded = yield* Ref.get(events)
      expect(A.length(kindsOf(recorded, "chunk"))).toBe(1)

      const frames = kindsOf(recorded, "frame")
      expect(A.length(frames)).toBe(1)
      const frame = yield* Effect.fromOption(A.head(frames))
      expect(frame.direction).toBe("recv")
      expect(frame.mid).toStrictEqual(O.some("9999"))
      expect(frame.bytes).toBe(21)
      expect(unescapeWire(frame.raw)).toEqual(encoder.encode(wire))
    }))

  it.effect("keeps a split frame as three chunks and one frame", () =>
    Effect.gen(function* () {
      const wire = encodeMessage(new SubscribeResults())
      const pieces = [wire.slice(0, 7), wire.slice(7, 15), wire.slice(15)]
      const { events, traced } = yield* fixture(A.map(pieces, (piece) => encoder.encode(piece)))
      yield* Stream.runDrain(traced.incoming)

      const recorded = yield* Ref.get(events)
      expect(A.length(kindsOf(recorded, "chunk"))).toBe(3)
      expect(A.length(kindsOf(recorded, "frame"))).toBe(1)
    }))

  it.effect("keeps a coalesced read as one chunk and two frames", () =>
    Effect.gen(function* () {
      const wire = encodeMessage(new KeepAlive()) + encodeMessage(new SubscribeResults())
      const { events, traced } = yield* fixture([encoder.encode(wire)])
      yield* Stream.runDrain(traced.incoming)

      const recorded = yield* Ref.get(events)
      expect(A.length(kindsOf(recorded, "chunk"))).toBe(1)
      expect(A.map(kindsOf(recorded, "frame"), (event) => event.mid)).toStrictEqual([
        O.some("9999"),
        O.some("0060")
      ])
    }))

  it.effect("forwards writes untouched and traces them as sends", () =>
    Effect.gen(function* () {
      const wire = encodeMessage(new KeepAlive())
      const { events, traced, written } = yield* fixture([])
      yield* traced.send(encoder.encode(wire))

      expect(yield* Ref.get(written)).toEqual([encoder.encode(wire)])
      const recorded = yield* Ref.get(events)
      expect(A.map(recorded, (event) => event.direction)).toEqual(["send", "send"])
      expect(A.map(recorded, (event) => event.kind)).toEqual(["chunk", "frame"])
    }))

  it.effect("keeps the two directions on separate reassembly buffers", () =>
    Effect.gen(function* () {
      const wire = encodeMessage(new KeepAlive())
      const { events, traced } = yield* fixture([encoder.encode(wire.slice(0, 10))])
      yield* traced.send(encoder.encode(wire))
      yield* Stream.runDrain(traced.incoming)

      // The half frame that arrived must not complete the one that was sent.
      const recorded = yield* Ref.get(events)
      expect(A.length(kindsOf(recorded, "frame"))).toBe(1)
      const frame = yield* Effect.fromOption(A.head(kindsOf(recorded, "frame")))
      expect(frame.direction).toBe("send")
    }))

  it.effect("survives a stream it cannot frame", () =>
    Effect.gen(function* () {
      const { events, traced } = yield* fixture([encoder.encode("not a frame at all")])
      yield* Stream.runDrain(traced.incoming)

      const recorded = yield* Ref.get(events)
      expect(A.length(kindsOf(recorded, "chunk"))).toBe(1)
      expect(A.length(kindsOf(recorded, "frame"))).toBe(0)
    }))

  it.effect("renders a trace line as one JSON object", () =>
    Effect.gen(function* () {
      const wire = encodeMessage(new KeepAlive())
      const { events, traced } = yield* fixture([encoder.encode(wire)])
      yield* Stream.runDrain(traced.incoming)

      const recorded = yield* Ref.get(events)
      const frame = yield* Effect.fromOption(A.head(kindsOf(recorded, "frame")))
      const line = yield* wireEventLine(frame)
      expect(line).toContain("\"kind\":\"frame\"")
      expect(line).toContain("\"mid\":\"9999\"")
    }))

  it.effect("passes a transport failure through untouched", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.bounded<Uint8Array, ConnectionLost>(1)
      yield* Queue.fail(queue, new ConnectionLost({ reason: "peer left" }))
      const traced = yield* tracedDuplex(
        { incoming: Stream.fromQueue(queue), send: () => Effect.void },
        { source: "test" }
      )
      const exit = yield* Effect.exit(Stream.runDrain(traced.incoming))
      expect(exit._tag).toBe("Failure")
    }))
})
