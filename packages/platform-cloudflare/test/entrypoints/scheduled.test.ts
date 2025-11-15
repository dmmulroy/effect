import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import { makeScheduledHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { createMockExecutionContext, createMockScheduledController } from "../utils/mocks.js"

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
    const mockCtx = createMockExecutionContext()
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
    const mockCtx = createMockExecutionContext()

    await handler(controller, {}, mockCtx)

    expect(receivedCron).toBe("0 12 * * *")
    expect(receivedTime).toBe(1234567890)
    await dispose()
  })

  it("should provide Env to handler", async () => {
    let receivedEnv: Record<string, unknown> | undefined

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        receivedEnv = env as Record<string, unknown>
      }),
      layer: Layer.empty
    })

    const env = { CRON_KEY: "secret" }
    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await handler(controller, env, mockCtx)

    expect(receivedEnv).toEqual(env)
    await dispose()
  })

  it("should provide ExecutionContext to handler", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = []

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const ctx = yield* CloudflareContext.ExecutionContext
        yield* ctx.waitUntil(Effect.log("Background task"))
      }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => {
        waitUntilPromises.push(promise)
      },
      passThroughOnException: () => {},
      props: {}
    }

    await handler(controller, {}, mockCtx)

    expect(waitUntilPromises.length).toBe(1)
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

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await handler(controller, {}, mockCtx)

    expect(serviceUsed).toBe(true)
    await dispose()
  })

  it("should cache runtime after first invocation", async () => {
    let initCount = 0

    const InitLayer = Layer.effectDiscard(
      Effect.sync(() => { initCount++ })
    )

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.void,
      layer: InitLayer
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    expect(initCount).toBe(0) // Not initialized yet

    await handler(controller, {}, mockCtx)
    expect(initCount).toBe(1) // Initialized on first invocation

    await handler(controller, {}, mockCtx)
    expect(initCount).toBe(1) // Reused, not re-initialized

    await dispose()
  })

  it("should isolate env between invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await handler(controller, { VAR: "value1" }, mockCtx)
    await handler(controller, { VAR: "value2" }, mockCtx)

    expect(envsSeen[0]).toEqual({ VAR: "value1" })
    expect(envsSeen[1]).toEqual({ VAR: "value2" })
    await dispose()
  })
})

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
    const mockCtx = createMockExecutionContext()

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
    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await handler(controller, testEnv, mockCtx)

    expect(receivedEnv).toEqual(testEnv)
    await dispose()
  })

  it("should pass ExecutionContext to function", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = []

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.gen(function*() {
          yield* ctx.waitUntil(Effect.log("Background task"))
        }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => {
        waitUntilPromises.push(promise)
      },
      passThroughOnException: () => {},
      props: {}
    }

    await handler(controller, {}, mockCtx)

    expect(waitUntilPromises.length).toBe(1)
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

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await handler(controller, {}, mockCtx)

    expect(tracked).toBe(true)
    await dispose()
  })

  it("should allow accessing both context services and function args", async () => {
    let controllerFromArg: globalThis.ScheduledController | undefined
    let controllerFromService: globalThis.ScheduledController | undefined

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.gen(function*() {
          controllerFromArg = controller
          controllerFromService = yield* CloudflareContext.ScheduledController
        }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController({ cron: "0 0 * * *" })
    const mockCtx = createMockExecutionContext()

    await handler(controller, {}, mockCtx)

    expect(controllerFromArg).toBeDefined()
    expect(controllerFromService).toBeDefined()
    expect(controllerFromArg?.cron).toBe("0 0 * * *")
    expect(controllerFromService?.cron).toBe("0 0 * * *")
    await dispose()
  })

  it("should handle different cron patterns", async () => {
    const cronPatternsSeen: Array<string> = []

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.sync(() => {
          cronPatternsSeen.push(controller.cron)
        }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    await handler(createMockScheduledController({ cron: "0 0 * * *" }), {}, mockCtx)
    await handler(createMockScheduledController({ cron: "*/5 * * * *" }), {}, mockCtx)
    await handler(createMockScheduledController({ cron: "0 12 1 * *" }), {}, mockCtx)

    expect(cronPatternsSeen).toEqual(["0 0 * * *", "*/5 * * * *", "0 12 1 * *"])
    await dispose()
  })

  it("should access scheduledTime correctly", async () => {
    let receivedTime: number | undefined

    const { handler, dispose } = makeScheduledHandler({
      handler: (controller, env, ctx) =>
        Effect.sync(() => {
          receivedTime = controller.scheduledTime
        }),
      layer: Layer.empty
    })

    const timestamp = 1700000000000
    const controller = createMockScheduledController({ scheduledTime: timestamp })
    const mockCtx = createMockExecutionContext()

    await handler(controller, {}, mockCtx)

    expect(receivedTime).toBe(timestamp)
    await dispose()
  })
})

describe("makeScheduledHandler - Error handling", () => {
  it("should propagate Effect failures", async () => {
    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.fail(new Error("scheduled error")),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(controller, {}, mockCtx)
    ).rejects.toThrow("scheduled error")

    await dispose()
  })

  it("should propagate Effect defects", async () => {
    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.die(new Error("defect")),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(controller, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should handle function pattern errors", async () => {
    const { handler, dispose } = makeScheduledHandler({
      handler: () => Effect.fail(new Error("function error")),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(controller, {}, mockCtx)
    ).rejects.toThrow("function error")

    await dispose()
  })

  it("should handle layer initialization errors", async () => {
    const FailingLayer = Layer.effectDiscard(
      Effect.fail(new Error("layer init failed"))
    )

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.void,
      layer: FailingLayer
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(controller, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should isolate errors between invocations", async () => {
    let invocationCount = 0

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.sync(() => {
        invocationCount++
        if (invocationCount === 1) {
          throw new Error("First invocation fails")
        }
      }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    // First invocation fails
    await expect(
      handler(controller, {}, mockCtx)
    ).rejects.toThrow("First invocation fails")

    // Second invocation succeeds
    await handler(controller, {}, mockCtx)

    expect(invocationCount).toBe(2)
    await dispose()
  })
})

describe("makeScheduledHandler - Resource cleanup", () => {
  it("should cleanup layer resources on dispose", async () => {
    let cleanupCalled = false

    const ResourceLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.succeed({}),
        () => Effect.sync(() => { cleanupCalled = true })
      )
    )

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.void,
      layer: ResourceLayer
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await handler(controller, {}, mockCtx)
    expect(cleanupCalled).toBe(false)

    await dispose()
    expect(cleanupCalled).toBe(true)
  })

  it("should handle multiple dispose calls", async () => {
    const { dispose } = makeScheduledHandler({
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

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.fail(new Error("error")),
      layer: ResourceLayer
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(controller, {}, mockCtx)
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

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const svc1 = yield* Service1
        const svc2 = yield* Service2
        expect(svc1.value).toBe("service1")
        expect(svc2.value).toBe("service2")
      }),
      layer: Layer.mergeAll(Service1.Default, Service2.Default)
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    await handler(controller, {}, mockCtx)

    expect(service1Cleaned).toBe(false)
    expect(service2Cleaned).toBe(false)

    await dispose()

    expect(service1Cleaned).toBe(true)
    expect(service2Cleaned).toBe(true)
  })
})

describe("makeScheduledHandler - Concurrent invocations", () => {
  it("should handle concurrent scheduled invocations", async () => {
    let executionCount = 0

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.sync(() => {
        executionCount++
      }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    // Execute multiple concurrent invocations
    const promises = Array.from({ length: 5 }, () =>
      handler(controller, {}, mockCtx)
    )

    await Promise.all(promises)

    expect(executionCount).toBe(5)
    await dispose()
  })

  it("should isolate context between concurrent invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeScheduledHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const controller = createMockScheduledController()
    const mockCtx = createMockExecutionContext()

    // Execute concurrent invocations with different envs
    const promises = [
      handler(controller, { ID: 1 }, mockCtx),
      handler(controller, { ID: 2 }, mockCtx),
      handler(controller, { ID: 3 }, mockCtx)
    ]

    await Promise.all(promises)

    expect(envsSeen).toHaveLength(3)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 1)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 2)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 3)).toBe(true)
    await dispose()
  })
})
