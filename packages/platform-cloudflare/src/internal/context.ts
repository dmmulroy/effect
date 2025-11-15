/**
 * @since 1.0.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FiberRef from "effect/FiberRef"
import { dual, pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Runtime from "effect/Runtime"

/**
 * @since 1.0.0
 * @category models
 */
export interface CloudflareExecutionContext {
  /**
   * Schedules an effect to run in the background using ExecutionContext.waitUntil.
   * The effect will continue running even after the response is sent.
   */
  readonly waitUntil: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>
  /**
   * Allows a Worker to fail open and pass a request through to an origin server
   * when the Worker throws an unhandled exception.
   */
  readonly passThroughOnException: Effect.Effect<void>
  /**
   * Get the raw ExecutionContext object for direct access if needed.
   */
  readonly raw: globalThis.ExecutionContext
}

export const makeExecutionContext = (ctx: globalThis.ExecutionContext): CloudflareExecutionContext => ({
  waitUntil: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function*() {
      const runtime = yield* Effect.runtime<R>()
      const fiber = yield* Effect.fork(effect)
      ctx.waitUntil(
        Runtime.runPromise(runtime)(
          pipe(
            fiber.await,
            Effect.tapErrorCause(Effect.logError),
            Effect.asVoid
          )
        )
      )
    }),
  passThroughOnException: Effect.sync(() => ctx.passThroughOnException?.()),
  raw: ctx
})

/**
 * @since 1.0.0
 * @category tags
 */
export class ExecutionContext extends Context.Tag("@effect/platform-cloudflare/ExecutionContext")<
  ExecutionContext,
  CloudflareExecutionContext
>() {}

/**
 * @since 1.0.0
 * @category tags
 */
export class Env extends Context.Tag("@effect/platform-cloudflare/Env")<
  Env,
  Record<string, unknown>
>() {}

/**
 * @since 1.0.0
 * @category fiber refs
 */
export const currentExecutionContext: FiberRef.FiberRef<ExecutionContext | undefined> = FiberRef.unsafeMake<
  ExecutionContext | undefined
>(undefined)

/**
 * @since 1.0.0
 * @category fiber refs
 */
export const currentEnv: FiberRef.FiberRef<Env | undefined> = FiberRef.unsafeMake<Env | undefined>(undefined)

/**
 * @since 1.0.0
 * @category combinators
 */
export const withExecutionContext: {
  (executionContext: globalThis.ExecutionContext): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    executionContext: globalThis.ExecutionContext
  ): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    executionContext: globalThis.ExecutionContext
  ): Effect.Effect<A, E, R> => Effect.provideService(effect, ExecutionContext, makeExecutionContext(executionContext))
)

/**
 * @since 1.0.0
 * @category combinators
 */
export const withEnv: {
  (env: Record<string, unknown>): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(effect: Effect.Effect<A, E, R>, env: Record<string, unknown>): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(effect: Effect.Effect<A, E, R>, env: Record<string, unknown>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, Env, env)
)

/**
 * @since 1.0.0
 * @category layers
 */
export const executionContextLayer = (
  executionContext: globalThis.ExecutionContext
): Layer.Layer<ExecutionContext> => Layer.succeed(ExecutionContext, makeExecutionContext(executionContext))

/**
 * @since 1.0.0
 * @category layers
 */
export const envLayer = (env: Record<string, unknown>): Layer.Layer<Env> => Layer.succeed(Env, env)

/**
 * @since 1.0.0
 * @category models
 */
export interface CloudflareScheduledController {
  /**
   * The time the ScheduledEvent was scheduled to be executed in milliseconds since January 1, 1970, UTC.
   */
  readonly scheduledTime: number
  /**
   * The value of the Cron Trigger that started the ScheduledEvent.
   */
  readonly cron: string
  /**
   * Prevents the scheduled event from retrying if it fails.
   */
  readonly noRetry: Effect.Effect<void>
  /**
   * Get the raw ScheduledController object for direct access if needed.
   */
  readonly raw: globalThis.ScheduledController
}

export const makeScheduledController = (controller: globalThis.ScheduledController): CloudflareScheduledController => ({
  scheduledTime: controller.scheduledTime,
  cron: controller.cron,
  noRetry: Effect.sync(() => controller.noRetry()),
  raw: controller
})

/**
 * @since 1.0.0
 * @category tags
 */
export class ScheduledController extends Context.Tag("@effect/platform-cloudflare/ScheduledController")<
  ScheduledController,
  CloudflareScheduledController
>() {}

/**
 * @since 1.0.0
 * @category models
 */
export interface CloudflareMessageBatch<Body = unknown> {
  /**
   * The name of the Queue that belongs to this batch.
   */
  readonly queue: string
  /**
   * An array of messages in the batch.
   */
  readonly messages: ReadonlyArray<globalThis.Message<Body>>
  /**
   * Marks every message as successfully delivered.
   */
  readonly ackAll: Effect.Effect<void>
  /**
   * Marks every message to be retried in the next batch.
   */
  readonly retryAll: (options?: globalThis.QueueRetryOptions) => Effect.Effect<void>
  /**
   * Get the raw MessageBatch object for direct access if needed.
   */
  readonly raw: globalThis.MessageBatch<Body>
}

export const makeMessageBatch = <Body = unknown>(
  batch: globalThis.MessageBatch<Body>
): CloudflareMessageBatch<Body> => ({
  queue: batch.queue,
  messages: batch.messages,
  ackAll: Effect.sync(() => batch.ackAll()),
  retryAll: (options) => Effect.sync(() => batch.retryAll(options)),
  raw: batch
})

/**
 * @since 1.0.0
 * @category tags
 */
export class MessageBatch extends Context.Tag("@effect/platform-cloudflare/MessageBatch")<
  MessageBatch,
  CloudflareMessageBatch
>() {}

/**
 * @since 1.0.0
 * @category models
 */
export interface CloudflareForwardableEmailMessage {
  /**
   * The email address of the sender.
   */
  readonly from: string
  /**
   * The email address of the recipient.
   */
  readonly to: string
  /**
   * The raw email message content as a ReadableStream.
   */
  readonly raw: ReadableStream<Uint8Array>
  /**
   * The headers of the email message.
   */
  readonly headers: Headers
  /**
   * The size of the raw email message in bytes.
   */
  readonly rawSize: number
  /**
   * Rejects the email with the given reason.
   */
  readonly setReject: (reason: string) => Effect.Effect<void>
  /**
   * Forwards the email to the given recipient.
   */
  readonly forward: (rcptTo: string, headers?: Headers) => Effect.Effect<void>
  /**
   * Get the raw ForwardableEmailMessage object for direct access if needed.
   */
  readonly raw_message: globalThis.ForwardableEmailMessage
}

export const makeForwardableEmailMessage = (
  message: globalThis.ForwardableEmailMessage
): CloudflareForwardableEmailMessage => ({
  from: message.from,
  to: message.to,
  raw: message.raw,
  headers: message.headers,
  rawSize: message.rawSize,
  setReject: (reason) => Effect.sync(() => message.setReject(reason)),
  forward: (rcptTo, headers) => Effect.promise(() => message.forward(rcptTo, headers)),
  raw_message: message
})

/**
 * @since 1.0.0
 * @category tags
 */
export class ForwardableEmailMessage extends Context.Tag("@effect/platform-cloudflare/ForwardableEmailMessage")<
  ForwardableEmailMessage,
  CloudflareForwardableEmailMessage
>() {}

/**
 * @since 1.0.0
 * @category models
 */
export interface CloudflareTailEvents {
  /**
   * An array of tail events.
   */
  readonly events: ReadonlyArray<globalThis.TailEvent>
  /**
   * Get the raw TailEvent array for direct access if needed.
   */
  readonly raw: ReadonlyArray<globalThis.TailEvent>
}

export const makeTailEvents = (events: ReadonlyArray<globalThis.TailEvent>): CloudflareTailEvents => ({
  events,
  raw: events
})

/**
 * @since 1.0.0
 * @category tags
 */
export class TailEvents extends Context.Tag("@effect/platform-cloudflare/TailEvents")<
  TailEvents,
  CloudflareTailEvents
>() {}

