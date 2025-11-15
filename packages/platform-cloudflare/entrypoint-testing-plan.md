# Cloudflare Worker Entrypoints - Testing Plan

## Overview

### Objectives
- Verify all entrypoint handlers work correctly in both Effect and Function patterns
- Ensure context (Env, ExecutionContext, handler-specific data) properly injected
- Validate runtime lifecycle (initialization, reuse, cleanup)
- Confirm type safety - no `any`, no type assertions in user code
- Test error handling and edge cases
- Verify resource cleanup and disposal
- Ensure backward compatibility

### Scope
Test all new functionality from `CloudflareEntrypoint.ts`:
- `makeFetchHandler` (4 overloads: HttpApi, HttpApp, Effect, Function)
- `makeScheduledHandler` (2 overloads: Effect, Function)
- `makeQueueHandler` (2 overloads: Effect, Function)
- `makeEmailHandler` (2 overloads: Effect, Function)
- `makeTailHandler` (2 overloads: Effect, Function)
- `makeEntrypoint` (convenience wrapper)

### Testing Strategy
1. **Unit Tests** - Mock runtime, focus on handler logic and context injection
2. **Integration Tests** - Real Workers runtime via `@cloudflare/vitest-pool-workers`
3. **Manual Tests** - `wrangler dev` for development workflow validation

---

## Testing Infrastructure

### Current Setup
- Test framework: Vitest
- Existing config: `vitest.config.ts` (node environment)
- Existing tests: `test/CloudflareRuntime.test.ts`

### New Setup Required

#### 1. Unit Test Config (Existing)
**File:** `vitest.config.ts`
- Environment: `node`
- Tests: Unit tests with mocked ExecutionContext
- Location: `test/*.test.ts`

#### 2. Integration Test Config (New)
**File:** `vitest.integration.config.ts`
```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"
import { mergeConfig } from "vitest/config"
import shared from "../../vitest.shared.js"

const config = defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2025-11-14",
          compatibilityFlags: ["nodejs_compat"]
        }
      }
    }
  }
})

export default mergeConfig(shared, config)
```

#### 3. Test Fixtures Structure
```
test/
├── CloudflareRuntime.test.ts          # Existing unit tests
├── entrypoints/
│   ├── fetch.test.ts                  # Fetch handler unit tests
│   ├── scheduled.test.ts              # Scheduled handler unit tests
│   ├── queue.test.ts                  # Queue handler unit tests
│   ├── email.test.ts                  # Email handler unit tests
│   ├── tail.test.ts                   # Tail handler unit tests
│   ├── entrypoint.test.ts             # makeEntrypoint unit tests
│   └── integration.test.ts            # Integration tests (all handlers)
└── fixtures/
    ├── example-worker/                # Existing fetch example
    └── entrypoints/                   # New test workers
        ├── scheduled-worker/
        │   ├── index.ts               # Scheduled handler examples
        │   └── wrangler.toml
        ├── queue-worker/
        │   ├── index.ts               # Queue handler examples
        │   └── wrangler.toml
        ├── email-worker/
        │   ├── index.ts               # Email handler examples
        │   └── wrangler.toml
        ├── tail-worker/
        │   ├── index.ts               # Tail handler examples
        │   └── wrangler.toml
        └── combined-worker/
            ├── index.ts               # makeEntrypoint example
            └── wrangler.toml
```

#### 4. Test Utilities
**File:** `test/utils/mocks.ts`
```typescript
// Mock ExecutionContext
export function createMockExecutionContext(): ExecutionContext {
  const waitUntilPromises: Array<Promise<unknown>> = []

  return {
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilPromises.push(promise)
    },
    passThroughOnException: () => {},
    props: {}
  }
}

// Mock ScheduledController
export function createMockScheduledController(
  options: { cron?: string; scheduledTime?: number } = {}
): globalThis.ScheduledController {
  return {
    scheduledTime: options.scheduledTime ?? Date.now(),
    cron: options.cron ?? "0 0 * * *",
    noRetry: () => {}
  }
}

// Mock MessageBatch
export function createMockMessageBatch<T = unknown>(
  queueName: string,
  messages: Array<{ id?: string; timestamp?: Date; body: T }> = []
): globalThis.MessageBatch<T> {
  const ackedMessages = new Set<string>()
  const retriedMessages = new Set<string>()

  return {
    queue: queueName,
    messages: messages.map((msg, idx) => ({
      id: msg.id ?? `msg-${idx}`,
      timestamp: msg.timestamp ?? new Date(),
      body: msg.body,
      ack: () => { ackedMessages.add(msg.id ?? `msg-${idx}`) },
      retry: () => { retriedMessages.add(msg.id ?? `msg-${idx}`) }
    })),
    ackAll: () => {
      messages.forEach((_, idx) => ackedMessages.add(`msg-${idx}`))
    },
    retryAll: () => {
      messages.forEach((_, idx) => retriedMessages.add(`msg-${idx}`))
    }
  }
}

// Mock ForwardableEmailMessage
export function createMockEmailMessage(
  options: {
    from?: string
    to?: string
    subject?: string
  } = {}
): globalThis.ForwardableEmailMessage {
  return {
    from: options.from ?? "sender@example.com",
    to: options.to ?? "recipient@example.com",
    headers: new Headers(),
    raw: new ReadableStream(),
    rawSize: 1024,
    forward: async (email: string) => {},
    setReject: (reason: string) => {}
  }
}

// Mock TailEvent
export function createMockTailEvents(
  events: Array<Partial<globalThis.TailEvent>> = []
): ReadonlyArray<globalThis.TailEvent> {
  return events.map(event => ({
    event: event.event ?? null,
    eventTimestamp: event.eventTimestamp ?? Date.now(),
    logs: event.logs ?? [],
    exceptions: event.exceptions ?? [],
    scriptName: event.scriptName ?? "test-worker"
  })) as ReadonlyArray<globalThis.TailEvent>
}
```

---

## Phase 1: Fetch Handler Tests

**File:** `test/entrypoints/fetch.test.ts`

### Test Coverage

#### 1.1 HttpApi Pattern (Existing)
```typescript
describe("makeFetchHandler - HttpApi pattern", () => {
  it("should create handler from HttpApi.Api", async () => {
    // Test API-based handler creation
    // Verify handler function signature
    // Verify dispose function
  })

  it("should handle requests with HttpApi routing", async () => {
    // Test actual request routing
    // Verify response correctness
  })

  it("should provide Env to API handlers", async () => {
    // Create handler with Env-dependent logic
    // Verify env accessible via CloudflareContext.Env
  })

  it("should provide ExecutionContext to API handlers", async () => {
    // Create handler with ExecutionContext-dependent logic
    // Verify ctx accessible via CloudflareContext.ExecutionContext
  })

  it("should cache handler after first request", async () => {
    // First request initializes
    // Second request uses cached handler
    // Verify performance improvement
  })

  it("should isolate env between requests", async () => {
    // Request 1 with env1
    // Request 2 with env2
    // Verify no cross-contamination
  })

  it("should apply middleware when provided", async () => {
    // Create handler with middleware
    // Verify middleware executes
  })
})
```

#### 1.2 HttpApp Pattern
```typescript
describe("makeFetchHandler - HttpApp pattern", () => {
  it("should create handler from HttpApp", async () => {
    const httpApp = HttpServerResponse.text("test")
    const { handler, dispose } = makeFetchHandler({
      httpApp,
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should handle requests with HttpApp", async () => {
    // Create simple HttpApp
    // Verify request handling
  })

  it("should provide context to HttpApp", async () => {
    // HttpApp that uses Env or ExecutionContext
    // Verify context accessible
  })

  it("should support complex HttpApp with routing", async () => {
    // HttpRouter-based app
    // Test multiple routes
  })
})
```

#### 1.3 Effect Pattern
```typescript
describe("makeFetchHandler - Effect pattern", () => {
  it("should create handler from Effect<Response>", async () => {
    const { handler, dispose } = makeFetchHandler({
      effect: Effect.succeed(new Response("hello")),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    await dispose()
  })

  it("should execute effect per request", async () => {
    let callCount = 0
    const effect = Effect.sync(() => {
      callCount++
      return new Response(`count: ${callCount}`)
    })

    const { handler, dispose } = makeFetchHandler({
      effect,
      layer: Layer.empty
    })

    await handler(new Request("http://localhost"), {}, mockCtx)
    await handler(new Request("http://localhost"), {}, mockCtx)

    expect(callCount).toBe(2)
    await dispose()
  })

  it("should provide Env and ExecutionContext to effect", async () => {
    const effect = Effect.gen(function*() {
      const env = yield* CloudflareContext.Env
      const ctx = yield* CloudflareContext.ExecutionContext
      expect(env).toBeDefined()
      expect(ctx).toBeDefined()
      return new Response("ok")
    })

    const { handler, dispose } = makeFetchHandler({
      effect,
      layer: Layer.empty
    })

    await handler(new Request("http://localhost"), { TEST: "val" }, mockCtx)
    await dispose()
  })

  it("should support layer dependencies", async () => {
    class TestService extends Effect.Service<TestService>()("Test", {
      effect: Effect.succeed({ value: "test" })
    }) {}

    const effect = Effect.gen(function*() {
      const svc = yield* TestService
      return new Response(svc.value)
    })

    const { handler, dispose } = makeFetchHandler({
      effect,
      layer: Layer.succeed(TestService, new TestService({ value: "test" }))
    })

    const response = await handler(new Request("http://localhost"), {}, mockCtx)
    expect(await response.text()).toBe("test")
    await dispose()
  })
})
```

#### 1.4 Function Pattern (New)
```typescript
describe("makeFetchHandler - Function pattern", () => {
  it("should create handler from function", async () => {
    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.succeed(new Response("hello")),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    await dispose()
  })

  it("should pass request to handler function", async () => {
    let receivedUrl: string | undefined

    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.sync(() => {
          receivedUrl = request.url
          return new Response("ok")
        }),
      layer: Layer.empty
    })

    await handler(new Request("http://example.com/test"), {}, mockCtx)
    expect(receivedUrl).toBe("http://example.com/test")
    await dispose()
  })

  it("should pass env to handler function", async () => {
    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.succeed(new Response(env.TEST_VAR as string)),
      layer: Layer.empty
    })

    const response = await handler(
      new Request("http://localhost"),
      { TEST_VAR: "value123" },
      mockCtx
    )

    expect(await response.text()).toBe("value123")
    await dispose()
  })

  it("should pass ExecutionContext to handler function", async () => {
    let ctxReceived = false

    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.gen(function*() {
          yield* ctx.waitUntil(Effect.sync(() => { ctxReceived = true }))
          return new Response("ok")
        }),
      layer: Layer.empty
    })

    await handler(new Request("http://localhost"), {}, mockCtx)
    expect(ctxReceived).toBe(true)
    await dispose()
  })

  it("should support layer dependencies in function pattern", async () => {
    class Database extends Effect.Service<Database>()("DB", {
      effect: Effect.succeed({ query: () => Effect.succeed("data") })
    }) {}

    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.gen(function*() {
          const db = yield* Database
          const data = yield* db.query()
          return new Response(data)
        }),
      layer: Layer.succeed(Database, new Database({
        query: () => Effect.succeed("data")
      }))
    })

    const response = await handler(new Request("http://localhost"), {}, mockCtx)
    expect(await response.text()).toBe("data")
    await dispose()
  })
})
```

#### 1.5 Error Handling
```typescript
describe("makeFetchHandler - Error handling", () => {
  it("should handle Effect failures gracefully", async () => {
    const { handler, dispose } = makeFetchHandler({
      effect: Effect.fail(new Error("test error")),
      layer: Layer.empty
    })

    const response = await handler(new Request("http://localhost"), {}, mockCtx)
    expect(response.status).toBeGreaterThanOrEqual(500)
    await dispose()
  })

  it("should handle Effect defects", async () => {
    const { handler, dispose } = makeFetchHandler({
      effect: Effect.die(new Error("defect")),
      layer: Layer.empty
    })

    const response = await handler(new Request("http://localhost"), {}, mockCtx)
    expect(response.status).toBeGreaterThanOrEqual(500)
    await dispose()
  })

  it("should handle function pattern errors", async () => {
    const { handler, dispose } = makeFetchHandler({
      handler: () => Effect.fail(new Error("function error")),
      layer: Layer.empty
    })

    const response = await handler(new Request("http://localhost"), {}, mockCtx)
    expect(response.status).toBeGreaterThanOrEqual(500)
    await dispose()
  })
})
```

#### 1.6 Resource Cleanup
```typescript
describe("makeFetchHandler - Resource cleanup", () => {
  it("should cleanup layer resources on dispose", async () => {
    let cleanupCalled = false

    const ResourceLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.succeed({}),
        () => Effect.sync(() => { cleanupCalled = true })
      )
    )

    const { handler, dispose } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: ResourceLayer
    })

    await handler(new Request("http://localhost"), {}, mockCtx)
    expect(cleanupCalled).toBe(false)

    await dispose()
    expect(cleanupCalled).toBe(true)
  })

  it("should handle multiple dispose calls", async () => {
    const { dispose } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    await dispose()
    await dispose() // Should not throw
  })
})
```

---

## Phase 2: Scheduled Handler Tests

**File:** `test/entrypoints/scheduled.test.ts`

### Test Coverage

#### 2.1 Effect Pattern
```typescript
describe("makeScheduledHandler - Effect pattern", () => {
  it("should create scheduled handler from Effect", () => {
    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.log("cron executed"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should execute effect on scheduled invocation", async () => {
    let executed = false

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.sync(() => { executed = true }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    await handler(controller, {}, mockCtx)

    expect(executed).toBe(true)
    await dispose()
  })

  it("should provide ScheduledController via service", async () => {
    let receivedCron: string | undefined
    let receivedTime: number | undefined

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const controller = yield* CloudflareContext.ScheduledController
        receivedCron = controller.cron
        receivedTime = controller.scheduledTime
      }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController({
      cron: "0 12 * * *",
      scheduledTime: 1234567890
    })

    await handler(controller, {}, mockCtx)

    expect(receivedCron).toBe("0 12 * * *")
    expect(receivedTime).toBe(1234567890)
    await dispose()
  })

  it("should provide Env to handler", async () => {
    let receivedEnv: Record<string, unknown> | undefined

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        receivedEnv = yield* CloudflareContext.Env
      }),
      layer: Layer.empty
    })

    const env = { CRON_KEY: "secret" }
    await handler(createMockScheduledController(), env, mockCtx)

    expect(receivedEnv).toEqual(env)
    await dispose()
  })

  it("should provide ExecutionContext to handler", async () => {
    let ctxReceived = false

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const ctx = yield* CloudflareContext.ExecutionContext
        yield* ctx.waitUntil(Effect.sync(() => { ctxReceived = true }))
      }),
      layer: Layer.empty
    })

    await handler(createMockScheduledController(), {}, mockCtx)

    expect(ctxReceived).toBe(true)
    await dispose()
  })

  it("should support layer dependencies", async () => {
    class CronService extends Effect.Service<CronService>()("Cron", {
      effect: Effect.succeed({ execute: () => Effect.log("cron") })
    }) {}

    let serviceUsed = false

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const svc = yield* CronService
        yield* svc.execute()
        serviceUsed = true
      }),
      layer: Layer.succeed(CronService, new CronService({
        execute: () => Effect.log("cron")
      }))
    })

    await handler(createMockScheduledController(), {}, mockCtx)

    expect(serviceUsed).toBe(true)
    await dispose()
  })
})
```

#### 2.2 Function Pattern
```typescript
describe("makeScheduledHandler - Function pattern", () => {
  it("should create handler from function", () => {
    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) => Effect.log("scheduled"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should pass ScheduledController to function", async () => {
    let receivedCron: string | undefined

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.sync(() => {
          receivedCron = controller.cron
        }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController({ cron: "*/5 * * * *" })
    await handler(controller, {}, mockCtx)

    expect(receivedCron).toBe("*/5 * * * *")
    await dispose()
  })

  it("should pass env to function", async () => {
    let receivedEnv: Record<string, unknown> | undefined

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.sync(() => {
          receivedEnv = env
        }),
      layer: Layer.empty
    })

    const testEnv = { KEY: "value" }
    await handler(createMockScheduledController(), testEnv, mockCtx)

    expect(receivedEnv).toEqual(testEnv)
    await dispose()
  })

  it("should pass ExecutionContext to function", async () => {
    let backgroundTaskRan = false

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.gen(function*() {
          yield* ctx.waitUntil(
            Effect.sync(() => { backgroundTaskRan = true })
          )
        }),
      layer: Layer.empty
    })

    await handler(createMockScheduledController(), {}, mockCtx)

    expect(backgroundTaskRan).toBe(true)
    await dispose()
  })

  it("should support layer dependencies in function pattern", async () => {
    class Analytics extends Effect.Service<Analytics>()("Analytics", {
      effect: Effect.succeed({ track: () => Effect.log("tracked") })
    }) {}

    let tracked = false

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.gen(function*() {
          const analytics = yield* Analytics
          yield* analytics.track()
          tracked = true
        }),
      layer: Layer.succeed(Analytics, new Analytics({
        track: () => Effect.log("tracked")
      }))
    })

    await handler(createMockScheduledController(), {}, mockCtx)

    expect(tracked).toBe(true)
    await dispose()
  })
})
```

#### 2.3 Error Handling & Cleanup
```typescript
describe("makeScheduledHandler - Error handling", () => {
  it("should handle Effect failures", async () => {
    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.fail(new Error("scheduled error")),
      layer: Layer.empty
    })

    await expect(
      handler(createMockScheduledController(), {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should cleanup resources on dispose", async () => {
    let cleanupCalled = false

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.void,
      layer: Layer.effectDiscard(
        Effect.acquireRelease(
          Effect.succeed({}),
          () => Effect.sync(() => { cleanupCalled = true })
        )
      )
    })

    await handler(createMockScheduledController(), {}, mockCtx)
    await dispose()

    expect(cleanupCalled).toBe(true)
  })
})
```

---

## Phase 3: Queue Handler Tests

**File:** `test/entrypoints/queue.test.ts`

### Test Coverage

#### 3.1 Effect Pattern
```typescript
describe("makeQueueHandler - Effect pattern", () => {
  it("should create queue handler from Effect", () => {
    const { handler, dispose } = makeQueueHandler({
      handler: Effect.log("queue processed"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should execute effect on queue invocation", async () => {
    let executed = false

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.sync(() => { executed = true }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("test-queue", [])
    await handler(batch, {}, mockCtx)

    expect(executed).toBe(true)
    await dispose()
  })

  it("should provide MessageBatch via service", async () => {
    let receivedQueueName: string | undefined
    let receivedMessageCount: number | undefined

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        receivedQueueName = batch.queue
        receivedMessageCount = batch.messages.length
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("my-queue", [
      { body: { data: "msg1" } },
      { body: { data: "msg2" } }
    ])

    await handler(batch, {}, mockCtx)

    expect(receivedQueueName).toBe("my-queue")
    expect(receivedMessageCount).toBe(2)
    await dispose()
  })

  it("should process messages from batch", async () => {
    const processedMessages: Array<unknown> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        for (const msg of batch.messages) {
          processedMessages.push(msg.body)
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { body: { id: 1 } },
      { body: { id: 2 } },
      { body: { id: 3 } }
    ])

    await handler(batch, {}, mockCtx)

    expect(processedMessages).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 }
    ])
    await dispose()
  })

  it("should support ackAll operation", async () => {
    let ackAllCalled = false

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        yield* batch.ackAll
        ackAllCalled = true
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [{ body: {} }])
    await handler(batch, {}, mockCtx)

    expect(ackAllCalled).toBe(true)
    await dispose()
  })

  it("should provide Env and ExecutionContext", async () => {
    let receivedEnv: Record<string, unknown> | undefined
    let ctxAvailable = false

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        receivedEnv = yield* CloudflareContext.Env
        const ctx = yield* CloudflareContext.ExecutionContext
        ctxAvailable = true
      }),
      layer: Layer.empty
    })

    const env = { QUEUE_SECRET: "key" }
    await handler(createMockMessageBatch("queue", []), env, mockCtx)

    expect(receivedEnv).toEqual(env)
    expect(ctxAvailable).toBe(true)
    await dispose()
  })
})
```

#### 3.2 Function Pattern
```typescript
describe("makeQueueHandler - Function pattern", () => {
  it("should create handler from function", () => {
    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) => Effect.log("processing"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should pass MessageBatch to function", async () => {
    let receivedQueue: string | undefined
    let receivedMessages: Array<unknown> = []

    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.sync(() => {
          receivedQueue = batch.queue
          receivedMessages = batch.messages.map(m => m.body)
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("orders", [
      { body: { orderId: "A" } },
      { body: { orderId: "B" } }
    ])

    await handler(batch, {}, mockCtx)

    expect(receivedQueue).toBe("orders")
    expect(receivedMessages).toEqual([
      { orderId: "A" },
      { orderId: "B" }
    ])
    await dispose()
  })

  it("should support message acknowledgment", async () => {
    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          for (const msg of batch.messages) {
            yield* msg.ack
          }
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { body: {} },
      { body: {} }
    ])

    await handler(batch, {}, mockCtx)
    await dispose()
  })

  it("should support message retry", async () => {
    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          for (const msg of batch.messages) {
            // Retry failed messages
            if ((msg.body as any).shouldRetry) {
              yield* msg.retry
            } else {
              yield* msg.ack
            }
          }
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { body: { shouldRetry: true } },
      { body: { shouldRetry: false } }
    ])

    await handler(batch, {}, mockCtx)
    await dispose()
  })

  it("should pass env and ctx to function", async () => {
    let receivedEnv: Record<string, unknown> | undefined
    let ctxUsed = false

    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          receivedEnv = env
          yield* ctx.waitUntil(Effect.sync(() => { ctxUsed = true }))
        }),
      layer: Layer.empty
    })

    const env = { API_KEY: "secret" }
    await handler(createMockMessageBatch("queue", []), env, mockCtx)

    expect(receivedEnv).toEqual(env)
    expect(ctxUsed).toBe(true)
    await dispose()
  })
})
```

#### 3.3 Typed Message Bodies
```typescript
describe("makeQueueHandler - Typed messages", () => {
  interface OrderMessage {
    orderId: string
    amount: number
  }

  it("should support typed message bodies in Effect pattern", async () => {
    const orders: Array<OrderMessage> = []

    const { handler, dispose } = makeQueueHandler<never, never, OrderMessage>({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        for (const msg of batch.messages) {
          orders.push(msg.body)
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch<OrderMessage>("orders", [
      { body: { orderId: "ORD-1", amount: 100 } },
      { body: { orderId: "ORD-2", amount: 200 } }
    ])

    await handler(batch, {}, mockCtx)

    expect(orders).toEqual([
      { orderId: "ORD-1", amount: 100 },
      { orderId: "ORD-2", amount: 200 }
    ])
    await dispose()
  })

  it("should support typed message bodies in Function pattern", async () => {
    const orderIds: Array<string> = []

    const { handler, dispose } = makeQueueHandler<never, never, OrderMessage>({
      handler: (batch, env, ctx) =>
        Effect.sync(() => {
          batch.messages.forEach(msg => orderIds.push(msg.body.orderId))
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch<OrderMessage>("orders", [
      { body: { orderId: "A", amount: 50 } }
    ])

    await handler(batch, {}, mockCtx)

    expect(orderIds).toEqual(["A"])
    await dispose()
  })
})
```

---

## Phase 4: Email Handler Tests

**File:** `test/entrypoints/email.test.ts`

### Test Coverage

#### 4.1 Effect Pattern
```typescript
describe("makeEmailHandler - Effect pattern", () => {
  it("should create email handler from Effect", () => {
    const { handler, dispose } = makeEmailHandler({
      handler: Effect.log("email received"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should provide ForwardableEmailMessage via service", async () => {
    let receivedFrom: string | undefined
    let receivedTo: string | undefined

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        receivedFrom = message.from
        receivedTo = message.to
      }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage({
      from: "alice@example.com",
      to: "bob@example.com"
    })

    await handler(email, {}, mockCtx)

    expect(receivedFrom).toBe("alice@example.com")
    expect(receivedTo).toBe("bob@example.com")
    await dispose()
  })

  it("should support email forwarding", async () => {
    let forwardedTo: string | undefined

    const mockEmail = {
      ...createMockEmailMessage(),
      forward: async (email: string) => {
        forwardedTo = email
      }
    }

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        yield* message.forward("admin@example.com")
      }),
      layer: Layer.empty
    })

    await handler(mockEmail, {}, mockCtx)

    expect(forwardedTo).toBe("admin@example.com")
    await dispose()
  })

  it("should access email headers", async () => {
    let subjectHeader: string | null = null

    const mockEmail = createMockEmailMessage()
    mockEmail.headers.set("Subject", "Test Email")

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        subjectHeader = message.headers.get("Subject")
      }),
      layer: Layer.empty
    })

    await handler(mockEmail, {}, mockCtx)

    expect(subjectHeader).toBe("Test Email")
    await dispose()
  })

  it("should provide Env and ExecutionContext", async () => {
    let envReceived: Record<string, unknown> | undefined
    let ctxAvailable = false

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        envReceived = yield* CloudflareContext.Env
        const ctx = yield* CloudflareContext.ExecutionContext
        ctxAvailable = true
      }),
      layer: Layer.empty
    })

    const env = { EMAIL_SECRET: "key" }
    await handler(createMockEmailMessage(), env, mockCtx)

    expect(envReceived).toEqual(env)
    expect(ctxAvailable).toBe(true)
    await dispose()
  })
})
```

#### 4.2 Function Pattern
```typescript
describe("makeEmailHandler - Function pattern", () => {
  it("should create handler from function", () => {
    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) => Effect.log("email"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should pass email message to function", async () => {
    let from: string | undefined
    let to: string | undefined

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.sync(() => {
          from = message.from
          to = message.to
        }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage({
      from: "sender@test.com",
      to: "receiver@test.com"
    })

    await handler(email, {}, mockCtx)

    expect(from).toBe("sender@test.com")
    expect(to).toBe("receiver@test.com")
    await dispose()
  })

  it("should support forwarding in function pattern", async () => {
    let forwarded = false

    const mockEmail = {
      ...createMockEmailMessage(),
      forward: async () => { forwarded = true }
    }

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          yield* message.forward("admin@example.com")
        }),
      layer: Layer.empty
    })

    await handler(mockEmail, {}, mockCtx)

    expect(forwarded).toBe(true)
    await dispose()
  })

  it("should support rejection in function pattern", async () => {
    let rejected = false
    let rejectReason: string | undefined

    const mockEmail = {
      ...createMockEmailMessage(),
      setReject: (reason: string) => {
        rejected = true
        rejectReason = reason
      }
    }

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.sync(() => {
          message.setReject("spam detected")
        }),
      layer: Layer.empty
    })

    await handler(mockEmail, {}, mockCtx)

    expect(rejected).toBe(true)
    expect(rejectReason).toBe("spam detected")
    await dispose()
  })
})
```

---

## Phase 5: Tail Handler Tests

**File:** `test/entrypoints/tail.test.ts`

### Test Coverage

#### 5.1 Effect Pattern
```typescript
describe("makeTailHandler - Effect pattern", () => {
  it("should create tail handler from Effect", () => {
    const { handler, dispose } = makeTailHandler({
      handler: Effect.log("tail events received"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should provide TailEvents via service", async () => {
    let receivedEventCount: number | undefined

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        receivedEventCount = tail.events.length
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "worker-1" },
      { scriptName: "worker-2" }
    ])

    await handler(events, {}, mockCtx)

    expect(receivedEventCount).toBe(2)
    await dispose()
  })

  it("should process tail events", async () => {
    const scriptNames: Array<string> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        for (const event of tail.events) {
          scriptNames.push(event.scriptName)
        }
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "api-worker" },
      { scriptName: "cron-worker" }
    ])

    await handler(events, {}, mockCtx)

    expect(scriptNames).toEqual(["api-worker", "cron-worker"])
    await dispose()
  })

  it("should access event logs", async () => {
    const logMessages: Array<Array<unknown>> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        for (const event of tail.events) {
          logMessages.push(event.logs)
        }
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { logs: ["log1", "log2"] },
      { logs: ["log3"] }
    ])

    await handler(events, {}, mockCtx)

    expect(logMessages).toEqual([["log1", "log2"], ["log3"]])
    await dispose()
  })

  it("should access event exceptions", async () => {
    const exceptionCounts: Array<number> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        for (const event of tail.events) {
          exceptionCounts.push(event.exceptions.length)
        }
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { exceptions: [{ name: "Error" }] },
      { exceptions: [] }
    ])

    await handler(events, {}, mockCtx)

    expect(exceptionCounts).toEqual([1, 0])
    await dispose()
  })
})
```

#### 5.2 Function Pattern
```typescript
describe("makeTailHandler - Function pattern", () => {
  it("should create handler from function", () => {
    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) => Effect.log("tail"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should pass tail events to function", async () => {
    let eventCount: number | undefined

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          eventCount = tail.events.length
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([{}, {}, {}])
    await handler(events, {}, mockCtx)

    expect(eventCount).toBe(3)
    await dispose()
  })

  it("should process events in function pattern", async () => {
    const timestamps: Array<number> = []

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach(event => {
            timestamps.push(event.eventTimestamp)
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { eventTimestamp: 1000 },
      { eventTimestamp: 2000 }
    ])

    await handler(events, {}, mockCtx)

    expect(timestamps).toEqual([1000, 2000])
    await dispose()
  })
})
```

---

## Phase 6: makeEntrypoint Tests

**File:** `test/entrypoints/entrypoint.test.ts`

### Test Coverage

#### 6.1 Single Handler
```typescript
describe("makeEntrypoint - Single handler", () => {
  it("should create entrypoint with only fetch handler", async () => {
    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: Effect.succeed(new Response("hello"))
      }
    })

    expect(entrypoint.fetch).toBeDefined()
    expect(entrypoint.scheduled).toBeUndefined()
    expect(entrypoint.queue).toBeUndefined()
    expect(entrypoint.email).toBeUndefined()
    expect(entrypoint.tail).toBeUndefined()
  })

  it("should execute fetch handler", async () => {
    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: Effect.succeed(new Response("test"))
      }
    })

    const response = await entrypoint.fetch!(
      new Request("http://localhost"),
      {},
      mockCtx
    )

    expect(await response.text()).toBe("test")
  })

  it("should create entrypoint with only scheduled handler", async () => {
    let executed = false

    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        scheduled: Effect.sync(() => { executed = true })
      }
    })

    expect(entrypoint.fetch).toBeUndefined()
    expect(entrypoint.scheduled).toBeDefined()

    await entrypoint.scheduled!(
      createMockScheduledController(),
      {},
      mockCtx
    )

    expect(executed).toBe(true)
  })
})
```

#### 6.2 Multiple Handlers
```typescript
describe("makeEntrypoint - Multiple handlers", () => {
  it("should create entrypoint with all handlers", () => {
    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: Effect.succeed(new Response("ok")),
        scheduled: Effect.void,
        queue: Effect.void,
        email: Effect.void,
        tail: Effect.void
      }
    })

    expect(entrypoint.fetch).toBeDefined()
    expect(entrypoint.scheduled).toBeDefined()
    expect(entrypoint.queue).toBeDefined()
    expect(entrypoint.email).toBeDefined()
    expect(entrypoint.tail).toBeDefined()
  })

  it("should execute all handlers independently", async () => {
    const executions: Array<string> = []

    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: Effect.sync(() => {
          executions.push("fetch")
          return new Response("ok")
        }),
        scheduled: Effect.sync(() => { executions.push("scheduled") }),
        queue: Effect.sync(() => { executions.push("queue") })
      }
    })

    await entrypoint.fetch!(new Request("http://localhost"), {}, mockCtx)
    await entrypoint.scheduled!(createMockScheduledController(), {}, mockCtx)
    await entrypoint.queue!(createMockMessageBatch("q", []), {}, mockCtx)

    expect(executions).toEqual(["fetch", "scheduled", "queue"])
  })
})
```

#### 6.3 Mixed Patterns
```typescript
describe("makeEntrypoint - Mixed patterns", () => {
  it("should support Effect and Function patterns together", async () => {
    const results: Array<string> = []

    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        // Effect pattern
        fetch: Effect.sync(() => {
          results.push("fetch-effect")
          return new Response("ok")
        }),
        // Function pattern
        scheduled: (controller, env, ctx) =>
          Effect.sync(() => {
            results.push(`scheduled-fn-${controller.cron}`)
          }),
        // Function pattern
        queue: (batch, env, ctx) =>
          Effect.sync(() => {
            results.push(`queue-fn-${batch.queue}`)
          })
      }
    })

    await entrypoint.fetch!(new Request("http://localhost"), {}, mockCtx)
    await entrypoint.scheduled!(
      createMockScheduledController({ cron: "0 * * * *" }),
      {},
      mockCtx
    )
    await entrypoint.queue!(createMockMessageBatch("orders", []), {}, mockCtx)

    expect(results).toEqual([
      "fetch-effect",
      "scheduled-fn-0 * * * *",
      "queue-fn-orders"
    ])
  })
})
```

#### 6.4 Shared Layer
```typescript
describe("makeEntrypoint - Shared layer", () => {
  it("should share layer across all handlers", async () => {
    class Database extends Effect.Service<Database>()("DB", {
      effect: Effect.succeed({
        query: () => Effect.succeed("data"),
        connectionCount: 0
      })
    }) {}

    let connectionCount = 0

    const DatabaseLive = Layer.succeed(Database, new Database({
      query: () => Effect.succeed("data"),
      get connectionCount() { return ++connectionCount }
    }))

    const entrypoint = makeEntrypoint({
      layer: DatabaseLive,
      handlers: {
        fetch: Effect.gen(function*() {
          const db = yield* Database
          return new Response(`fetch-${db.connectionCount}`)
        }),
        scheduled: (controller, env, ctx) =>
          Effect.gen(function*() {
            const db = yield* Database
            // Connection count should be same (shared runtime)
          })
      }
    })

    const response1 = await entrypoint.fetch!(
      new Request("http://localhost"),
      {},
      mockCtx
    )

    await entrypoint.scheduled!(
      createMockScheduledController(),
      {},
      mockCtx
    )

    // Verify shared runtime (connection initialized once)
    expect(connectionCount).toBe(1)
  })

  it("should cleanup shared layer resources", async () => {
    let cleanupCalled = false

    const ResourceLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.succeed({}),
        () => Effect.sync(() => { cleanupCalled = true })
      )
    )

    const entrypoint = makeEntrypoint({
      layer: ResourceLayer,
      handlers: {
        fetch: Effect.succeed(new Response("ok")),
        scheduled: Effect.void
      }
    })

    await entrypoint.fetch!(new Request("http://localhost"), {}, mockCtx)

    // Note: makeEntrypoint doesn't expose dispose - cleanup happens on worker termination
    // This is by design for the convenience API

    // In real Workers runtime, resources would cleanup when isolate terminates
    expect(cleanupCalled).toBe(false) // Not cleaned up yet
  })
})
```

#### 6.5 Context Isolation
```typescript
describe("makeEntrypoint - Context isolation", () => {
  it("should isolate env between handler invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: (request, env, ctx) =>
          Effect.sync(() => {
            envsSeen.push(env)
            return new Response("ok")
          })
      }
    })

    await entrypoint.fetch!(
      new Request("http://localhost"),
      { VAR: "value1" },
      mockCtx
    )

    await entrypoint.fetch!(
      new Request("http://localhost"),
      { VAR: "value2" },
      mockCtx
    )

    expect(envsSeen[0]).toEqual({ VAR: "value1" })
    expect(envsSeen[1]).toEqual({ VAR: "value2" })
  })

  it("should isolate context between different handlers", async () => {
    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: Effect.gen(function*() {
          const env = yield* CloudflareContext.Env
          return new Response(JSON.stringify(env))
        }),
        scheduled: Effect.gen(function*() {
          const env = yield* CloudflareContext.Env
          const controller = yield* CloudflareContext.ScheduledController
          // Different context than fetch
        })
      }
    })

    const response = await entrypoint.fetch!(
      new Request("http://localhost"),
      { FETCH_VAR: "fetch-value" },
      mockCtx
    )

    await entrypoint.scheduled!(
      createMockScheduledController(),
      { CRON_VAR: "cron-value" },
      mockCtx
    )

    const fetchEnv = await response.json()
    expect(fetchEnv).toEqual({ FETCH_VAR: "fetch-value" })
  })
})
```

#### 6.6 Type Safety
```typescript
describe("makeEntrypoint - Type safety", () => {
  it("should infer correct handler types", () => {
    interface MyEnv {
      API_KEY: string
      DB: unknown
    }

    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: (request, env, ctx) =>
          Effect.succeed(new Response((env as MyEnv).API_KEY)),
        scheduled: (controller, env, ctx) =>
          Effect.log(`Cron: ${controller.cron}`)
      }
    })

    // TypeScript should infer correct types
    expect(entrypoint.fetch).toBeDefined()
    expect(entrypoint.scheduled).toBeDefined()
  })

  it("should support typed queue messages", () => {
    interface OrderMessage {
      orderId: string
      total: number
    }

    const entrypoint = makeEntrypoint<never, never, OrderMessage>({
      layer: Layer.empty,
      handlers: {
        queue: (batch, env, ctx) =>
          Effect.sync(() => {
            batch.messages.forEach(msg => {
              // msg.body is typed as OrderMessage
              const orderId: string = msg.body.orderId
              const total: number = msg.body.total
            })
          })
      }
    })

    expect(entrypoint.queue).toBeDefined()
  })
})
```

---

## Phase 7: Integration Tests

**File:** `test/entrypoints/integration.test.ts`

Uses `@cloudflare/vitest-pool-workers` for real Workers runtime testing.

### Prerequisites
```bash
pnpm add -D @cloudflare/vitest-pool-workers
```

### Test Coverage

#### 7.1 Fetch Handler Integration
```typescript
import { describe, it, expect } from "vitest"
import { env, SELF } from "cloudflare:test"

describe("Fetch handler integration", () => {
  it("should handle real HTTP requests", async () => {
    const response = await SELF.fetch("http://example.com/")
    expect(response.status).toBe(200)
  })

  it("should access real env bindings", async () => {
    // env object contains actual bindings from wrangler.toml
    expect(env.ENVIRONMENT).toBeDefined()
  })
})
```

#### 7.2 Scheduled Handler Integration
```typescript
import { createScheduledController, createExecutionContext } from "cloudflare:test"
import worker from "../fixtures/entrypoints/scheduled-worker/index.js"

describe("Scheduled handler integration", () => {
  it("should execute on schedule", async () => {
    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: "0 0 * * *"
    })
    const ctx = createExecutionContext()

    await worker.scheduled(controller, env, ctx)

    // Verify side effects
  })

  it("should handle different cron patterns", async () => {
    const patterns = ["*/5 * * * *", "0 12 * * *", "0 0 1 * *"]

    for (const cron of patterns) {
      const controller = createScheduledController({ cron })
      const ctx = createExecutionContext()

      await worker.scheduled(controller, env, ctx)
    }
  })
})
```

#### 7.3 Queue Handler Integration
```typescript
import { createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test"
import worker from "../fixtures/entrypoints/queue-worker/index.js"

describe("Queue handler integration", () => {
  it("should process queue messages", async () => {
    const batch = createMessageBatch("test-queue", [
      { body: { id: 1, data: "test1" } },
      { body: { id: 2, data: "test2" } }
    ])
    const ctx = createExecutionContext()

    await worker.queue(batch, env, ctx)

    const result = await getQueueResult(batch, ctx)
    expect(result.ackAll).toBe(true)
  })

  it("should handle message acknowledgment", async () => {
    const batch = createMessageBatch("orders", [
      { body: { orderId: "A", valid: true } },
      { body: { orderId: "B", valid: false } }
    ])
    const ctx = createExecutionContext()

    await worker.queue(batch, env, ctx)

    const result = await getQueueResult(batch, ctx)
    expect(result.acked).toContain("msg-0")
    expect(result.retried).toContain("msg-1")
  })
})
```

#### 7.4 Combined Handlers Integration
```typescript
import worker from "../fixtures/entrypoints/combined-worker/index.js"

describe("Combined handlers integration", () => {
  it("should handle fetch requests", async () => {
    const response = await worker.fetch(
      new Request("http://example.com/api/test"),
      env,
      createExecutionContext()
    )

    expect(response.status).toBe(200)
  })

  it("should handle scheduled events", async () => {
    await worker.scheduled(
      createScheduledController({ cron: "0 * * * *" }),
      env,
      createExecutionContext()
    )
  })

  it("should handle queue messages", async () => {
    const batch = createMessageBatch("notifications", [
      { body: { type: "email", to: "user@example.com" } }
    ])

    await worker.queue(batch, env, createExecutionContext())
  })

  it("should share runtime across handlers", async () => {
    // All handlers share same layer/runtime
    // Verify state/resources properly shared

    const response1 = await worker.fetch(
      new Request("http://example.com/init"),
      env,
      createExecutionContext()
    )

    // Scheduled handler should see state from fetch
    await worker.scheduled(
      createScheduledController(),
      env,
      createExecutionContext()
    )
  })
})
```

#### 7.5 Real Bindings Tests
```typescript
describe("Real Cloudflare bindings", () => {
  it("should work with KV namespace", async () => {
    // Requires KV binding in wrangler.toml
    // [[kv_namespaces]]
    // binding = "MY_KV"
    // id = "..."

    await env.MY_KV.put("test-key", "test-value")
    const value = await env.MY_KV.get("test-key")
    expect(value).toBe("test-value")
  })

  it("should work with R2 bucket", async () => {
    // Requires R2 binding in wrangler.toml
    await env.MY_BUCKET.put("file.txt", "contents")
    const obj = await env.MY_BUCKET.get("file.txt")
    expect(obj).toBeDefined()
  })

  it("should work with D1 database", async () => {
    // Requires D1 binding in wrangler.toml
    const result = await env.DB.prepare("SELECT 1 as num").first()
    expect(result.num).toBe(1)
  })
})
```

---

## Phase 8: Manual Testing with Wrangler Dev

### 8.1 Test Fixtures Setup

#### Fetch Handler Fixture
**File:** `test/fixtures/entrypoints/fetch-worker/index.ts`
```typescript
import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Effect, Layer } from "effect"

// Effect pattern
const effectHandler = makeFetchHandler({
  effect: Effect.succeed(new Response("Effect pattern works!")),
  layer: Layer.empty
})

// Function pattern
const functionHandler = makeFetchHandler({
  handler: (request, env, ctx) =>
    Effect.succeed(new Response(`URL: ${request.url}`)),
  layer: Layer.empty
})

export default { fetch: functionHandler.handler }
```

**File:** `test/fixtures/entrypoints/fetch-worker/wrangler.toml`
```toml
name = "test-fetch-worker"
main = "index.ts"
compatibility_date = "2025-11-14"
```

#### Scheduled Handler Fixture
**File:** `test/fixtures/entrypoints/scheduled-worker/index.ts`
```typescript
import { makeScheduledHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { ScheduledController } from "@effect/platform-cloudflare/CloudflareContext"
import { Effect, Layer } from "effect"

const { handler } = makeScheduledHandler({
  handler: Effect.gen(function*() {
    const controller = yield* ScheduledController
    yield* Effect.log(`Cron: ${controller.cron}`)
    yield* Effect.log(`Scheduled: ${new Date(controller.scheduledTime)}`)
  }),
  layer: Layer.empty
})

export default { scheduled: handler }
```

#### Queue Handler Fixture
**File:** `test/fixtures/entrypoints/queue-worker/index.ts`
```typescript
import { makeQueueHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { MessageBatch } from "@effect/platform-cloudflare/CloudflareContext"
import { Effect, Layer } from "effect"

const { handler } = makeQueueHandler({
  handler: Effect.gen(function*() {
    const batch = yield* MessageBatch
    yield* Effect.log(`Queue: ${batch.queue}`)
    yield* Effect.log(`Messages: ${batch.messages.length}`)

    for (const msg of batch.messages) {
      yield* Effect.log(`Processing: ${JSON.stringify(msg.body)}`)
      yield* msg.ack
    }
  }),
  layer: Layer.empty
})

export default { queue: handler }
```

#### Combined Handler Fixture
**File:** `test/fixtures/entrypoints/combined-worker/index.ts`
```typescript
import { makeEntrypoint } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Effect, Layer } from "effect"

export default makeEntrypoint({
  layer: Layer.empty,
  handlers: {
    fetch: (request, env, ctx) =>
      Effect.succeed(new Response("Fetch handler")),

    scheduled: (controller, env, ctx) =>
      Effect.log(`Cron executed: ${controller.cron}`),

    queue: (batch, env, ctx) =>
      Effect.gen(function*() {
        yield* Effect.log(`Processing ${batch.messages.length} messages`)
        yield* batch.ackAll
      })
  }
})
```

### 8.2 Manual Test Procedures

#### Test Fetch Handler
```bash
# Start dev server
cd test/fixtures/entrypoints/fetch-worker
wrangler dev

# In another terminal
curl http://localhost:8787/

# Expected: Response with URL
```

#### Test Scheduled Handler
```bash
cd test/fixtures/entrypoints/scheduled-worker
wrangler dev

# Trigger scheduled event (wrangler CLI)
# Note: May need to use wrangler trigger or test via vitest integration
```

#### Test Queue Handler
```bash
cd test/fixtures/entrypoints/queue-worker
wrangler dev

# Send queue message (requires queue setup in wrangler.toml)
# Use wrangler queue send or vitest integration
```

---

## Phase 9: Edge Cases & Error Scenarios

### Test Coverage

#### 9.1 Handler Lifecycle
```typescript
describe("Handler lifecycle", () => {
  it("should initialize handler lazily", async () => {
    let initCount = 0

    const layer = Layer.effectDiscard(
      Effect.sync(() => { initCount++ })
    )

    const { handler } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer
    })

    expect(initCount).toBe(0) // Not initialized yet

    await handler(new Request("http://localhost"), {}, mockCtx)
    expect(initCount).toBe(1) // Initialized on first request

    await handler(new Request("http://localhost"), {}, mockCtx)
    expect(initCount).toBe(1) // Reused, not re-initialized
  })

  it("should handle concurrent first requests", async () => {
    const { handler } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    // Multiple concurrent first requests
    const promises = Array.from({ length: 10 }, () =>
      handler(new Request("http://localhost"), {}, mockCtx)
    )

    const responses = await Promise.all(promises)

    expect(responses).toHaveLength(10)
    responses.forEach(r => expect(r.status).toBe(200))
  })
})
```

#### 9.2 Context Edge Cases
```typescript
describe("Context edge cases", () => {
  it("should handle undefined env", async () => {
    const { handler } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.succeed(new Response(JSON.stringify(env))),
      layer: Layer.empty
    })

    const response = await handler(
      new Request("http://localhost"),
      undefined as any,
      mockCtx
    )

    expect(await response.text()).toBe("undefined")
  })

  it("should handle empty env object", async () => {
    const { handler } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.gen(function*() {
          const e = yield* CloudflareContext.Env
          return new Response(JSON.stringify(e))
        }),
      layer: Layer.empty
    })

    const response = await handler(
      new Request("http://localhost"),
      {},
      mockCtx
    )

    expect(await response.text()).toBe("{}")
  })

  it("should handle missing ExecutionContext methods", async () => {
    const minimalCtx = {} as ExecutionContext

    const { handler } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    // Should not throw even with minimal context
    const response = await handler(
      new Request("http://localhost"),
      {},
      minimalCtx
    )

    expect(response.status).toBe(200)
  })
})
```

#### 9.3 Error Recovery
```typescript
describe("Error recovery", () => {
  it("should recover from layer initialization failure", async () => {
    let attemptCount = 0

    const FlakyLayer = Layer.effectDiscard(
      Effect.sync(() => {
        attemptCount++
        if (attemptCount === 1) {
          throw new Error("First init fails")
        }
      })
    )

    const { handler } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: FlakyLayer
    })

    // First request fails
    await expect(
      handler(new Request("http://localhost"), {}, mockCtx)
    ).rejects.toThrow()

    // Second request succeeds (new runtime)
    const response = await handler(
      new Request("http://localhost"),
      {},
      mockCtx
    )

    expect(response.status).toBe(200)
  })

  it("should isolate errors between requests", async () => {
    let requestCount = 0

    const { handler } = makeFetchHandler({
      effect: Effect.sync(() => {
        requestCount++
        if (requestCount === 1) {
          throw new Error("Request 1 fails")
        }
        return new Response("ok")
      }),
      layer: Layer.empty
    })

    // Request 1 fails
    await expect(
      handler(new Request("http://localhost"), {}, mockCtx)
    ).rejects.toThrow()

    // Request 2 succeeds
    const response = await handler(
      new Request("http://localhost"),
      {},
      mockCtx
    )

    expect(response.status).toBe(200)
  })
})
```

---

## Phase 10: Performance & Benchmarking

### Test Coverage

#### 10.1 Handler Initialization Performance
```typescript
describe("Performance - Initialization", () => {
  it("should initialize handler within reasonable time", async () => {
    const start = performance.now()

    const { handler } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    const initTime = performance.now() - start
    expect(initTime).toBeLessThan(100) // Should be near-instant
  })

  it("should cache handler after first request", async () => {
    const { handler } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    // First request
    const start1 = performance.now()
    await handler(new Request("http://localhost"), {}, mockCtx)
    const time1 = performance.now() - start1

    // Second request (cached)
    const start2 = performance.now()
    await handler(new Request("http://localhost"), {}, mockCtx)
    const time2 = performance.now() - start2

    expect(time2).toBeLessThan(time1) // Cached should be faster
  })
})
```

#### 10.2 Throughput
```typescript
describe("Performance - Throughput", () => {
  it("should handle high request volume", async () => {
    const { handler } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    const requestCount = 1000
    const promises = Array.from({ length: requestCount }, () =>
      handler(new Request("http://localhost"), {}, mockCtx)
    )

    const start = performance.now()
    await Promise.all(promises)
    const duration = performance.now() - start

    const rps = requestCount / (duration / 1000)
    expect(rps).toBeGreaterThan(100) // Should handle >100 rps
  })
})
```

#### 10.3 Memory Usage
```typescript
describe("Performance - Memory", () => {
  it("should not leak memory on repeated invocations", async () => {
    const { handler, dispose } = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    // Warmup
    for (let i = 0; i < 100; i++) {
      await handler(new Request("http://localhost"), {}, mockCtx)
    }

    // Measure baseline
    if (global.gc) global.gc()
    const baseline = process.memoryUsage().heapUsed

    // Execute many requests
    for (let i = 0; i < 10000; i++) {
      await handler(new Request("http://localhost"), {}, mockCtx)
    }

    // Check memory
    if (global.gc) global.gc()
    const final = process.memoryUsage().heapUsed

    const growth = final - baseline
    const growthMB = growth / 1024 / 1024

    expect(growthMB).toBeLessThan(50) // Should not grow >50MB

    await dispose()
  })
})
```

---

## Type Safety Verification

### Test Coverage

#### Type Inference Tests
```typescript
describe("Type safety", () => {
  it("should infer correct return types", () => {
    const result1 = makeFetchHandler({
      effect: Effect.succeed(new Response("ok")),
      layer: Layer.empty
    })

    // TypeScript should infer handler signature
    type Handler1 = typeof result1.handler
    type Dispose1 = typeof result1.dispose

    expectTypeOf<Handler1>().toMatchTypeOf<
      (request: Request, env: any, ctx: ExecutionContext) => Promise<Response>
    >()

    expectTypeOf<Dispose1>().toMatchTypeOf<() => Promise<void>>()
  })

  it("should prevent type errors in Effect pattern", () => {
    makeFetchHandler({
      effect: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        const ctx = yield* CloudflareContext.ExecutionContext

        // TypeScript should enforce correct types
        expectTypeOf(env).toMatchTypeOf<Record<string, unknown>>()
        expectTypeOf(ctx.waitUntil).toMatchTypeOf<Function>()

        return new Response("ok")
      }),
      layer: Layer.empty
    })
  })

  it("should prevent type errors in Function pattern", () => {
    makeFetchHandler({
      handler: (request, env, ctx) => {
        // TypeScript should infer parameter types
        expectTypeOf(request).toMatchTypeOf<Request>()
        expectTypeOf(env).toMatchTypeOf<Record<string, unknown>>()
        expectTypeOf(ctx.waitUntil).toMatchTypeOf<Function>()

        return Effect.succeed(new Response("ok"))
      },
      layer: Layer.empty
    })
  })
})
```

---

## Summary

### Test Metrics
- **Total test files:** 8
- **Estimated test cases:** 150+
- **Coverage targets:**
  - Line coverage: >90%
  - Branch coverage: >85%
  - Function coverage: >95%

### Test Execution
```bash
# Unit tests (fast, mocked)
pnpm test

# Integration tests (slow, real runtime)
pnpm test:integration

# Coverage report
pnpm coverage

# Manual testing
cd test/fixtures/entrypoints/[worker-name]
wrangler dev
```

### CI/CD Integration
```yaml
# .github/workflows/test.yml
- name: Run unit tests
  run: pnpm test

- name: Run integration tests
  run: pnpm test:integration

- name: Check coverage
  run: pnpm coverage --threshold-line=90
```

---

## Follow-On: Vitest Pool Workers Setup

After completing initial test implementation, add full integration testing support:

### 1. Install Dependencies
```bash
pnpm add -D @cloudflare/vitest-pool-workers
```

### 2. Update package.json
```json
{
  "scripts": {
    "test": "vitest",
    "test:integration": "vitest --config vitest.integration.config.ts",
    "test:watch": "vitest --watch",
    "test:integration:watch": "vitest --config vitest.integration.config.ts --watch"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
```

### 3. Create Integration Config
**File:** `vitest.integration.config.ts`
```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"
import { mergeConfig } from "vitest/config"
import shared from "../../vitest.shared.js"

const config = defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.toml"
        },
        miniflare: {
          compatibilityDate: "2025-11-14",
          compatibilityFlags: ["nodejs_compat"]
        }
      }
    }
  }
})

export default mergeConfig(shared, config)
```

### 4. Update wrangler.toml for Testing
```toml
# Add test-specific bindings
[[kv_namespaces]]
binding = "TEST_KV"
id = "test-kv-id"

[[queues.producers]]
queue = "test-queue"
binding = "TEST_QUEUE"

[[queues.consumers]]
queue = "test-queue"
max_batch_size = 10
max_batch_timeout = 30

[[r2_buckets]]
binding = "TEST_BUCKET"
bucket_name = "test-bucket"

[[d1_databases]]
binding = "TEST_DB"
database_name = "test-db"
database_id = "test-db-id"
```

### 5. Add Integration Test Examples
See Phase 7 for complete integration test implementation using `cloudflare:test` module.

### 6. Documentation
Add testing guide to package README:
```markdown
## Testing

### Unit Tests
Fast tests with mocked runtime:
\`\`\`bash
pnpm test
\`\`\`

### Integration Tests
Tests using real Workers runtime:
\`\`\`bash
pnpm test:integration
\`\`\`

### Manual Testing
\`\`\`bash
cd test/fixtures/entrypoints/[worker-name]
wrangler dev
\`\`\`
```

---

## Unresolved Questions

None - all clarified.
