/**
 * @since 1.0.0
 */
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as internal from "./internal/wrangler.js"

/**
 * Creates a scoped platform proxy using Wrangler's getPlatformProxy.
 * Automatically disposes the proxy when the scope ends.
 *
 * This is useful for local development and testing with Wrangler's dev server.
 *
 * @since 1.0.0
 * @category wrangler
 * @example
 * ```ts
 * import { makePlatformProxy } from "@effect/platform-cloudflare/CloudflareWrangler"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const { env, ctx, caches } = yield* makePlatformProxy({
 *     configPath: "./wrangler.toml",
 *     persist: true
 *   })
 *
 *   // Use env, ctx, and caches for local development
 * })
 *
 * Effect.scoped(program).pipe(Effect.runPromise)
 * ```
 */
export const makePlatformProxy: (options?: {
  readonly configPath?: string
  readonly persist?: boolean | { readonly path: string }
  readonly environment?: string
}) => Effect.Effect<
  {
    readonly env: Record<string, unknown>
    readonly ctx: ExecutionContext
    readonly caches: unknown
    readonly dispose: () => Promise<void>
  },
  unknown,
  Scope.Scope
> = internal.makePlatformProxy

/**
 * Creates a Layer providing Wrangler platform proxy bindings via CloudflareContext services.
 * Provides CloudflareContext.Env and CloudflareContext.ExecutionContext.
 * Automatically disposes the proxy when the scope ends.
 *
 * This enables declarative dependency management consistent with Effect patterns.
 * Useful for local development with Wrangler dev server.
 *
 * @since 1.0.0
 * @category wrangler
 * @example
 * ```ts
 * import { layer } from "@effect/platform-cloudflare/CloudflareWrangler"
 * import { Env, ExecutionContext } from "@effect/platform-cloudflare/CloudflareContext"
 * import { runMain } from "@effect/platform-cloudflare/CloudflareRuntime"
 * import { Effect } from "effect"
 *
 * const WranglerLive = layer({
 *   configPath: "./wrangler.toml",
 *   persist: true
 * })
 *
 * const program = Effect.gen(function*() {
 *   const env = yield* Env
 *   const ctx = yield* ExecutionContext
 *
 *   // Use bindings
 *   const kv = env.MY_KV as KVNamespace
 * })
 *
 * runMain(program.pipe(Effect.provide(WranglerLive)))
 * ```
 *
 * @example
 * Layer composition:
 * ```ts
 * import { Layer } from "effect"
 *
 * const MainLive = Layer.mergeAll(
 *   WranglerLive,
 *   DatabaseLive,
 *   CacheLive
 * )
 *
 * runMain(program.pipe(Effect.provide(MainLive)))
 * ```
 */
export const layer = internal.layer
