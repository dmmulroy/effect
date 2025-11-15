import { makeEmailHandler } from "../../../../src/CloudflareEntrypoint.ts"
import * as CloudflareContext from "../../../../src/CloudflareContext.ts"
import { Effect, Layer } from "effect"

const { handler } = makeEmailHandler({
  handler: Effect.gen(function*() {
    const message = yield* CloudflareContext.ForwardableEmailMessage
    const env = yield* CloudflareContext.Env

    yield* Effect.log(`Email from: ${message.from}`)
    yield* Effect.log(`Email to: ${message.to}`)

    const subject = message.headers.get("Subject")
    if (subject) {
      yield* Effect.log(`Subject: ${subject}`)
    }

    // Forward to admin if configured
    const adminEmail = (env as Record<string, unknown>).ADMIN_EMAIL as string | undefined
    if (adminEmail) {
      yield* message.forward(adminEmail)
      yield* Effect.log(`Forwarded to: ${adminEmail}`)
    }
  }),
  layer: Layer.empty
})

export default { email: handler }
