/**
 * The library pointed at a controller, narrating everything it says.
 *
 * ```sh
 * bun run client -- --port 4545 --latency 40 --jitter 15
 * ```
 *
 * It is the real `DeviceConnection`: it handshakes, subscribes, keeps the link
 * alive, reconnects when the controller goes away, and fetches the results it
 * missed. Every state change and every result is logged, alongside the raw
 * frames underneath them. Ctrl-C prints what it received.
 *
 * @since 0.0.0
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Duration, Effect, pipe, Random, Ref, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import { Command, Flag } from "effect/unstable/cli"
import { makeDeviceConnection } from "../src/connection/DeviceConnection.ts"
import { DeviceId, type TighteningResult } from "../src/protocol/TighteningResult.ts"
import { layer as tcpLayer } from "../src/transport/TcpTransport.ts"
import { Endpoint } from "../src/transport/Transport.ts"
import {
  host,
  instrumentedTransport,
  jitter,
  latency,
  latencyOf,
  port,
  seed,
  traceFile,
  traceSink
} from "./Wire.ts"

const deviceId = Flag.String("device-id").pipe(
  Flag.withDescription("Identifier stamped on every result this client receives"),
  Flag.withDefault("tool-1")
)

const recoveryInterval = Flag.Int("recovery-interval").pipe(
  Flag.withDescription(
    "Milliseconds between MID 0064 reconciliations; 0 asks only when a session starts or a gap appears"
  ),
  Flag.withDefault(0)
)

const report = (result: TighteningResult): Effect.Effect<void> =>
  Effect.logInfo("result delivered").pipe(
    Effect.annotateLogs({
      deviceId: result.deviceId,
      tighteningId: result.tighteningId,
      status: result.status,
      torque: result.torque,
      angle: result.angle,
      vin: result.vin
    })
  )

const run = Effect.fnUntraced(function* (config: {
  readonly host: string
  readonly port: number
  readonly latency: number
  readonly jitter: number
  readonly traceFile: O.Option<string>
  readonly deviceId: string
  readonly recoveryInterval: number
}) {
  const sink = yield* traceSink(config.traceFile)
  const received = yield* Ref.make<ReadonlyArray<string>>([])
  const id = yield* Effect.orDie(S.decodeEffect(DeviceId)(config.deviceId))

  const connection = yield* makeDeviceConnection({
    id,
    endpoint: new Endpoint({ host: config.host, port: config.port }),
    ...(config.recoveryInterval > 0
      ? { recoveryInterval: Duration.millis(config.recoveryInterval) }
      : {}),
    onResult: (result) =>
      pipe(
        Ref.update(received, (current) => A.append(current, `${result.tighteningId}`)),
        Effect.andThen(report(result))
      )
  }).pipe(
    Effect.provide(
      instrumentedTransport({ source: "client", sink, latency: latencyOf(config) })
    )
  )

  yield* Effect.logInfo("client started").pipe(
    Effect.annotateLogs({
      endpoint: `${config.host}:${config.port}`,
      deviceId: config.deviceId,
      latency: config.latency,
      jitter: config.jitter,
      recoveryInterval: config.recoveryInterval
    })
  )

  // Every state change is worth seeing: this is where backoff, re-handshake
  // and recovery become visible without reading the frames.
  const watch = Effect.forkChild(
    Stream.runForEach(
      SubscriptionRef.changes(connection.state),
      (state) => Effect.logInfo("connection state").pipe(Effect.annotateLogs({ state: state._tag }))
    )
  )

  const summary = Effect.gen(function* () {
    const delivered = yield* connection.delivered
    const duplicates = yield* connection.duplicates
    const ids = yield* Ref.get(received)
    const state = yield* SubscriptionRef.get(connection.state)
    yield* Effect.logInfo("client stopped").pipe(
      Effect.annotateLogs({
        delivered,
        duplicates,
        state: state._tag,
        tighteningIds: A.join(ids, ",")
      })
    )
  })

  yield* watch
  return yield* Effect.onExit(Effect.never, () => summary)
})

const command = Command.make(
  "client",
  { host, port, seed, latency, jitter, traceFile, deviceId, recoveryInterval },
  (config) =>
    pipe(
      run(config),
      Random.withSeed(config.seed),
      Effect.scoped,
      Effect.provide(tcpLayer),
      Effect.asVoid
    )
).pipe(
  Command.withDescription("Connect to an Open Protocol controller and trace every byte it exchanges")
)

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
