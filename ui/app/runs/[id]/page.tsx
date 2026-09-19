import { EventQuery, WireStore } from "@wire-trace/store"
import { Effect, pipe } from "effect"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import { notFound } from "next/navigation"
import { runtime } from "@/lib/server"
import { EventPageJson, RunIdFromString, RunJson } from "@/lib/wire"
import { RunView } from "./run-view"

export const dynamic = "force-dynamic"

/** How many events the server renders before the live feed takes over. */
const firstPage = 5000

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params

  const loaded = await runtime.runPromise(
    pipe(
      S.decodeUnknownOption(RunIdFromString)(id),
      O.match({
        onNone: () => Effect.succeedNone,
        onSome: (runId) =>
          WireStore.use((store) =>
            Effect.gen(function* () {
              const run = yield* store.findRun(runId)

              const events = yield* store.events(
                new EventQuery({ runId, limit: firstPage, kind: O.none(), direction: O.none(), mid: O.none() })
              )

              return yield* O.match(run, {
                onNone: () => Effect.succeedNone,
                onSome: (found) =>
                  Effect.map(
                    Effect.all({
                      run: S.encodeEffect(RunJson)(found),
                      events: S.encodeEffect(EventPageJson)(events)
                    }),
                    O.some
                  )
              })
            })
          )
      })
    )
  )

  return O.match(loaded, {
    onNone: () => notFound(),
    onSome: (page) => <RunView run={page.run} events={page.events} />
  })
}
