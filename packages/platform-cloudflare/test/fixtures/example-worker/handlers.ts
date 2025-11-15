import { HttpApiBuilder } from "@effect/platform"
import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import { Effect, Layer } from "effect"
import { ExampleApi } from "./api.js"

// Hello handlers
export const HelloHandlers = HttpApiBuilder.group(ExampleApi, "hello", (handlers) =>
  handlers
    .handle("root", () =>
      Effect.succeed({
        status: "ok",
        version: "1.0.0"
      })
    )
    .handle("greet", ({ path }) =>
      Effect.succeed({
        message: `Hello, ${path.name}!`,
        timestamp: Date.now()
      })
    )
)

// Env handlers
export const EnvHandlers = HttpApiBuilder.group(ExampleApi, "env", (handlers) =>
  handlers.handle("show", () =>
    Effect.gen(function*() {
      const env = yield* CloudflareContext.Env

      return {
        environment: (env as Record<string, string>).ENVIRONMENT || "unknown",
        testVar: (env as Record<string, string>).TEST_VAR || "not set",
        apiUrl: (env as Record<string, string>).API_URL || "not set"
      }
    })
  )
)

// Background handlers
export const BackgroundHandlers = HttpApiBuilder.group(ExampleApi, "background", (handlers) =>
  handlers.handle("schedule", () =>
    Effect.gen(function*() {
      const ctx = yield* CloudflareContext.ExecutionContext

      // Schedule background work
      yield* ctx.waitUntil(
        Effect.gen(function*() {
          yield* Effect.log("Background task started")
          yield* Effect.sleep("2 seconds")
          yield* Effect.log("Background task completed")
        })
      )

      return {
        message: "Background task scheduled",
        scheduled: true
      }
    })
  )
)

// Combine all handlers
export const ApiLive = Layer.mergeAll(
  HttpApiBuilder.api(ExampleApi),
  HelloHandlers,
  EnvHandlers,
  BackgroundHandlers
)
