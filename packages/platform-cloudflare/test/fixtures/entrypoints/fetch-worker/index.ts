import { makeFetchHandler } from "../../../../src/CloudflareEntrypoint.ts"
import * as CloudflareContext from "../../../../src/CloudflareContext.ts"
import { Effect, Layer } from "effect"

// Function pattern - demonstrates access to raw arguments
const { handler } = makeFetchHandler({
  handler: (request, env, ctx) =>
    Effect.gen(function*() {
      const url = new URL(request.url)
      const cfEnv = yield* CloudflareContext.Env
      const cfCtx = yield* CloudflareContext.ExecutionContext

      // Simple routing based on pathname
      if (url.pathname === "/") {
        return new Response(
          JSON.stringify({
            message: "Fetch worker - Function pattern",
            url: request.url,
            method: request.method,
            env: cfEnv
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }

      if (url.pathname === "/echo") {
        const body = await request.text()
        return new Response(
          JSON.stringify({ echo: body }),
          { headers: { "Content-Type": "application/json" } }
        )
      }

      if (url.pathname === "/async") {
        // Demonstrate waitUntil for background work
        yield* cfCtx.waitUntil(
          Effect.gen(function*() {
            yield* Effect.sleep("100 millis")
            yield* Effect.log("Background task completed")
          })
        )

        return new Response(
          JSON.stringify({ message: "Background task scheduled" }),
          { headers: { "Content-Type": "application/json" } }
        )
      }

      return new Response("Not found", { status: 404 })
    }),
  layer: Layer.empty
})

export default { fetch: handler }
