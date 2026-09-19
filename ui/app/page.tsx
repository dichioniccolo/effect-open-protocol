import { WireStore } from "@wire-trace/store"
import { Effect } from "effect"
import * as DateTime from "effect/DateTime"
import * as S from "effect/Schema"
import { runtime } from "@/lib/server"
import { RunListJson } from "@/lib/wire"
import { RunList } from "./run-list"

export const dynamic = "force-dynamic"

export default async function Page() {
  const { json, renderedAt } = await runtime.runPromise(
    Effect.all({
      json: Effect.flatMap(
        WireStore.use((store) => store.listRuns),
        S.encodeEffect(RunListJson)
      ),
      renderedAt: Effect.map(DateTime.now, DateTime.formatIso)
    })
  )

  return <RunList initial={json} renderedAt={renderedAt} />
}
