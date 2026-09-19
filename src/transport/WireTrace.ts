/**
 * Watching the bytes go past.
 *
 * `Duplex` is the whole byte-level boundary of this library, so a decorator
 * that logs and forwards sees everything either side of a connection sends or
 * receives, without the connection, the codec or the simulator knowing it is
 * there. Both a client and a controller can wear it.
 *
 * Two kinds of line come out, because they answer different questions. A
 * `chunk` is what one socket read or write actually carried, which is how you
 * see fragmentation and coalescing. A `frame` is a complete Open Protocol
 * message reassembled from those chunks, which is how you read the
 * conversation. They sit on different log levels so one flag chooses the view.
 *
 * @since 0.0.0
 */
import { Effect, pipe, Ref, Stream } from "effect"
import * as DateTime from "effect/DateTime"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { step } from "../protocol/Framer.ts"
import { terminator } from "../protocol/Header.ts"
import type { Duplex } from "./Transport.ts"
import { escapeWire } from "./WireEscape.ts"

/**
 * Which way a traced byte was travelling.
 *
 * @category models
 * @since 0.0.0
 */
export const WireDirection = S.Literals(["send", "recv"]).annotate({
  identifier: "WireDirection",
  description: "Whether the traced bytes were written or read"
})

/**
 * @category models
 * @since 0.0.0
 */
export type WireDirection = typeof WireDirection.Type

/**
 * What a traced line describes: the bytes of one socket operation, or one
 * complete message reassembled from them.
 *
 * @category models
 * @since 0.0.0
 */
export const WireEventKind = S.Literals(["chunk", "frame"]).annotate({
  identifier: "WireEventKind",
  description: "Whether a traced line is a raw socket chunk or a complete frame"
})

/**
 * @category models
 * @since 0.0.0
 */
export type WireEventKind = typeof WireEventKind.Type

/**
 * One line of a wire trace.
 *
 * `raw` is the escaped rendering, so `unescapeWire(event.raw)` returns the
 * bytes the socket carried.
 *
 * **Example** (Building a trace line by hand)
 *
 * ```ts
 * import { Option } from "effect"
 * import { WireEvent } from "effect-open-protocol"
 *
 * const event = new WireEvent({
 *   at: "2026-09-18T10:14:16.312Z",
 *   source: "client",
 *   direction: "send",
 *   kind: "frame",
 *   bytes: 21,
 *   mid: Option.some("0001"),
 *   raw: "00200001001         \\0"
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class WireEvent extends S.Class<WireEvent>("WireEvent")(
  {
    at: S.String,
    source: S.String,
    direction: WireDirection,
    kind: WireEventKind,
    bytes: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
    mid: S.OptionFromNullOr(S.String),
    raw: S.String
  },
  { description: "One traced socket operation or reassembled frame" }
) {}

/**
 * Where traced lines go besides the log, when a caller wants them kept.
 *
 * @category models
 * @since 0.0.0
 */
export type WireSink = (event: WireEvent) => Effect.Effect<void>

/**
 * How a `Duplex` should be traced.
 *
 * @category models
 * @since 0.0.0
 */
export interface TraceOptions {
  /** Name of the side doing the tracing, stamped on every line. */
  readonly source: string
  /** Called for every line, after it is logged. Defaults to doing nothing. */
  readonly sink?: WireSink | undefined
}

/** The MID field of a frame, which is the four characters after the length. */
const midOf = (frame: string): O.Option<string> =>
  O.filter(O.some(Str.substring(4, 8)(frame)), (value) => Str.length(value) === 4)

const encoder = new TextEncoder()

const now = Effect.map(DateTime.now, DateTime.formatIso)

/**
 * Logs a frame at info and a chunk at debug, so `--log-level` picks between
 * reading the conversation and watching the socket.
 */
const record = (event: WireEvent): Effect.Effect<void> =>
  pipe(
    event.kind === "frame" ? Effect.logInfo("wire frame") : Effect.logDebug("wire chunk"),
    Effect.annotateLogs({
      source: event.source,
      dir: event.direction,
      bytes: event.bytes,
      mid: O.getOrElse(event.mid, () => "----"),
      raw: event.raw
    })
  )

/**
 * Traces one direction: the chunk as it crossed the socket, then every frame
 * that chunk completed.
 *
 * Framing errors are swallowed on purpose. The tracer observes, and the
 * session below it is the one that decides a corrupt stream ends a connection.
 */
const observe = (
  options: TraceOptions,
  buffer: Ref.Ref<string>,
  direction: WireDirection,
  bytes: Uint8Array
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const at = yield* now

    const emit = (event: WireEvent) =>
      pipe(
        record(event),
        Effect.andThen(
          O.match(O.fromNullishOr(options.sink), {
            onNone: () => Effect.void,
            onSome: (sink) => sink(event)
          })
        )
      )

    yield* emit(
      new WireEvent({
        at,
        source: options.source,
        direction,
        kind: "chunk",
        bytes: bytes.length,
        mid: O.none(),
        raw: escapeWire(bytes)
      })
    )

    const held = yield* Ref.get(buffer)
    const taken = step(held, bytes)
    yield* pipe(
      taken,
      Effect.fromResult,
      Effect.flatMap((next) =>
        pipe(
          Ref.set(buffer, next.buffer),
          Effect.andThen(
            Effect.forEach(
              next.frames,
              (frame) =>
                emit(
                  new WireEvent({
                    at,
                    source: options.source,
                    direction,
                    kind: "frame",
                    bytes: Str.length(frame) + 1,
                    mid: midOf(frame),
                    // The terminator is part of the frame on the wire, so a trace
                    // that hides it would not round trip to what the socket saw.
                    raw: escapeWire(encoder.encode(frame + terminator))
                  })
                ),
              { discard: true }
            )
          )
        )
      ),
      // A stream the framer cannot follow is still worth seeing as chunks, and
      // the session below decides what a protocol error costs.
      Effect.catchCause(() => Ref.set(buffer, ""))
    )
  })

/**
 * Wraps a `Duplex` so every byte it carries is logged, then forwards it
 * untouched.
 *
 * The two directions keep separate reassembly buffers, because a half-received
 * frame on one side says nothing about the other.
 *
 * **Example** (Tracing a client connection)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Endpoint, Transport, tracedDuplex } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const transport = yield* Transport
 *   const duplex = yield* transport.connect(new Endpoint({ host: "10.0.0.31", port: 4545 }))
 *   return yield* tracedDuplex(duplex, { source: "client" })
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const tracedDuplex = Effect.fnUntraced(function* (duplex: Duplex, options: TraceOptions) {
  const incoming = yield* Ref.make("")
  const outgoing = yield* Ref.make("")

  return {
    incoming: Stream.tap(duplex.incoming, (bytes) => observe(options, incoming, "recv", bytes)),
    send: (bytes: Uint8Array) => Effect.andThen(observe(options, outgoing, "send", bytes), duplex.send(bytes))
  } satisfies Duplex
})

/**
 * Renders a trace line as one JSON object, for a `--trace-file`.
 *
 * **Example** (Writing a line)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { WireEvent, wireEventLine } from "effect-open-protocol"
 *
 * const event = new WireEvent({
 *   at: "2026-09-18T10:14:16.312Z",
 *   source: "client",
 *   direction: "send",
 *   kind: "chunk",
 *   bytes: 4,
 *   mid: Option.none(),
 *   raw: "0020"
 * })
 *
 * const line = Effect.map(wireEventLine(event), (json) => `${json}\n`)
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const wireEventLine = (event: WireEvent): Effect.Effect<string> =>
  Effect.orDie(S.encodeEffect(S.fromJsonString(WireEvent))(event))
