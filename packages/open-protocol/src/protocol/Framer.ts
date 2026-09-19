/**
 * Turns a TCP byte stream into complete Open Protocol frames.
 *
 * TCP gives no message boundaries: one read can hold half a frame, several
 * frames, or a frame split anywhere. The framer is a pure step over an
 * accumulated buffer, so it can be tested without any I/O and lifted onto a
 * `Stream` with `Stream.mapAccum`.
 *
 * @since 0.0.0
 */
import { Effect, pipe, Result, Stream } from "effect"
import * as A from "effect/Array"
import * as Str from "effect/String"
import { parseDigits } from "./Ascii.ts"
import { headerLength, terminator } from "./Header.ts"
import { type FramingError, InvalidLength, MalformedHeader, MissingTerminator } from "./ProtocolError.ts"

const decoder = new TextDecoder("latin1")

const takeFrames = (
  buffer: string,
  frames: ReadonlyArray<string>
): Result.Result<{ readonly buffer: string; readonly frames: ReadonlyArray<string> }, FramingError> => {
  const lengthField = Str.substring(0, 4)(buffer)

  return Str.length(buffer) < 4
    ? Result.succeed({ buffer, frames })
    : pipe(
        parseDigits(lengthField, () => new MalformedHeader({ field: "length", value: lengthField })),
        Result.flatMap((length) =>
          length < headerLength
            ? Result.fail(new InvalidLength({ length }))
            : Str.length(buffer) < length + 1
              ? Result.succeed({ buffer, frames })
              : Str.substring(length, length + 1)(buffer) !== terminator
                ? Result.fail(new MissingTerminator({ length }))
                : takeFrames(
                    Str.substring(length + 1, Str.length(buffer))(buffer),
                    A.append(frames, Str.substring(0, length)(buffer))
                  )
        )
      )
}

/**
 * Consumes one chunk of bytes and returns the frames it completed plus the
 * bytes still waiting for their terminator.
 *
 * **Example** (Feeding a split frame)
 *
 * ```ts
 * import { Result } from "effect"
 * import { step } from "effect-open-protocol"
 *
 * const first = step("", new TextEncoder().encode("00209999   "))
 *
 * console.log(Result.isSuccess(first))
 * ```
 *
 * @category framing
 * @since 0.0.0
 */
export const step = (
  buffer: string,
  chunk: Uint8Array
): Result.Result<{ readonly buffer: string; readonly frames: ReadonlyArray<string> }, FramingError> =>
  takeFrames(buffer + decoder.decode(chunk), [])

/**
 * Lifts `step` onto a byte stream, failing the stream on the first framing
 * error.
 *
 * A framing error is not recoverable in place: TCP offers no boundary to
 * resynchronise on, so the connection is expected to fail and reconnect.
 *
 * @category framing
 * @since 0.0.0
 */
export const frames = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E | FramingError, R> =>
  pipe(
    bytes,
    Stream.mapAccumEffect(
      () => "",
      (buffer: string, chunk: Uint8Array) =>
        Effect.map(Effect.fromResult(step(buffer, chunk)), (next) => [next.buffer, next.frames] as const)
    )
  )
