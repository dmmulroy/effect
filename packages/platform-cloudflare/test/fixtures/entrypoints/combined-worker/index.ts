import { makeEntrypoint } from "../../../../src/CloudflareEntrypoint.ts"
import * as CloudflareContext from "../../../../src/CloudflareContext.ts"
import { Context, Effect, Layer } from "effect"

// Shared state service to test runtime sharing across handlers
class SharedState extends Context.Tag("SharedState")<
  SharedState,
  {
    readonly getInitTime: () => number
    readonly incrementRequests: () => number
    readonly getRequestCount: () => number
  }
>() {}

const SharedStateLive = Layer.sync(SharedState, () => {
  const initTime = Date.now()
  let requestCount = 0

  return {
    getInitTime: () => initTime,
    incrementRequests: () => ++requestCount,
    getRequestCount: () => requestCount
  }
})

export default makeEntrypoint({
  layer: SharedStateLive,
  handlers: {
    fetch: (request, env, ctx) =>
      Effect.gen(function*() {
        const state = yield* SharedState
        const count = state.incrementRequests()
        const initTime = state.getInitTime()

        const url = new URL(request.url)

        if (url.pathname === "/") {
          return new Response(
            JSON.stringify({
              message: "Combined worker",
              requestCount: count,
              initTime
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        }

        if (url.pathname === "/api/test") {
          return new Response(
            JSON.stringify({ status: "ok", count }),
            { headers: { "Content-Type": "application/json" } }
          )
        }

        return new Response("Not found", { status: 404 })
      }),

    scheduled: (controller, env, ctx) =>
      Effect.gen(function*() {
        const state = yield* SharedState
        yield* Effect.log(`Cron executed: ${controller.cron}`)
        yield* Effect.log(`Init time: ${state.getInitTime()}`)
        yield* Effect.log(`Request count: ${state.getRequestCount()}`)
      }),

    queue: (batch, env, ctx) =>
      Effect.gen(function*() {
        const state = yield* SharedState
        yield* Effect.log(`Processing ${batch.messages.length} messages`)
        yield* Effect.log(`Init time: ${state.getInitTime()}`)
        yield* batch.ackAll
      })
  }
})
