import { makeTailHandler } from "../../../../src/CloudflareEntrypoint.ts"
import * as CloudflareContext from "../../../../src/CloudflareContext.ts"
import { Effect, Layer } from "effect"

const { handler } = makeTailHandler({
  handler: Effect.gen(function*() {
    const tail = yield* CloudflareContext.TailEvents
    const env = yield* CloudflareContext.Env

    yield* Effect.log(`Tail events: ${tail.events.length}`)

    for (const event of tail.events) {
      yield* Effect.log(`Script: ${event.scriptName}`)
      yield* Effect.log(`Timestamp: ${new Date(event.eventTimestamp).toISOString()}`)
      yield* Effect.log(`Logs: ${event.logs.length}`)
      yield* Effect.log(`Exceptions: ${event.exceptions.length}`)
    }
  }),
  layer: Layer.empty
})

export default { tail: handler }
