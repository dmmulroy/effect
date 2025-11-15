/**
 * @since 1.0.0
 */
import type { RunMain } from "@effect/platform/Runtime"
import * as internal from "./internal/runtime.js"

/**
 * @since 1.0.0
 * @category entrypoint
 */
export {
  makeFetchHandler,
  makeScheduledHandler,
  makeQueueHandler,
  makeEmailHandler,
  makeTailHandler,
  makeEntrypoint
} from "./CloudflareEntrypoint.js"

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
