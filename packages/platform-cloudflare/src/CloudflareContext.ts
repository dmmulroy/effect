/**
 * @since 1.0.0
 */
import type * as Effect from "effect/Effect"
import * as internal from "./internal/context.js"

/**
 * @since 1.0.0
 * @category models
 */
export type CloudflareExecutionContext = internal.CloudflareExecutionContext

/**
 * @since 1.0.0
 * @category models
 */
export type CloudflareScheduledController = internal.CloudflareScheduledController

/**
 * @since 1.0.0
 * @category models
 */
export type CloudflareMessageBatch<Body = unknown> = internal.CloudflareMessageBatch<Body>

/**
 * @since 1.0.0
 * @category models
 */
export type CloudflareForwardableEmailMessage = internal.CloudflareForwardableEmailMessage

/**
 * @since 1.0.0
 * @category models
 */
export type CloudflareTailEvents = internal.CloudflareTailEvents

/**
 * A tag for the Cloudflare Workers ExecutionContext.
 *
 * @since 1.0.0
 * @category tags
 */
export const ExecutionContext: typeof internal.ExecutionContext = internal.ExecutionContext

/**
 * A tag for the Cloudflare Workers environment bindings.
 *
 * @since 1.0.0
 * @category tags
 */
export const Env: typeof internal.Env = internal.Env

/**
 * A FiberRef for the current ExecutionContext.
 *
 * @since 1.0.0
 * @category fiber refs
 */
export const currentExecutionContext: typeof internal.currentExecutionContext =
  internal.currentExecutionContext

/**
 * A FiberRef for the current Env.
 *
 * @since 1.0.0
 * @category fiber refs
 */
export const currentEnv: typeof internal.currentEnv = internal.currentEnv

/**
 * Provides an ExecutionContext to an effect.
 *
 * @since 1.0.0
 * @category combinators
 * @example
 * ```ts
 * import { ExecutionContext, withExecutionContext } from "@effect/platform-cloudflare/CloudflareContext"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const ctx = yield* ExecutionContext
 *   yield* ctx.waitUntil(Effect.log("Background task"))
 * })
 *
 * // In your fetch handler
 * export default {
 *   fetch: (request, env, ctx) => {
 *     return Effect.runPromise(withExecutionContext(program, ctx))
 *   }
 * }
 * ```
 */
export const withExecutionContext: {
  (executionContext: globalThis.ExecutionContext): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    executionContext: globalThis.ExecutionContext
  ): Effect.Effect<A, E, R>
} = internal.withExecutionContext

/**
 * Provides an Env to an effect.
 *
 * @since 1.0.0
 * @category combinators
 * @example
 * ```ts
 * import { Env, withEnv } from "@effect/platform-cloudflare/CloudflareContext"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const env = yield* Env
 *   console.log(env.MY_VARIABLE)
 * })
 *
 * // In your fetch handler
 * export default {
 *   fetch: (request, env, ctx) => {
 *     return Effect.runPromise(withEnv(program, env))
 *   }
 * }
 * ```
 */
export const withEnv: {
  (env: Record<string, unknown>): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(effect: Effect.Effect<A, E, R>, env: Record<string, unknown>): Effect.Effect<A, E, R>
} = internal.withEnv

/**
 * Creates a Layer that provides an ExecutionContext.
 *
 * @since 1.0.0
 * @category layers
 */
export const executionContextLayer: typeof internal.executionContextLayer = internal.executionContextLayer

/**
 * Creates a Layer that provides an Env.
 *
 * @since 1.0.0
 * @category layers
 */
export const envLayer: typeof internal.envLayer = internal.envLayer

/**
 * A tag for the Cloudflare Workers ScheduledController.
 *
 * @since 1.0.0
 * @category tags
 */
export const ScheduledController: typeof internal.ScheduledController = internal.ScheduledController

/**
 * A tag for the Cloudflare Workers MessageBatch.
 *
 * @since 1.0.0
 * @category tags
 */
export const MessageBatch: typeof internal.MessageBatch = internal.MessageBatch

/**
 * A tag for the Cloudflare Workers ForwardableEmailMessage.
 *
 * @since 1.0.0
 * @category tags
 */
export const ForwardableEmailMessage: typeof internal.ForwardableEmailMessage = internal.ForwardableEmailMessage

/**
 * A tag for the Cloudflare Workers TailEvents.
 *
 * @since 1.0.0
 * @category tags
 */
export const TailEvents: typeof internal.TailEvents = internal.TailEvents
