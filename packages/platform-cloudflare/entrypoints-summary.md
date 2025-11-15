# Cloudflare Worker Entrypoints - Implementation Summary

## Overview

Enhanced `@effect/platform-cloudflare` worker entrypoint handlers to support multiple programming patterns, providing flexibility for different use cases while maintaining backward compatibility.

## New Module: CloudflareEntrypoint

Created `src/CloudflareEntrypoint.ts` as the dedicated module for all Cloudflare Worker entrypoint handlers. This separates entrypoint concerns from runtime utilities.

**Exported handlers:**
- `makeFetchHandler` - HTTP request handler
- `makeScheduledHandler` - Cron trigger handler
- `makeQueueHandler` - Queue consumer handler
- `makeEmailHandler` - Email routing handler
- `makeTailHandler` - Tail consumer handler
- `makeEntrypoint` - Convenience function to bundle multiple handlers

## Handler Patterns

All handlers now support two programming patterns:

### 1. Effect Pattern (existing)
Access worker context via Effect services:

```ts
import { makeScheduledHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { ScheduledController } from "@effect/platform-cloudflare/CloudflareContext"

const { handler } = makeScheduledHandler({
  handler: Effect.gen(function*() {
    const controller = yield* ScheduledController
    const env = yield* Env
    const ctx = yield* ExecutionContext
    // use services...
  }),
  layer: Layer.empty
})
```

### 2. Function Pattern (new)
Receive worker context as function arguments:

```ts
import { makeScheduledHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"

const { handler } = makeScheduledHandler({
  handler: (controller, env, ctx) =>
    Effect.gen(function*() {
      // controller, env, ctx passed directly as args
    }),
  layer: Layer.empty
})
```

## Fetch Handler Additions

`makeFetchHandler` received two additional patterns:

### Direct Effect Pattern
```ts
makeFetchHandler({
  effect: Effect.succeed(new Response("hello")),
  layer: Layer.empty
})
```

### Function Pattern
```ts
makeFetchHandler({
  handler: (request, env, ctx) =>
    Effect.succeed(new Response("hello")),
  layer: Layer.empty
})
```

## Convenience: makeEntrypoint

`makeEntrypoint` bundles multiple handlers into a single Cloudflare-compatible export object.

### Benefits
- Single shared layer across all handlers (optimal resource usage)
- No manual disposal needed (runtime cleanup on worker termination)
- Both Effect and function patterns supported per handler
- Direct `export default` compatible

### Usage
```ts
import { makeEntrypoint } from "@effect/platform-cloudflare/CloudflareEntrypoint"

export default makeEntrypoint({
  layer: Layer.empty,
  handlers: {
    fetch: Effect.succeed(new Response("hello")),
    scheduled: (controller, env, ctx) =>
      Effect.log(`cron: ${controller.cron}`),
    queue: (batch, env, ctx) =>
      Effect.gen(function*() {
        yield* Effect.log(`Processing ${batch.messages.length} messages`)
        yield* batch.ackAll
      })
  }
})
```

All handler fields optional - only include handlers you need.

## Implementation Details

### Stub Handler Implementation
Previously stubbed handlers now fully implemented:
- `makeScheduledHandler` - executes provided Effect with ScheduledController context
- `makeQueueHandler` - processes MessageBatch with proper context
- `makeEmailHandler` - handles ForwardableEmailMessage with proper context
- `makeTailHandler` - processes TailEvents with proper context

All handlers:
- Create single ManagedRuntime reused across invocations
- Merge per-request context (env, ctx, handler-specific data) via Context.make/add
- Provide both Effect and function overloads using TypeScript function overloading
- Maintain backward compatibility with existing Effect-only API

### Type Exports

Added type exports to `CloudflareContext.ts`:
- `CloudflareExecutionContext` - Effectful wrapper around ExecutionContext
- `CloudflareScheduledController` - Effectful wrapper around ScheduledController
- `CloudflareMessageBatch<Body>` - Effectful wrapper around MessageBatch
- `CloudflareForwardableEmailMessage` - Effectful wrapper around ForwardableEmailMessage
- `CloudflareTailEvents` - Effectful wrapper around TailEvents

These types enable type-safe function signatures for the function pattern.

## File Changes

### Created
- `src/CloudflareEntrypoint.ts` - New entrypoint handlers module (includes `makeEntrypoint` convenience function)

### Modified
- `src/internal/runtime.ts` - Handler implementations with function overload support + `makeEntrypoint` implementation
- `src/CloudflareRuntime.ts` - Removed entrypoint handlers, kept `runMain` utility, re-exports all handlers including `makeEntrypoint`
- `src/CloudflareContext.ts` - Exported context type aliases
- `src/index.ts` - Added CloudflareEntrypoint export

### Usage

**Recommended:**
```ts
import { makeFetchHandler, makeEntrypoint } from "@effect/platform-cloudflare/CloudflareEntrypoint"
```

**Also available (re-exported):**
```ts
import { makeFetchHandler, makeEntrypoint } from "@effect/platform-cloudflare/CloudflareRuntime"
```

**Note:** All handlers (including `makeEntrypoint`) are available from both modules - CloudflareEntrypoint is the primary location, while CloudflareRuntime re-exports them for convenience.

## Cloudflare Worker Handler Reference

Based on [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/runtime-apis/handlers/):

| Handler | Signature | Use Case |
|---------|-----------|----------|
| `fetch` | `(request, env, ctx) => Response \| Promise<Response>` | HTTP requests |
| `scheduled` | `(controller, env, ctx) => void \| Promise<void>` | Cron triggers |
| `queue` | `(batch, env, ctx) => void \| Promise<void>` | Queue consumers |
| `email` | `(message, env, ctx) => void \| Promise<void>` | Email routing |
| `tail` | `(events, env, ctx) => void \| Promise<void>` | Tail consumers |

All handlers implemented and support both Effect and function patterns.

## Testing

TypeScript compilation verified with no errors:
```bash
pnpm exec tsc --noEmit
```

## Benefits

1. **Flexibility** - Choose between service injection (Effect pattern) or direct arguments (function pattern)
2. **Type Safety** - Full type inference for both patterns, no `any` or type assertions in user code
3. **Backward Compatible** - Existing Effect pattern code continues to work
4. **Ergonomic** - Function pattern reduces ceremony for simple handlers; `makeEntrypoint` simplifies multi-handler workers
5. **Consistent** - All handlers follow same dual-pattern API design
6. **Efficient** - `makeEntrypoint` shares single runtime across all handlers for optimal resource usage
