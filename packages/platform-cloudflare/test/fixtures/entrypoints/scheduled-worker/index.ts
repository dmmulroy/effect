import { makeScheduledHandler } from "../../../../src/CloudflareEntrypoint.ts"
import * as CloudflareContext from "../../../../src/CloudflareContext.ts"
import { Effect, Layer } from "effect"

const { handler } = makeScheduledHandler({
  handler: Effect.gen(function*() {
    const controller = yield* CloudflareContext.ScheduledController
    const env = yield* CloudflareContext.Env

    yield* Effect.log(`Cron: ${controller.cron}`)
    yield* Effect.log(`Scheduled: ${new Date(controller.scheduledTime).toISOString()}`)
    yield* Effect.log(`Env vars: ${JSON.stringify(env)}`)
  }),
  layer: Layer.empty
})

export default { scheduled: handler }
