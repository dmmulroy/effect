/**
 * @since 1.0.0
 */
import type * as HttpApi from "@effect/platform/HttpApi"
import type * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import type * as HttpApp from "@effect/platform/HttpApp"
import type { RunMain } from "@effect/platform/Runtime"
import type * as Layer from "effect/Layer"
import * as internal from "./internal/runtime.js"

/**
 * Creates a reusable Cloudflare Workers fetch handler.
 *
 * A single ManagedRuntime is created and reused across all requests.
 * Request-scoped values (ExecutionContext, Env) are merged into the context per-request.
 *
 * @since 1.0.0
 * @category runtime
 * @example
 * From HttpApi.Api (automatically builds HttpApp):
 * ```ts
 * import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
 * import { Effect, Layer } from "effect"
 *
 * class UsersGroup extends HttpApiGroup.make("users")
 *   .add(HttpApiEndpoint.get("getUser", "/:id"))
 * {}
 *
 * class MyApi extends HttpApi.make("api").add(UsersGroup) {}
 *
 * const UsersLive = HttpApiBuilder.group(MyApi, "users", (handlers) =>
 *   handlers.handle("getUser", ({ path }) =>
 *     Effect.succeed({ id: path.id, name: "John" })
 *   )
 * )
 *
 * const ApiLive = Layer.mergeAll(HttpApiBuilder.api(MyApi), UsersLive)
 *
 * const { handler } = makeFetchHandler({ layer: ApiLive })
 *
 * export default { fetch: handler }
 * ```
 *
 * @example
 * From HttpApp:
 * ```ts
 * import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { HttpRouter } from "@effect/platform/HttpRouter"
 * import { HttpServerResponse } from "@effect/platform/HttpServerResponse"
 * import { Layer } from "effect"
 *
 * const httpApp = HttpRouter.empty.pipe(
 *   HttpRouter.get("/hello", HttpServerResponse.text("Hello, World!"))
 * )
 *
 * const { handler } = makeFetchHandler({
 *   httpApp,
 *   layer: Layer.empty
 * })
 *
 * export default { fetch: handler }
 * ```
 */
export const makeFetchHandler: {
  <LA, LE, LR>(options: {
    readonly layer: Layer.Layer<LA | HttpApi.Api, LE, LR>
    readonly memoMap?: Layer.MemoMap
    readonly middleware?: (
      httpApp: HttpApp.Default
    ) => HttpApp.Default<
      never,
      HttpApi.Api | HttpApiBuilder.Router | HttpApiBuilder.Middleware
    >
  }): {
    readonly handler: <Env extends Record<string, unknown> = Record<string, unknown>>(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<Response>
    readonly dispose: () => Promise<void>
  }
  <R, E>(options: {
    readonly httpApp: HttpApp.Default<E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <Env extends Record<string, unknown> = Record<string, unknown>>(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<Response>
    readonly dispose: () => Promise<void>
  }
} = internal.makeFetchHandler as any

/**
 * Creates a reusable Cloudflare Workers scheduled handler for cron triggers.
 *
 * A single ManagedRuntime is created and reused across all scheduled invocations.
 * Request-scoped values (ScheduledController, ExecutionContext, Env) are merged into the context per-invocation.
 *
 * @since 1.0.0
 * @category runtime
 * @example
 * ```ts
 * import { makeScheduledHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { ScheduledController } from "@effect/platform-cloudflare/CloudflareContext"
 * import { Effect, Layer } from "effect"
 *
 * const handler = Effect.gen(function*() {
 *   const controller = yield* ScheduledController
 *   yield* Effect.log(`Cron trigger: ${controller.cron}`)
 *   yield* Effect.log(`Scheduled at: ${new Date(controller.scheduledTime)}`)
 * })
 *
 * const { handler: scheduled } = makeScheduledHandler({
 *   handler,
 *   layer: Layer.empty
 * })
 *
 * export default { scheduled }
 * ```
 */
export const makeScheduledHandler: <R, E>(options: {
  readonly handler: import("effect/Effect").Effect<void, E, R>
  readonly layer: Layer.Layer<R, E>
  readonly memoMap?: Layer.MemoMap
}) => {
  readonly handler: <Env extends Record<string, unknown> = Record<string, unknown>>(
    controller: globalThis.ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
  readonly dispose: () => Promise<void>
} = internal.makeScheduledHandler

/**
 * Creates a reusable Cloudflare Workers queue handler for processing batched messages.
 *
 * A single ManagedRuntime is created and reused across all queue invocations.
 * Request-scoped values (MessageBatch, ExecutionContext, Env) are merged into the context per-invocation.
 *
 * @since 1.0.0
 * @category runtime
 * @example
 * ```ts
 * import { makeQueueHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { MessageBatch } from "@effect/platform-cloudflare/CloudflareContext"
 * import { Effect, Layer } from "effect"
 *
 * const handler = Effect.gen(function*() {
 *   const batch = yield* MessageBatch
 *   yield* Effect.log(`Processing ${batch.messages.length} messages from ${batch.queue}`)
 *
 *   for (const message of batch.messages) {
 *     yield* Effect.log(`Message: ${JSON.stringify(message.body)}`)
 *   }
 *
 *   yield* batch.ackAll
 * })
 *
 * const { handler: queue } = makeQueueHandler({
 *   handler,
 *   layer: Layer.empty
 * })
 *
 * export default { queue }
 * ```
 */
export const makeQueueHandler: <R, E, Body = unknown>(options: {
  readonly handler: import("effect/Effect").Effect<void, E, R>
  readonly layer: Layer.Layer<R, E>
  readonly memoMap?: Layer.MemoMap
}) => {
  readonly handler: <Env extends Record<string, unknown> = Record<string, unknown>>(
    batch: globalThis.MessageBatch<Body>,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
  readonly dispose: () => Promise<void>
} = internal.makeQueueHandler

/**
 * Creates a reusable Cloudflare Workers email handler for processing incoming emails.
 *
 * A single ManagedRuntime is created and reused across all email invocations.
 * Request-scoped values (ForwardableEmailMessage, ExecutionContext, Env) are merged into the context per-invocation.
 *
 * @since 1.0.0
 * @category runtime
 * @example
 * ```ts
 * import { makeEmailHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { ForwardableEmailMessage } from "@effect/platform-cloudflare/CloudflareContext"
 * import { Effect, Layer } from "effect"
 *
 * const handler = Effect.gen(function*() {
 *   const message = yield* ForwardableEmailMessage
 *   yield* Effect.log(`Email from: ${message.from}`)
 *   yield* Effect.log(`Email to: ${message.to}`)
 *
 *   // Forward to another address
 *   yield* message.forward("admin@example.com")
 * })
 *
 * const { handler: email } = makeEmailHandler({
 *   handler,
 *   layer: Layer.empty
 * })
 *
 * export default { email }
 * ```
 */
export const makeEmailHandler: <R, E>(options: {
  readonly handler: import("effect/Effect").Effect<void, E, R>
  readonly layer: Layer.Layer<R, E>
  readonly memoMap?: Layer.MemoMap
}) => {
  readonly handler: <Env extends Record<string, unknown> = Record<string, unknown>>(
    message: globalThis.ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
  readonly dispose: () => Promise<void>
} = internal.makeEmailHandler

/**
 * Creates a reusable Cloudflare Workers tail handler for receiving logs from other Workers.
 *
 * A single ManagedRuntime is created and reused across all tail invocations.
 * Request-scoped values (TailEvents, ExecutionContext, Env) are merged into the context per-invocation.
 *
 * @since 1.0.0
 * @category runtime
 * @example
 * ```ts
 * import { makeTailHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { TailEvents } from "@effect/platform-cloudflare/CloudflareContext"
 * import { Effect, Layer } from "effect"
 *
 * const handler = Effect.gen(function*() {
 *   const tail = yield* TailEvents
 *   yield* Effect.log(`Received ${tail.events.length} tail events`)
 *
 *   for (const event of tail.events) {
 *     yield* Effect.log(`Event: ${JSON.stringify(event)}`)
 *   }
 * })
 *
 * const { handler: tail } = makeTailHandler({
 *   handler,
 *   layer: Layer.empty
 * })
 *
 * export default { tail }
 * ```
 */
export const makeTailHandler: <R, E>(options: {
  readonly handler: import("effect/Effect").Effect<void, E, R>
  readonly layer: Layer.Layer<R, E>
  readonly memoMap?: Layer.MemoMap
}) => {
  readonly handler: <Env extends Record<string, unknown> = Record<string, unknown>>(
    events: ReadonlyArray<globalThis.TailEvent>,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
  readonly dispose: () => Promise<void>
} = internal.makeTailHandler

/**
 * Runs an Effect as the main entry point for a Cloudflare Workers application.
 *
 * This function is useful for local development with Wrangler, as it:
 * - Patches Wrangler's SIGINT/SIGTERM handlers to allow Effect cleanup to complete
 * - Handles process exit codes based on Effect success/failure
 * - Provides error logging
 *
 * @since 1.0.0
 * @category runtime
 * @example
 * ```ts
 * import { runMain } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { makePlatformProxy } from "@effect/platform-cloudflare/CloudflareWrangler"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const { env, ctx } = yield* makePlatformProxy({
 *     configPath: "./wrangler.toml"
 *   })
 *
 *   // Your application logic here
 * })
 *
 * runMain(Effect.scoped(program))
 * ```
 */
export const runMain: RunMain = internal.runMain
