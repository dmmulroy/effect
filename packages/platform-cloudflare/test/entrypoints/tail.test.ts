import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import { makeTailHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { createMockExecutionContext, createMockTailEvents } from "../utils/mocks.js"

describe("makeTailHandler - Effect pattern", () => {
  it("should create tail handler from Effect", () => {
    const { handler, dispose } = makeTailHandler({
      handler: Effect.log("tail events received"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should execute effect on tail invocation", async () => {
    let executed = false

    const { handler, dispose } = makeTailHandler({
      handler: Effect.sync(() => { executed = true }),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()
    await handler(events, {}, mockCtx)

    expect(executed).toBe(true)
    await dispose()
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
    const mockCtx = createMockExecutionContext()

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
    const mockCtx = createMockExecutionContext()

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
    const mockCtx = createMockExecutionContext()

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
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(exceptionCounts).toEqual([1, 0])
    await dispose()
  })

  it("should access event timestamps", async () => {
    const timestamps: Array<number> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        for (const event of tail.events) {
          timestamps.push(event.eventTimestamp)
        }
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { eventTimestamp: 1000 },
      { eventTimestamp: 2000 },
      { eventTimestamp: 3000 }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(timestamps).toEqual([1000, 2000, 3000])
    await dispose()
  })

  it("should provide Env and ExecutionContext", async () => {
    let envReceived: Record<string, unknown> | undefined
    let ctxAvailable = false

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        envReceived = yield* CloudflareContext.Env
        const ctx = yield* CloudflareContext.ExecutionContext
        ctxAvailable = true
      }),
      layer: Layer.empty
    })

    const env = { TAIL_SECRET: "key" }
    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await handler(events, env, mockCtx)

    expect(envReceived).toEqual(env)
    expect(ctxAvailable).toBe(true)
    await dispose()
  })

  it("should support layer dependencies", async () => {
    class LogAnalyzer extends Effect.Service<LogAnalyzer>()("LogAnalyzer", {
      effect: Effect.succeed({ analyze: () => Effect.succeed("analysis complete") })
    }) {}

    let serviceUsed = false

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const analyzer = yield* LogAnalyzer
        const result = yield* analyzer.analyze()
        serviceUsed = true
        expect(result).toBe("analysis complete")
      }),
      layer: Layer.succeed(LogAnalyzer, new LogAnalyzer({
        analyze: () => Effect.succeed("analysis complete")
      }))
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(serviceUsed).toBe(true)
    await dispose()
  })

  it("should cache runtime after first invocation", async () => {
    let initCount = 0

    const InitLayer = Layer.effectDiscard(
      Effect.sync(() => { initCount++ })
    )

    const { handler, dispose } = makeTailHandler({
      handler: Effect.void,
      layer: InitLayer
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    expect(initCount).toBe(0) // Not initialized yet

    await handler(events, {}, mockCtx)
    expect(initCount).toBe(1) // Initialized on first invocation

    await handler(events, {}, mockCtx)
    expect(initCount).toBe(1) // Reused, not re-initialized

    await dispose()
  })

  it("should isolate env between invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await handler(events, { VAR: "value1" }, mockCtx)
    await handler(events, { VAR: "value2" }, mockCtx)

    expect(envsSeen[0]).toEqual({ VAR: "value1" })
    expect(envsSeen[1]).toEqual({ VAR: "value2" })
    await dispose()
  })

  it("should handle empty event arrays", async () => {
    let handlerCalled = false

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        handlerCalled = true
        expect(tail.events).toHaveLength(0)
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(handlerCalled).toBe(true)
    await dispose()
  })

  it("should process multiple events with different properties", async () => {
    const eventData: Array<{
      scriptName: string
      logCount: number
      exceptionCount: number
    }> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        for (const event of tail.events) {
          eventData.push({
            scriptName: event.scriptName,
            logCount: event.logs.length,
            exceptionCount: event.exceptions.length
          })
        }
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "worker-1", logs: ["log1", "log2"], exceptions: [] },
      { scriptName: "worker-2", logs: ["log3"], exceptions: [{ name: "Error" }] },
      { scriptName: "worker-3", logs: [], exceptions: [{ name: "Error1" }, { name: "Error2" }] }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(eventData).toEqual([
      { scriptName: "worker-1", logCount: 2, exceptionCount: 0 },
      { scriptName: "worker-2", logCount: 1, exceptionCount: 1 },
      { scriptName: "worker-3", logCount: 0, exceptionCount: 2 }
    ])
    await dispose()
  })
})

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
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(eventCount).toBe(3)
    await dispose()
  })

  it("should process events in function pattern", async () => {
    const timestamps: Array<number> = []

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach((event) => {
            timestamps.push(event.eventTimestamp)
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { eventTimestamp: 1000 },
      { eventTimestamp: 2000 }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(timestamps).toEqual([1000, 2000])
    await dispose()
  })

  it("should pass env to function", async () => {
    let receivedEnv: Record<string, unknown> | undefined

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          receivedEnv = env
        }),
      layer: Layer.empty
    })

    const testEnv = { KEY: "value" }
    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await handler(events, testEnv, mockCtx)

    expect(receivedEnv).toEqual(testEnv)
    await dispose()
  })

  it("should pass ExecutionContext to function", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = []

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.gen(function*() {
          yield* ctx.waitUntil(Effect.log("Background task"))
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => {
        waitUntilPromises.push(promise)
      },
      passThroughOnException: () => {},
      props: {}
    }

    await handler(events, {}, mockCtx)

    expect(waitUntilPromises.length).toBe(1)
    await dispose()
  })

  it("should support layer dependencies in function pattern", async () => {
    class MetricsService extends Effect.Service<MetricsService>()("MetricsService", {
      effect: Effect.succeed({ record: () => Effect.log("metric recorded") })
    }) {}

    let serviceUsed = false

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.gen(function*() {
          const metrics = yield* MetricsService
          yield* metrics.record()
          serviceUsed = true
        }),
      layer: Layer.succeed(MetricsService, new MetricsService({
        record: () => Effect.log("metric recorded")
      }))
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(serviceUsed).toBe(true)
    await dispose()
  })

  it("should allow accessing both context services and function args", async () => {
    let tailFromArg: CloudflareContext.CloudflareTailEvents | undefined
    let tailFromService: CloudflareContext.CloudflareTailEvents | undefined

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.gen(function*() {
          tailFromArg = tail
          tailFromService = yield* CloudflareContext.TailEvents
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([{ scriptName: "test-worker" }])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(tailFromArg).toBeDefined()
    expect(tailFromService).toBeDefined()
    expect(tailFromArg?.events.length).toBe(1)
    expect(tailFromService?.events.length).toBe(1)
    await dispose()
  })

  it("should support complex event processing logic", async () => {
    const errorWorkers: Array<string> = []
    const healthyWorkers: Array<string> = []

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach((event) => {
            if (event.exceptions.length > 0) {
              errorWorkers.push(event.scriptName)
            } else {
              healthyWorkers.push(event.scriptName)
            }
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "worker-1", exceptions: [] },
      { scriptName: "worker-2", exceptions: [{ name: "Error" }] },
      { scriptName: "worker-3", exceptions: [] },
      { scriptName: "worker-4", exceptions: [{ name: "TypeError" }] }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(errorWorkers).toEqual(["worker-2", "worker-4"])
    expect(healthyWorkers).toEqual(["worker-1", "worker-3"])
    await dispose()
  })

  it("should process log entries from events", async () => {
    const allLogs: Array<unknown> = []

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach((event) => {
            event.logs.forEach((log) => {
              allLogs.push(log)
            })
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { logs: ["log1", "log2"] },
      { logs: ["log3"] },
      { logs: ["log4", "log5", "log6"] }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(allLogs).toEqual(["log1", "log2", "log3", "log4", "log5", "log6"])
    await dispose()
  })
})

describe("makeTailHandler - Error handling", () => {
  it("should propagate Effect failures", async () => {
    const { handler, dispose } = makeTailHandler({
      handler: Effect.fail(new Error("tail error")),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(events, {}, mockCtx)
    ).rejects.toThrow("tail error")

    await dispose()
  })

  it("should propagate Effect defects", async () => {
    const { handler, dispose } = makeTailHandler({
      handler: Effect.die(new Error("defect")),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(events, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should handle function pattern errors", async () => {
    const { handler, dispose } = makeTailHandler({
      handler: () => Effect.fail(new Error("function error")),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(events, {}, mockCtx)
    ).rejects.toThrow("function error")

    await dispose()
  })

  it("should handle layer initialization errors", async () => {
    const FailingLayer = Layer.effectDiscard(
      Effect.fail(new Error("layer init failed"))
    )

    const { handler, dispose } = makeTailHandler({
      handler: Effect.void,
      layer: FailingLayer
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(events, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should isolate errors between invocations", async () => {
    let invocationCount = 0

    const { handler, dispose } = makeTailHandler({
      handler: Effect.sync(() => {
        invocationCount++
        if (invocationCount === 1) {
          throw new Error("First invocation fails")
        }
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    // First invocation fails
    await expect(
      handler(events, {}, mockCtx)
    ).rejects.toThrow("First invocation fails")

    // Second invocation succeeds
    await handler(events, {}, mockCtx)

    expect(invocationCount).toBe(2)
    await dispose()
  })

  it("should handle errors during event processing", async () => {
    const processedScripts: Array<string> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        for (const event of tail.events) {
          if (event.scriptName === "error-worker") {
            yield* Effect.fail(new Error("Event processing failed"))
          }
          processedScripts.push(event.scriptName)
        }
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "worker-1" },
      { scriptName: "error-worker" },
      { scriptName: "worker-3" }
    ])
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(events, {}, mockCtx)
    ).rejects.toThrow("Event processing failed")

    // Only first event was processed before error
    expect(processedScripts).toEqual(["worker-1"])
    await dispose()
  })
})

describe("makeTailHandler - Resource cleanup", () => {
  it("should cleanup layer resources on dispose", async () => {
    let cleanupCalled = false

    const ResourceLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.succeed({}),
        () => Effect.sync(() => { cleanupCalled = true })
      )
    )

    const { handler, dispose } = makeTailHandler({
      handler: Effect.void,
      layer: ResourceLayer
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)
    expect(cleanupCalled).toBe(false)

    await dispose()
    expect(cleanupCalled).toBe(true)
  })

  it("should handle multiple dispose calls", async () => {
    const { dispose } = makeTailHandler({
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

    const { handler, dispose } = makeTailHandler({
      handler: Effect.fail(new Error("error")),
      layer: ResourceLayer
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(events, {}, mockCtx)
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

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const svc1 = yield* Service1
        const svc2 = yield* Service2
        expect(svc1.value).toBe("service1")
        expect(svc2.value).toBe("service2")
      }),
      layer: Layer.mergeAll(Service1.Default, Service2.Default)
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(service1Cleaned).toBe(false)
    expect(service2Cleaned).toBe(false)

    await dispose()

    expect(service1Cleaned).toBe(true)
    expect(service2Cleaned).toBe(true)
  })
})

describe("makeTailHandler - Concurrent invocations", () => {
  it("should handle concurrent tail invocations", async () => {
    let executionCount = 0

    const { handler, dispose } = makeTailHandler({
      handler: Effect.sync(() => {
        executionCount++
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    // Execute multiple concurrent invocations
    const promises = Array.from({ length: 5 }, () =>
      handler(events, {}, mockCtx)
    )

    await Promise.all(promises)

    expect(executionCount).toBe(5)
    await dispose()
  })

  it("should isolate context between concurrent invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents()
    const mockCtx = createMockExecutionContext()

    // Execute concurrent invocations with different envs
    const promises = [
      handler(events, { ID: 1 }, mockCtx),
      handler(events, { ID: 2 }, mockCtx),
      handler(events, { ID: 3 }, mockCtx)
    ]

    await Promise.all(promises)

    expect(envsSeen).toHaveLength(3)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 1)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 2)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 3)).toBe(true)
    await dispose()
  })

  it("should process different event batches independently", async () => {
    const processedScripts: Array<string> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        tail.events.forEach((event) => {
          processedScripts.push(event.scriptName)
        })
      }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    const promises = [
      handler(createMockTailEvents([{ scriptName: "worker-1" }]), {}, mockCtx),
      handler(createMockTailEvents([{ scriptName: "worker-2" }]), {}, mockCtx),
      handler(createMockTailEvents([{ scriptName: "worker-3" }]), {}, mockCtx)
    ]

    await Promise.all(promises)

    expect(processedScripts).toHaveLength(3)
    expect(processedScripts).toContain("worker-1")
    expect(processedScripts).toContain("worker-2")
    expect(processedScripts).toContain("worker-3")
    await dispose()
  })
})

describe("makeTailHandler - Event processing scenarios", () => {
  it("should aggregate error counts across workers", async () => {
    const errorStats: Record<string, number> = {}

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach((event) => {
            errorStats[event.scriptName] = event.exceptions.length
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "api-worker", exceptions: [{ name: "Error" }] },
      { scriptName: "cron-worker", exceptions: [] },
      { scriptName: "queue-worker", exceptions: [{ name: "Error1" }, { name: "Error2" }] }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(errorStats).toEqual({
      "api-worker": 1,
      "cron-worker": 0,
      "queue-worker": 2
    })
    await dispose()
  })

  it("should filter events by timestamp range", async () => {
    const recentEvents: Array<string> = []
    const cutoffTime = 5000

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach((event) => {
            if (event.eventTimestamp >= cutoffTime) {
              recentEvents.push(event.scriptName)
            }
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "old-worker-1", eventTimestamp: 1000 },
      { scriptName: "old-worker-2", eventTimestamp: 3000 },
      { scriptName: "recent-worker-1", eventTimestamp: 5000 },
      { scriptName: "recent-worker-2", eventTimestamp: 7000 }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(recentEvents).toEqual(["recent-worker-1", "recent-worker-2"])
    await dispose()
  })

  it("should process log levels for monitoring", async () => {
    const logLevels: Record<string, Array<string>> = {}

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach((event) => {
            const levels = event.logs
              .filter((log) => typeof log === "string")
              .map((log) => {
                const logStr = log as string
                if (logStr.includes("ERROR")) return "ERROR"
                if (logStr.includes("WARN")) return "WARN"
                return "INFO"
              })
            logLevels[event.scriptName] = levels
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "worker-1", logs: ["INFO: started", "WARN: slow", "ERROR: failed"] },
      { scriptName: "worker-2", logs: ["INFO: completed"] }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(logLevels).toEqual({
      "worker-1": ["INFO", "WARN", "ERROR"],
      "worker-2": ["INFO"]
    })
    await dispose()
  })

  it("should handle large event batches", async () => {
    let eventCount = 0

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        eventCount = tail.events.length
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents(
      Array.from({ length: 100 }, (_, i) => ({
        scriptName: `worker-${i}`,
        eventTimestamp: Date.now() + i
      }))
    )
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(eventCount).toBe(100)
    await dispose()
  })

  it("should build exception analytics", async () => {
    const exceptionTypes: Map<string, number> = new Map()

    const { handler, dispose } = makeTailHandler({
      handler: (tail, env, ctx) =>
        Effect.sync(() => {
          tail.events.forEach((event) => {
            event.exceptions.forEach((exception) => {
              const count = exceptionTypes.get(exception.name) ?? 0
              exceptionTypes.set(exception.name, count + 1)
            })
          })
        }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { exceptions: [{ name: "TypeError" }, { name: "ReferenceError" }] },
      { exceptions: [{ name: "TypeError" }] },
      { exceptions: [{ name: "SyntaxError" }, { name: "TypeError" }] }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(Object.fromEntries(exceptionTypes)).toEqual({
      TypeError: 3,
      ReferenceError: 1,
      SyntaxError: 1
    })
    await dispose()
  })

  it("should correlate logs with exceptions", async () => {
    const problemWorkers: Array<{
      name: string
      hasLogs: boolean
      hasExceptions: boolean
    }> = []

    const { handler, dispose } = makeTailHandler({
      handler: Effect.gen(function*() {
        const tail = yield* CloudflareContext.TailEvents
        tail.events.forEach((event) => {
          if (event.logs.length > 0 || event.exceptions.length > 0) {
            problemWorkers.push({
              name: event.scriptName,
              hasLogs: event.logs.length > 0,
              hasExceptions: event.exceptions.length > 0
            })
          }
        })
      }),
      layer: Layer.empty
    })

    const events = createMockTailEvents([
      { scriptName: "quiet-worker", logs: [], exceptions: [] },
      { scriptName: "verbose-worker", logs: ["log1", "log2"], exceptions: [] },
      { scriptName: "failing-worker", logs: [], exceptions: [{ name: "Error" }] },
      { scriptName: "noisy-failing-worker", logs: ["error log"], exceptions: [{ name: "Error" }] }
    ])
    const mockCtx = createMockExecutionContext()

    await handler(events, {}, mockCtx)

    expect(problemWorkers).toEqual([
      { name: "verbose-worker", hasLogs: true, hasExceptions: false },
      { name: "failing-worker", hasLogs: false, hasExceptions: true },
      { name: "noisy-failing-worker", hasLogs: true, hasExceptions: true }
    ])
    await dispose()
  })
})
