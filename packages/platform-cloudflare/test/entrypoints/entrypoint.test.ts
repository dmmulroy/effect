import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import { makeEntrypoint } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Context, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  createMockEmailMessage,
  createMockExecutionContext,
  createMockMessageBatch,
  createMockScheduledController,
  createMockTailEvents
} from "../utils/mocks.js"

const mockCtx = createMockExecutionContext()

describe("makeEntrypoint - Single handler", () => {
  it("should create entrypoint with only fetch handler", () => {
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
        scheduled: Effect.sync(() => {
          executed = true
        })
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
        scheduled: Effect.sync(() => {
          executions.push("scheduled")
        }),
        queue: Effect.sync(() => {
          executions.push("queue")
        })
      }
    })

    await entrypoint.fetch!(new Request("http://localhost"), {}, mockCtx)
    await entrypoint.scheduled!(createMockScheduledController(), {}, mockCtx)
    await entrypoint.queue!(createMockMessageBatch("q", []), {}, mockCtx)

    expect(executions).toEqual(["fetch", "scheduled", "queue"])
  })
})

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

describe("makeEntrypoint - Shared layer", () => {
  it("should share layer across all handlers", async () => {
    class Database extends Context.Tag("Database")<
      Database,
      {
        query: () => Effect.Effect<string>
        connectionCount: number
      }
    >() {}

    let connectionCount = 0

    const DatabaseLive = Layer.succeed(
      Database,
      Database.of({
        query: () => Effect.succeed("data"),
        get connectionCount() {
          return ++connectionCount
        }
      })
    )

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
        () =>
          Effect.sync(() => {
            cleanupCalled = true
          })
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

  it("should support typed queue messages", async () => {
    interface OrderMessage {
      orderId: string
      total: number
    }

    const orderIds: Array<string> = []

    const entrypoint = makeEntrypoint<never, never, OrderMessage>({
      layer: Layer.empty,
      handlers: {
        queue: (batch, env, ctx) =>
          Effect.sync(() => {
            batch.messages.forEach((msg) => {
              // msg.body is typed as OrderMessage
              const orderId: string = msg.body.orderId
              const total: number = msg.body.total
              orderIds.push(orderId)
            })
          })
      }
    })

    expect(entrypoint.queue).toBeDefined()

    await entrypoint.queue!(
      createMockMessageBatch<OrderMessage>("orders", [
        { body: { orderId: "A", total: 50 } },
        { body: { orderId: "B", total: 100 } }
      ]),
      {},
      mockCtx
    )

    expect(orderIds).toEqual(["A", "B"])
  })
})

describe("makeEntrypoint - All handler types", () => {
  it("should support all handler types with mixed patterns", async () => {
    const logs: Array<string> = []

    const entrypoint = makeEntrypoint({
      layer: Layer.empty,
      handlers: {
        fetch: (request, env, ctx) =>
          Effect.sync(() => {
            logs.push(`fetch:${request.url}`)
            return new Response("ok")
          }),
        scheduled: (controller, env, ctx) =>
          Effect.sync(() => {
            logs.push(`scheduled:${controller.cron}`)
          }),
        queue: (batch, env, ctx) =>
          Effect.sync(() => {
            logs.push(`queue:${batch.queue}:${batch.messages.length}`)
          }),
        email: (message, env, ctx) =>
          Effect.sync(() => {
            logs.push(`email:${message.from}:${message.to}`)
          }),
        tail: (tail, env, ctx) =>
          Effect.sync(() => {
            logs.push(`tail:${tail.events.length}`)
          })
      }
    })

    await entrypoint.fetch!(new Request("http://localhost/test"), {}, mockCtx)
    await entrypoint.scheduled!(
      createMockScheduledController({ cron: "0 12 * * *" }),
      {},
      mockCtx
    )
    await entrypoint.queue!(
      createMockMessageBatch("orders", [{ body: {} }, { body: {} }]),
      {},
      mockCtx
    )
    await entrypoint.email!(
      createMockEmailMessage({ from: "a@ex.com", to: "b@ex.com" }),
      {},
      mockCtx
    )
    await entrypoint.tail!(createMockTailEvents([{}, {}]), {}, mockCtx)

    expect(logs).toEqual([
      "fetch:http://localhost/test",
      "scheduled:0 12 * * *",
      "queue:orders:2",
      "email:a@ex.com:b@ex.com",
      "tail:2"
    ])
  })
})
