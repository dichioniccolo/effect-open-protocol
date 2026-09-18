import { EventId, EventQuery, type RunId, WireStore } from "@wire-trace/store"
import { Duration, Effect, pipe, Ref, Schedule, Stream } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Sse from "effect/unstable/encoding/Sse"
import type { NextRequest } from "next/server"
import { runtime } from "@/lib/server"
import { EventPageJson, RunIdFromString } from "@/lib/wire"

export const dynamic = "force-dynamic"

/** How long an idle feed waits before asking the file again. */
const pollEvery = Duration.millis(400)

/** Most events in one message; a backlog drains a page per poll. */
const pageSize = 500

/**
 * How long one connection lives before the server ends it.
 *
 * Next on Bun does not tell a route handler that the browser went away:
 * neither the request's abort signal nor the body stream's cancel fires, in
 * dev or in `next start`. Left alone, a closed tab would poll the file forever.
 * Ending every connection after a bounded time caps that, and costs a live tab
 * nothing: the browser's live atom reconnects and resumes from the last id.
 */
const lifetime = Duration.seconds(20)

/** Where to resume: `?after=`, or the standard `Last-Event-ID` header. */
const cursorOf = (request: NextRequest): EventId =>
  pipe(
    O.fromNullishOr(request.headers.get("last-event-id") ?? request.nextUrl.searchParams.get("after")),
    O.flatMap(S.decodeUnknownOption(S.FiniteFromString.pipe(S.decodeTo(EventId)))),
    O.getOrElse(() => EventId.make(0))
  )

/**
 * The run's events past the cursor, as Server-Sent Events.
 *
 * The CLIs write from other processes, so nothing here can be told that a row
 * arrived: the feed polls the file past the last id it sent. Each message
 * carries that id, and the browser resumes after it when it reconnects. The
 * poll loop ends when the browser goes away, where the runtime reports it, and
 * after `lifetime` regardless.
 */
const feed = (runId: RunId, after: EventId) =>
  Effect.gen(function* () {
    const store = yield* WireStore
    const cursor = yield* Ref.make(after)
    const nextPage = pipe(
      Ref.get(cursor),
      Effect.flatMap((from) =>
        store.events(
          new EventQuery({ runId, after: from, limit: pageSize, kind: O.none(), direction: O.none(), mid: O.none() })
        )
      ),
      Effect.tap((page) => O.match(A.last(page), { onNone: () => Effect.void, onSome: (last) => Ref.set(cursor, last.id) }))
    )
    return pipe(
      Stream.fromEffectSchedule(nextPage, Schedule.spaced(pollEvery)),
      Stream.filter(A.isReadonlyArrayNonEmpty),
      Stream.mapEffect((page) =>
        Effect.map(S.encodeEffect(EventPageJson)(page), (data) =>
          Sse.encoder.write({ _tag: "Event", id: `${A.lastNonEmpty(page).id}`, event: "events", data }))
      ),
      Stream.encodeText
    )
  })

export async function GET(request: NextRequest, context: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await context.params
  return O.match(S.decodeUnknownOption(RunIdFromString)(id), {
    onNone: () => new Response("unknown run", { status: 404 }),
    onSome: (runId) =>
      runtime.runPromise(
        pipe(
          feed(runId, cursorOf(request)),
          Effect.map((stream) =>
            Stream.interruptWhen(
              stream,
              Effect.raceFirst(
                Effect.callback<void>((resume) => {
                  request.signal.addEventListener("abort", () => resume(Effect.void), { once: true })
                }),
                Effect.sleep(lifetime)
              )
            )
          ),
          Effect.flatMap(Stream.toReadableStreamEffect()),
          Effect.map((body) =>
            new Response(body, {
              headers: {
                "content-type": "text/event-stream",
                "cache-control": "no-cache, no-transform",
                connection: "keep-alive"
              }
            })
          )
        )
      )
  })
}
