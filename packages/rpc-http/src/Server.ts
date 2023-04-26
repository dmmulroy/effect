/**
 * @since 1.0.0
 */
import type { Tag } from "@effect/data/Context"
import type { Effect } from "@effect/io/Effect"
import type { Span } from "@effect/io/Tracer"
import * as internal from "@effect/rpc-http/internal/server"
import type { RpcResponse } from "@effect/rpc/Resolver"
import type { RpcHandlers, RpcRouter } from "@effect/rpc/Router"

/**
 * @category models
 * @since 1.0.0
 */
export interface HttpRequest {
  readonly url: string
  readonly headers: Headers
  readonly body: unknown
}

/**
 * @category tags
 * @since 1.0.0
 */
export const HttpRequest: Tag<HttpRequest, HttpRequest> = internal.HttpRequest

/**
 * @category models
 * @since 1.0.0
 */
export interface RpcHttpHandler<R extends RpcRouter.Base> {
  (request: HttpRequest): Effect<
    Exclude<RpcHandlers.Services<R["handlers"]>, HttpRequest | Span>,
    never,
    ReadonlyArray<RpcResponse>
  >
}

/**
 * @category constructors
 * @since 1.0.0
 */
export const make: <R extends RpcRouter.Base>(router: R) => RpcHttpHandler<R> =
  internal.make as any