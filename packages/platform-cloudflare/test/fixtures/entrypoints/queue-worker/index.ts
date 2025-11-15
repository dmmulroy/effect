import { makeQueueHandler } from "../../../../src/CloudflareEntrypoint.ts"
import * as CloudflareContext from "../../../../src/CloudflareContext.ts"
import { Effect, Layer } from "effect"

interface OrderMessage {
  orderId: string
  amount: number
  valid?: boolean
}

const { handler } = makeQueueHandler<never, never, OrderMessage>({
  handler: Effect.gen(function*() {
    const batch = yield* CloudflareContext.MessageBatch
    const env = yield* CloudflareContext.Env

    yield* Effect.log(`Queue: ${batch.queue}`)
    yield* Effect.log(`Messages: ${batch.messages.length}`)

    for (const msg of batch.messages) {
      yield* Effect.log(`Processing: ${JSON.stringify(msg.body)}`)

      // Ack valid messages, retry invalid ones
      if (msg.body.valid !== false) {
        msg.ack()
      } else {
        msg.retry()
      }
    }
  }),
  layer: Layer.empty
})

export default { queue: handler }
