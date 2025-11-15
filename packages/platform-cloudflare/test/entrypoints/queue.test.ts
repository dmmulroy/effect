import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import { makeQueueHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { createMockExecutionContext, createMockMessageBatch } from "../utils/mocks.js"

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
    const mockCtx = createMockExecutionContext()
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
    const mockCtx = createMockExecutionContext()

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
    const mockCtx = createMockExecutionContext()

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
    const mockCtx = createMockExecutionContext()
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
    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await handler(batch, env, mockCtx)

    expect(receivedEnv).toEqual(env)
    expect(ctxAvailable).toBe(true)
    await dispose()
  })

  it("should support layer dependencies", async () => {
    class QueueService extends Effect.Service<QueueService>()("QueueService", {
      effect: Effect.succeed({ process: () => Effect.log("processing") })
    }) {}

    let serviceUsed = false

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const svc = yield* QueueService
        yield* svc.process()
        serviceUsed = true
      }),
      layer: Layer.succeed(QueueService, new QueueService({
        process: () => Effect.log("processing")
      }))
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(serviceUsed).toBe(true)
    await dispose()
  })

  it("should cache runtime after first invocation", async () => {
    let initCount = 0

    const InitLayer = Layer.effectDiscard(
      Effect.sync(() => { initCount++ })
    )

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.void,
      layer: InitLayer
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    expect(initCount).toBe(0) // Not initialized yet

    await handler(batch, {}, mockCtx)
    expect(initCount).toBe(1) // Initialized on first invocation

    await handler(batch, {}, mockCtx)
    expect(initCount).toBe(1) // Reused, not re-initialized

    await dispose()
  })

  it("should isolate env between invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await handler(batch, { VAR: "value1" }, mockCtx)
    await handler(batch, { VAR: "value2" }, mockCtx)

    expect(envsSeen[0]).toEqual({ VAR: "value1" })
    expect(envsSeen[1]).toEqual({ VAR: "value2" })
    await dispose()
  })

  it("should support individual message acknowledgment", async () => {
    const ackedIds: Array<string> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        for (const msg of batch.messages) {
          ackedIds.push(msg.id)
          yield* Effect.sync(() => msg.ack())
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { id: "msg-1", body: {} },
      { id: "msg-2", body: {} }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(ackedIds).toEqual(["msg-1", "msg-2"])
    await dispose()
  })

  it("should support message retry", async () => {
    const retriedIds: Array<string> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        for (const msg of batch.messages) {
          if ((msg.body as { shouldRetry?: boolean }).shouldRetry) {
            retriedIds.push(msg.id)
            yield* Effect.sync(() => msg.retry())
          } else {
            yield* Effect.sync(() => msg.ack())
          }
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { id: "msg-1", body: { shouldRetry: true } },
      { id: "msg-2", body: { shouldRetry: false } },
      { id: "msg-3", body: { shouldRetry: true } }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(retriedIds).toEqual(["msg-1", "msg-3"])
    await dispose()
  })
})

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
          receivedMessages = batch.messages.map((m) => m.body)
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("orders", [
      { body: { orderId: "A" } },
      { body: { orderId: "B" } }
    ])
    const mockCtx = createMockExecutionContext()

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
            yield* Effect.sync(() => msg.ack())
          }
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { body: {} },
      { body: {} }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)
    await dispose()
  })

  it("should support message retry", async () => {
    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          for (const msg of batch.messages) {
            // Retry failed messages
            if ((msg.body as { shouldRetry?: boolean }).shouldRetry) {
              yield* Effect.sync(() => msg.retry())
            } else {
              yield* Effect.sync(() => msg.ack())
            }
          }
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { body: { shouldRetry: true } },
      { body: { shouldRetry: false } }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)
    await dispose()
  })

  it("should pass env and ctx to function", async () => {
    let receivedEnv: Record<string, unknown> | undefined
    const waitUntilPromises: Array<Promise<unknown>> = []

    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          receivedEnv = env
          yield* ctx.waitUntil(Effect.log("Background task"))
        }),
      layer: Layer.empty
    })

    const env = { API_KEY: "secret" }
    const batch = createMockMessageBatch("queue", [])
    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => {
        waitUntilPromises.push(promise)
      },
      passThroughOnException: () => {},
      props: {}
    }

    await handler(batch, env, mockCtx)

    expect(receivedEnv).toEqual(env)
    expect(waitUntilPromises.length).toBe(1)
    await dispose()
  })

  it("should support layer dependencies in function pattern", async () => {
    class Analytics extends Effect.Service<Analytics>()("Analytics", {
      effect: Effect.succeed({ track: () => Effect.log("tracked") })
    }) {}

    let tracked = false

    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          const analytics = yield* Analytics
          yield* analytics.track()
          tracked = true
        }),
      layer: Layer.succeed(Analytics, new Analytics({
        track: () => Effect.log("tracked")
      }))
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(tracked).toBe(true)
    await dispose()
  })

  it("should allow accessing both context services and function args", async () => {
    let batchFromArg: globalThis.MessageBatch<unknown> | undefined
    let batchFromService: globalThis.MessageBatch<unknown> | undefined

    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          batchFromArg = batch
          batchFromService = yield* CloudflareContext.MessageBatch
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("test-queue", [{ body: { data: "test" } }])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(batchFromArg).toBeDefined()
    expect(batchFromService).toBeDefined()
    expect(batchFromArg?.queue).toBe("test-queue")
    expect(batchFromService?.queue).toBe("test-queue")
    await dispose()
  })

  it("should support ackAll in function pattern", async () => {
    let ackAllCalled = false

    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          yield* batch.ackAll
          ackAllCalled = true
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [{ body: {} }])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(ackAllCalled).toBe(true)
    await dispose()
  })

  it("should support retryAll in function pattern", async () => {
    let retryAllCalled = false

    const { handler, dispose } = makeQueueHandler({
      handler: (batch, env, ctx) =>
        Effect.gen(function*() {
          yield* batch.retryAll()
          retryAllCalled = true
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [{ body: {} }])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(retryAllCalled).toBe(true)
    await dispose()
  })
})

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
    const mockCtx = createMockExecutionContext()

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
          batch.messages.forEach((msg) => orderIds.push(msg.body.orderId))
        }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch<OrderMessage>("orders", [
      { body: { orderId: "A", amount: 50 } }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(orderIds).toEqual(["A"])
    await dispose()
  })

  it("should process complex typed messages", async () => {
    interface TaskMessage {
      taskId: string
      priority: "high" | "medium" | "low"
      payload: { action: string; params: Record<string, unknown> }
    }

    const processedTasks: Array<string> = []

    const { handler, dispose } = makeQueueHandler<never, never, TaskMessage>({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        for (const msg of batch.messages) {
          if (msg.body.priority === "high") {
            processedTasks.push(msg.body.taskId)
            yield* Effect.sync(() => msg.ack())
          } else {
            yield* Effect.sync(() => msg.retry())
          }
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch<TaskMessage>("tasks", [
      {
        body: {
          taskId: "task-1",
          priority: "high",
          payload: { action: "send", params: { to: "user@example.com" } }
        }
      },
      {
        body: {
          taskId: "task-2",
          priority: "low",
          payload: { action: "cleanup", params: {} }
        }
      },
      {
        body: {
          taskId: "task-3",
          priority: "high",
          payload: { action: "notify", params: { userId: "123" } }
        }
      }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(processedTasks).toEqual(["task-1", "task-3"])
    await dispose()
  })
})

describe("makeQueueHandler - Error handling", () => {
  it("should propagate Effect failures", async () => {
    const { handler, dispose } = makeQueueHandler({
      handler: Effect.fail(new Error("queue error")),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(batch, {}, mockCtx)
    ).rejects.toThrow("queue error")

    await dispose()
  })

  it("should propagate Effect defects", async () => {
    const { handler, dispose } = makeQueueHandler({
      handler: Effect.die(new Error("defect")),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(batch, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should handle function pattern errors", async () => {
    const { handler, dispose } = makeQueueHandler({
      handler: () => Effect.fail(new Error("function error")),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(batch, {}, mockCtx)
    ).rejects.toThrow("function error")

    await dispose()
  })

  it("should handle layer initialization errors", async () => {
    const FailingLayer = Layer.effectDiscard(
      Effect.fail(new Error("layer init failed"))
    )

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.void,
      layer: FailingLayer
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(batch, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should isolate errors between invocations", async () => {
    let invocationCount = 0

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.sync(() => {
        invocationCount++
        if (invocationCount === 1) {
          throw new Error("First invocation fails")
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    // First invocation fails
    await expect(
      handler(batch, {}, mockCtx)
    ).rejects.toThrow("First invocation fails")

    // Second invocation succeeds
    await handler(batch, {}, mockCtx)

    expect(invocationCount).toBe(2)
    await dispose()
  })

  it("should handle errors during message processing", async () => {
    const processedIds: Array<string> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        for (const msg of batch.messages) {
          if (msg.id === "msg-error") {
            yield* Effect.fail(new Error("Message processing failed"))
          }
          processedIds.push(msg.id)
          yield* Effect.sync(() => msg.ack())
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { id: "msg-1", body: {} },
      { id: "msg-error", body: {} },
      { id: "msg-3", body: {} }
    ])
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(batch, {}, mockCtx)
    ).rejects.toThrow("Message processing failed")

    // Only first message was processed before error
    expect(processedIds).toEqual(["msg-1"])
    await dispose()
  })
})

describe("makeQueueHandler - Resource cleanup", () => {
  it("should cleanup layer resources on dispose", async () => {
    let cleanupCalled = false

    const ResourceLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.succeed({}),
        () => Effect.sync(() => { cleanupCalled = true })
      )
    )

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.void,
      layer: ResourceLayer
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)
    expect(cleanupCalled).toBe(false)

    await dispose()
    expect(cleanupCalled).toBe(true)
  })

  it("should handle multiple dispose calls", async () => {
    const { dispose } = makeQueueHandler({
      handler: Effect.void,
      layer: Layer.empty
    })

    await dispose()
    await dispose() // Should not throw
  })

  it("should cleanup even when handler errors", async () => {
    let cleanupCalled = false

    const ResourceLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.succeed({}),
        () => Effect.sync(() => { cleanupCalled = true })
      )
    )

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.fail(new Error("error")),
      layer: ResourceLayer
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(batch, {}, mockCtx)
    ).rejects.toThrow()

    expect(cleanupCalled).toBe(false) // Not cleaned up yet

    await dispose()
    expect(cleanupCalled).toBe(true) // Cleaned up on dispose
  })

  it("should cleanup resources with complex layer dependencies", async () => {
    let service1Cleaned = false
    let service2Cleaned = false

    class Service1 extends Effect.Service<Service1>()("Service1", {
      effect: Effect.acquireRelease(
        Effect.succeed({ value: "service1" }),
        () => Effect.sync(() => { service1Cleaned = true })
      )
    }) {}

    class Service2 extends Effect.Service<Service2>()("Service2", {
      effect: Effect.acquireRelease(
        Effect.succeed({ value: "service2" }),
        () => Effect.sync(() => { service2Cleaned = true })
      ),
      dependencies: [Service1.Default]
    }) {}

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const svc1 = yield* Service1
        const svc2 = yield* Service2
        expect(svc1.value).toBe("service1")
        expect(svc2.value).toBe("service2")
      }),
      layer: Layer.mergeAll(Service1.Default, Service2.Default)
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(service1Cleaned).toBe(false)
    expect(service2Cleaned).toBe(false)

    await dispose()

    expect(service1Cleaned).toBe(true)
    expect(service2Cleaned).toBe(true)
  })
})

describe("makeQueueHandler - Concurrent invocations", () => {
  it("should handle concurrent queue invocations", async () => {
    let executionCount = 0

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.sync(() => {
        executionCount++
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    // Execute multiple concurrent invocations
    const promises = Array.from({ length: 5 }, () =>
      handler(batch, {}, mockCtx)
    )

    await Promise.all(promises)

    expect(executionCount).toBe(5)
    await dispose()
  })

  it("should isolate context between concurrent invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    // Execute concurrent invocations with different envs
    const promises = [
      handler(batch, { ID: 1 }, mockCtx),
      handler(batch, { ID: 2 }, mockCtx),
      handler(batch, { ID: 3 }, mockCtx)
    ]

    await Promise.all(promises)

    expect(envsSeen).toHaveLength(3)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 1)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 2)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 3)).toBe(true)
    await dispose()
  })

  it("should process different batches independently", async () => {
    const processedQueues: Array<string> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        processedQueues.push(batch.queue)
      }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    const promises = [
      handler(createMockMessageBatch("queue-1", []), {}, mockCtx),
      handler(createMockMessageBatch("queue-2", []), {}, mockCtx),
      handler(createMockMessageBatch("queue-3", []), {}, mockCtx)
    ]

    await Promise.all(promises)

    expect(processedQueues).toHaveLength(3)
    expect(processedQueues).toContain("queue-1")
    expect(processedQueues).toContain("queue-2")
    expect(processedQueues).toContain("queue-3")
    await dispose()
  })
})

describe("makeQueueHandler - Message batching scenarios", () => {
  it("should handle empty batches", async () => {
    let handlerCalled = false

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        handlerCalled = true
        expect(batch.messages).toHaveLength(0)
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(handlerCalled).toBe(true)
    await dispose()
  })

  it("should handle large batches", async () => {
    let messageCount = 0

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        messageCount = batch.messages.length
        yield* batch.ackAll
      }),
      layer: Layer.empty
    })

    const messages = Array.from({ length: 100 }, (_, i) => ({
      body: { id: i }
    }))
    const batch = createMockMessageBatch("queue", messages)
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(messageCount).toBe(100)
    await dispose()
  })

  it("should handle batches with mixed message processing outcomes", async () => {
    const ackedIds: Array<string> = []
    const retriedIds: Array<string> = []

    const { handler, dispose } = makeQueueHandler({
      handler: Effect.gen(function*() {
        const batch = yield* CloudflareContext.MessageBatch
        for (const msg of batch.messages) {
          const body = msg.body as { status: "success" | "retry" }
          if (body.status === "success") {
            ackedIds.push(msg.id)
            yield* Effect.sync(() => msg.ack())
          } else {
            retriedIds.push(msg.id)
            yield* Effect.sync(() => msg.retry())
          }
        }
      }),
      layer: Layer.empty
    })

    const batch = createMockMessageBatch("queue", [
      { id: "msg-1", body: { status: "success" as const } },
      { id: "msg-2", body: { status: "retry" as const } },
      { id: "msg-3", body: { status: "success" as const } },
      { id: "msg-4", body: { status: "retry" as const } },
      { id: "msg-5", body: { status: "success" as const } }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(batch, {}, mockCtx)

    expect(ackedIds).toEqual(["msg-1", "msg-3", "msg-5"])
    expect(retriedIds).toEqual(["msg-2", "msg-4"])
    await dispose()
  })
})
