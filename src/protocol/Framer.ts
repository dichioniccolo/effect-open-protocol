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
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { headerLength, terminator } from "./Header.ts"
import { InvalidLength, MalformedHeader, MissingTerminator, type ProtocolError } from "./ProtocolError.ts"

/**
 * The largest frame the protocol can express: a 4 digit length plus the NUL
 * terminator.
 *
 * @category constants
 * @since 0.0.0
 */
export const maxFrameLength = 9999

const decoder = new TextDecoder("latin1")

type Emitted = Result.Result<ReadonlyArray<string>, ProtocolError>

const asciiNumber = S.decodeResult(S.NumberFromString)

const isDigits = (value: string): boolean =>
  Str.isNonEmpty(value) && A.every([...value], (char) => char >= "0" && char <= "9")

const takeFrames = (
  buffer: string,
  frames: ReadonlyArray<string>
): Result.Result<{ readonly buffer: string; readonly frames: ReadonlyArray<string> }, ProtocolError> => {
  const lengthField = Str.substring(0, 4)(buffer)
  return Str.length(buffer) < 4
    ? Result.succeed({ buffer, frames })
    : !isDigits(lengthField)
    ? Result.fail(new MalformedHeader({ field: "length", value: lengthField }))
    : pipe(
      asciiNumber(lengthField),
      Result.getOrElse(() => 0),
      (length) =>
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
): Result.Result<{ readonly buffer: string; readonly frames: ReadonlyArray<string> }, ProtocolError> =>
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
export const frames = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>
): Stream.Stream<string, E | ProtocolError, R> =>
  pipe(
    bytes,
    Stream.mapAccum(() => "", (buffer: string, chunk: Uint8Array): readonly [string, ReadonlyArray<Emitted>] =>
      Result.match(step(buffer, chunk), {
        onSuccess: (next) => [next.buffer, [Result.succeed(next.frames)]],
        onFailure: (error) => [buffer, [Result.fail(error)]]
      })),
    Stream.mapEffect((emitted: Emitted) =>
      Result.match(emitted, {
        onSuccess: (values) => Effect.succeed(values),
        onFailure: (error) => Effect.fail(error)
      })),
    Stream.flattenIterable
  )
