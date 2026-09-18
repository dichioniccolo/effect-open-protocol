import { WireStore } from "@wire-trace/store"
import { Effect, pipe } from "effect"
import * as S from "effect/Schema"
import { runtime } from "@/lib/server"
import { RunListJson } from "@/lib/wire"

export const dynamic = "force-dynamic"

/** Every recorded run, newest first, as JSON. */
export const GET = () =>
  runtime.runPromise(
    pipe(
      WireStore.use((store) => store.listRuns),
      Effect.flatMap(S.encodeEffect(RunListJson)),
      Effect.map((body) => new Response(body, { headers: { "content-type": "application/json" } }))
    )
  )
