/**
 * @since 1.0.0
 */
import type * as HttpApi from "@effect/platform/HttpApi"
import type * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import type * as HttpApp from "@effect/platform/HttpApp"
import type { Effect } from "effect"
import type * as Layer from "effect/Layer"
import type {
  CloudflareExecutionContext,
  CloudflareForwardableEmailMessage,
  CloudflareMessageBatch,
  CloudflareScheduledController,
  CloudflareTailEvents
} from "./CloudflareContext.js"
import * as internal from "./internal/runtime.js"

/**
 * Creates a reusable Cloudflare Workers fetch handler.
 *
 * A single ManagedRuntime is created and reused across all requests.
 * Request-scoped values (ExecutionContext, Env) are merged into the context per-request.
 *
 * @since 1.0.0
 * @category entrypoint
 * @example
 * From HttpApi.Api (automatically builds HttpApp):
 * ```ts
 * import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
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
 * import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
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
 *
 * @example
 * From Effect directly:
 * ```ts
 * import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * const { handler } = makeFetchHandler({
 *   effect: Effect.succeed(new Response("Hello, World!")),
 *   layer: Layer.empty
 * })
 *
 * export default { fetch: handler }
 * ```
 *
 * @example
 * From function with raw arguments:
 * ```ts
 * import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * const { handler } = makeFetchHandler({
 *   handler: (request, env, ctx) =>
 *     Effect.gen(function*() {
 *       const url = new URL(request.url)
 *       return new Response(`Hello from ${url.pathname}`)
 *     }),
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
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
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
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<Response>
    readonly dispose: () => Promise<void>
  }
  <R, E>(options: {
    readonly effect: Effect.Effect<Response, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<Response>
    readonly dispose: () => Promise<void>
  }
  <R, E>(options: {
    readonly handler: (
      request: Request,
      env: Record<string, unknown>,
      ctx: CloudflareExecutionContext
    ) => Effect.Effect<Response, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
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
 * @category entrypoint
 * @example
 * From Effect (access via services):
 * ```ts
 * import { makeScheduledHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
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
 *
 * @example
 * From function (with raw arguments):
 * ```ts
 * import { makeScheduledHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * const { handler: scheduled } = makeScheduledHandler({
 *   handler: (controller, env, ctx) =>
 *     Effect.gen(function*() {
 *       yield* Effect.log(`Cron: ${controller.cron}`)
 *       yield* Effect.log(`Scheduled: ${new Date(controller.scheduledTime)}`)
 *     }),
 *   layer: Layer.empty
 * })
 *
 * export default { scheduled }
 * ```
 */
export const makeScheduledHandler: {
  <R, E>(options: {
    readonly handler: Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      controller: globalThis.ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
  <R, E>(options: {
    readonly handler: (
      controller: CloudflareScheduledController,
      env: Record<string, unknown>,
      ctx: CloudflareExecutionContext
    ) => Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      controller: globalThis.ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
} = internal.makeScheduledHandler as any

/**
 * Creates a reusable Cloudflare Workers queue handler for processing batched messages.
 *
 * A single ManagedRuntime is created and reused across all queue invocations.
 * Request-scoped values (MessageBatch, ExecutionContext, Env) are merged into the context per-invocation.
 *
 * @since 1.0.0
 * @category entrypoint
 * @example
 * From Effect (access via services):
 * ```ts
 * import { makeQueueHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
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
 *
 * @example
 * From function (with raw arguments):
 * ```ts
 * import { makeQueueHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * const { handler: queue } = makeQueueHandler({
 *   handler: (batch, env, ctx) =>
 *     Effect.gen(function*() {
 *       yield* Effect.log(`Processing ${batch.messages.length} messages`)
 *       for (const msg of batch.messages) {
 *         yield* Effect.log(`Message: ${JSON.stringify(msg.body)}`)
 *       }
 *       yield* batch.ackAll
 *     }),
 *   layer: Layer.empty
 * })
 *
 * export default { queue }
 * ```
 */
export const makeQueueHandler: {
  <R, E, Body = unknown>(options: {
    readonly handler: Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      batch: globalThis.MessageBatch<Body>,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
  <R, E, Body = unknown>(options: {
    readonly handler: (
      batch: CloudflareMessageBatch<Body>,
      env: Record<string, unknown>,
      ctx: CloudflareExecutionContext
    ) => Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      batch: globalThis.MessageBatch<Body>,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
} = internal.makeQueueHandler as any

/**
 * Creates a reusable Cloudflare Workers email handler for processing incoming emails.
 *
 * A single ManagedRuntime is created and reused across all email invocations.
 * Request-scoped values (ForwardableEmailMessage, ExecutionContext, Env) are merged into the context per-invocation.
 *
 * @since 1.0.0
 * @category entrypoint
 * @example
 * From Effect (access via services):
 * ```ts
 * import { makeEmailHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
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
 *
 * @example
 * From function (with raw arguments):
 * ```ts
 * import { makeEmailHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * const { handler: email } = makeEmailHandler({
 *   handler: (message, env, ctx) =>
 *     Effect.gen(function*() {
 *       yield* Effect.log(`Email from: ${message.from}`)
 *       yield* Effect.log(`Email to: ${message.to}`)
 *       yield* message.forward("admin@example.com")
 *     }),
 *   layer: Layer.empty
 * })
 *
 * export default { email }
 * ```
 */
export const makeEmailHandler: {
  <R, E>(options: {
    readonly handler: Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      message: globalThis.ForwardableEmailMessage,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
  <R, E>(options: {
    readonly handler: (
      message: CloudflareForwardableEmailMessage,
      env: Record<string, unknown>,
      ctx: CloudflareExecutionContext
    ) => Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      message: globalThis.ForwardableEmailMessage,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
} = internal.makeEmailHandler as any

/**
 * Creates a reusable Cloudflare Workers tail handler for receiving logs from other Workers.
 *
 * A single ManagedRuntime is created and reused across all tail invocations.
 * Request-scoped values (TailEvents, ExecutionContext, Env) are merged into the context per-invocation.
 *
 * @since 1.0.0
 * @category entrypoint
 * @example
 * From Effect (access via services):
 * ```ts
 * import { makeTailHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
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
 *
 * @example
 * From function (with raw arguments):
 * ```ts
 * import { makeTailHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * const { handler: tail } = makeTailHandler({
 *   handler: (tail, env, ctx) =>
 *     Effect.gen(function*() {
 *       yield* Effect.log(`Received ${tail.events.length} tail events`)
 *       for (const event of tail.events) {
 *         yield* Effect.log(`Event: ${JSON.stringify(event)}`)
 *       }
 *     }),
 *   layer: Layer.empty
 * })
 *
 * export default { tail }
 * ```
 */
export const makeTailHandler: {
  <R, E>(options: {
    readonly handler: Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      events: ReadonlyArray<globalThis.TailEvent>,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
  <R, E>(options: {
    readonly handler: (
      tail: CloudflareTailEvents,
      env: Record<string, unknown>,
      ctx: CloudflareExecutionContext
    ) => Effect.Effect<void, E, R>
    readonly layer: Layer.Layer<R, E>
    readonly memoMap?: Layer.MemoMap
  }): {
    readonly handler: <
      Env extends Record<string, unknown> = Record<string, unknown>
    >(
      events: ReadonlyArray<globalThis.TailEvent>,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>
    readonly dispose: () => Promise<void>
  }
} = internal.makeTailHandler as any

/**
 * Creates a complete Cloudflare Workers entrypoint with multiple handlers.
 *
 * This convenience function allows you to define all your worker handlers in one place,
 * sharing a single layer and runtime across all handlers for optimal resource usage.
 *
 * Returns a Cloudflare-compatible handler object ready for `export default`.
 *
 * @since 1.0.0
 * @category entrypoint
 * @example
 * Basic usage with Effect pattern:
 * ```ts
 * import { makeEntrypoint } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * export default makeEntrypoint({
 *   layer: Layer.empty,
 *   handlers: {
 *     fetch: Effect.succeed(new Response("Hello, World!")),
 *     scheduled: Effect.log("Cron job executed")
 *   }
 * })
 * ```
 *
 * @example
 * Function pattern with context arguments:
 * ```ts
 * import { makeEntrypoint } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Effect, Layer } from "effect"
 *
 * export default makeEntrypoint({
 *   layer: Layer.empty,
 *   handlers: {
 *     fetch: (request, env, ctx) =>
 *       Effect.gen(function*() {
 *         const url = new URL(request.url)
 *         return new Response(`Path: ${url.pathname}`)
 *       }),
 *     scheduled: (controller, env, ctx) =>
 *       Effect.log(`Cron: ${controller.cron} at ${controller.scheduledTime}`),
 *     queue: (batch, env, ctx) =>
 *       Effect.gen(function*() {
 *         yield* Effect.log(`Processing ${batch.messages.length} messages`)
 *         yield* batch.ackAll
 *       })
 *   }
 * })
 * ```
 *
 * @example
 * Mixed patterns with shared layer:
 * ```ts
 * import { makeEntrypoint } from "@effect/platform-cloudflare/CloudflareEntrypoint"
 * import { Context, Effect, Layer } from "effect"
 *
 * class Database extends Context.Tag("Database")<Database, { query: (sql: string) => Effect.Effect<any> }>() {}
 *
 * const DatabaseLive = Layer.succeed(Database, {
 *   query: (sql) => Effect.succeed({ rows: [] })
 * })
 *
 * export default makeEntrypoint({
 *   layer: DatabaseLive,
 *   handlers: {
 *     // Direct Effect (uses Database service)
 *     fetch: Effect.gen(function*() {
 *       const db = yield* Database
 *       const result = yield* db.query("SELECT * FROM users")
 *       return new Response(JSON.stringify(result))
 *     }),
 *     // Function pattern (also has Database available)
 *     scheduled: (controller, env, ctx) =>
 *       Effect.gen(function*() {
 *         const db = yield* Database
 *         yield* db.query("DELETE FROM old_sessions")
 *       })
 *   }
 * })
 * ```
 */
export const makeEntrypoint: <R, E, Body = unknown>(options: {
  readonly layer: Layer.Layer<R, E>
  readonly memoMap?: Layer.MemoMap
  readonly handlers: {
    readonly fetch?:
      | Effect.Effect<Response, E, R>
      | ((
        request: Request,
        env: Record<string, unknown>,
        ctx: CloudflareExecutionContext
      ) => Effect.Effect<Response, E, R>)
    readonly scheduled?:
      | Effect.Effect<void, E, R>
      | ((
        controller: CloudflareScheduledController,
        env: Record<string, unknown>,
        ctx: CloudflareExecutionContext
      ) => Effect.Effect<void, E, R>)
    readonly queue?:
      | Effect.Effect<void, E, R>
      | ((
        batch: CloudflareMessageBatch<Body>,
        env: Record<string, unknown>,
        ctx: CloudflareExecutionContext
      ) => Effect.Effect<void, E, R>)
    readonly email?:
      | Effect.Effect<void, E, R>
      | ((
        message: CloudflareForwardableEmailMessage,
        env: Record<string, unknown>,
        ctx: CloudflareExecutionContext
      ) => Effect.Effect<void, E, R>)
    readonly tail?:
      | Effect.Effect<void, E, R>
      | ((
        events: CloudflareTailEvents,
        env: Record<string, unknown>,
        ctx: CloudflareExecutionContext
      ) => Effect.Effect<void, E, R>)
  }
}) => {
  readonly fetch?: <Env extends Record<string, unknown> = Record<string, unknown>>(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<Response>
  readonly scheduled?: <Env extends Record<string, unknown> = Record<string, unknown>>(
    controller: globalThis.ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
  readonly queue?: <Env extends Record<string, unknown> = Record<string, unknown>>(
    batch: globalThis.MessageBatch<Body>,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
  readonly email?: <Env extends Record<string, unknown> = Record<string, unknown>>(
    message: globalThis.ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
  readonly tail?: <Env extends Record<string, unknown> = Record<string, unknown>>(
    events: ReadonlyArray<globalThis.TailEvent>,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void>
} = internal.makeEntrypoint as any
