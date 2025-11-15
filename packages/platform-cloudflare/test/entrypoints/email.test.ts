import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import { makeEmailHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { createMockEmailMessage, createMockExecutionContext } from "../utils/mocks.js"

describe("makeEmailHandler - Effect pattern", () => {
  it("should create email handler from Effect", () => {
    const { handler, dispose } = makeEmailHandler({
      handler: Effect.log("email received"),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should execute effect on email invocation", async () => {
    let executed = false

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.sync(() => { executed = true }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()
    await handler(email, {}, mockCtx)

    expect(executed).toBe(true)
    await dispose()
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
    const mockCtx = createMockExecutionContext()

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

    const mockCtx = createMockExecutionContext()
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

    const mockCtx = createMockExecutionContext()
    await handler(mockEmail, {}, mockCtx)

    expect(subjectHeader).toBe("Test Email")
    await dispose()
  })

  it("should access multiple headers", async () => {
    const headers: Record<string, string> = {}

    const mockEmail = createMockEmailMessage()
    mockEmail.headers.set("Subject", "Important Message")
    mockEmail.headers.set("Content-Type", "text/html")
    mockEmail.headers.set("X-Custom-Header", "custom-value")

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        headers.subject = message.headers.get("Subject") ?? ""
        headers.contentType = message.headers.get("Content-Type") ?? ""
        headers.custom = message.headers.get("X-Custom-Header") ?? ""
      }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()
    await handler(mockEmail, {}, mockCtx)

    expect(headers.subject).toBe("Important Message")
    expect(headers.contentType).toBe("text/html")
    expect(headers.custom).toBe("custom-value")
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
    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, env, mockCtx)

    expect(envReceived).toEqual(env)
    expect(ctxAvailable).toBe(true)
    await dispose()
  })

  it("should support layer dependencies", async () => {
    class EmailService extends Effect.Service<EmailService>()("EmailService", {
      effect: Effect.succeed({ validateSpam: () => Effect.succeed(false) })
    }) {}

    let serviceUsed = false

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const svc = yield* EmailService
        const isSpam = yield* svc.validateSpam()
        serviceUsed = true
        expect(isSpam).toBe(false)
      }),
      layer: Layer.succeed(EmailService, new EmailService({
        validateSpam: () => Effect.succeed(false)
      }))
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, {}, mockCtx)

    expect(serviceUsed).toBe(true)
    await dispose()
  })

  it("should cache runtime after first invocation", async () => {
    let initCount = 0

    const InitLayer = Layer.effectDiscard(
      Effect.sync(() => { initCount++ })
    )

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.void,
      layer: InitLayer
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    expect(initCount).toBe(0) // Not initialized yet

    await handler(email, {}, mockCtx)
    expect(initCount).toBe(1) // Initialized on first invocation

    await handler(email, {}, mockCtx)
    expect(initCount).toBe(1) // Reused, not re-initialized

    await dispose()
  })

  it("should isolate env between invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, { VAR: "value1" }, mockCtx)
    await handler(email, { VAR: "value2" }, mockCtx)

    expect(envsSeen[0]).toEqual({ VAR: "value1" })
    expect(envsSeen[1]).toEqual({ VAR: "value2" })
    await dispose()
  })

  it("should access email metadata", async () => {
    let rawSize: number | undefined
    let from: string | undefined
    let to: string | undefined

    const mockEmail = createMockEmailMessage({
      from: "sender@test.com",
      to: "receiver@test.com"
    })

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        rawSize = message.rawSize
        from = message.from
        to = message.to
      }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()
    await handler(mockEmail, {}, mockCtx)

    expect(rawSize).toBe(1024)
    expect(from).toBe("sender@test.com")
    expect(to).toBe("receiver@test.com")
    await dispose()
  })
})

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
    const mockCtx = createMockExecutionContext()

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

    const mockCtx = createMockExecutionContext()
    await handler(mockEmail, {}, mockCtx)

    expect(forwarded).toBe(true)
    await dispose()
  })

  it("should support rejection in function pattern", async () => {
    let rejected = false
    let rejectReason: string | undefined

    const baseEmail = createMockEmailMessage()
    const mockEmail: globalThis.ForwardableEmailMessage = {
      ...baseEmail,
      setReject: (reason: string) => {
        rejected = true
        rejectReason = reason
      }
    }

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          yield* message.setReject("spam detected")
        }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()
    await handler(mockEmail, {}, mockCtx)

    expect(rejected).toBe(true)
    expect(rejectReason).toBe("spam detected")
    await dispose()
  })

  it("should pass env to function", async () => {
    let receivedEnv: Record<string, unknown> | undefined

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.sync(() => {
          receivedEnv = env
        }),
      layer: Layer.empty
    })

    const testEnv = { KEY: "value" }
    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, testEnv, mockCtx)

    expect(receivedEnv).toEqual(testEnv)
    await dispose()
  })

  it("should pass ExecutionContext to function", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = []

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          yield* ctx.waitUntil(Effect.log("Background task"))
        }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => {
        waitUntilPromises.push(promise)
      },
      passThroughOnException: () => {},
      props: {}
    }

    await handler(email, {}, mockCtx)

    expect(waitUntilPromises.length).toBe(1)
    await dispose()
  })

  it("should support layer dependencies in function pattern", async () => {
    class SpamFilter extends Effect.Service<SpamFilter>()("SpamFilter", {
      effect: Effect.succeed({ check: () => Effect.succeed(false) })
    }) {}

    let checked = false

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          const filter = yield* SpamFilter
          const isSpam = yield* filter.check()
          checked = true
          expect(isSpam).toBe(false)
        }),
      layer: Layer.succeed(SpamFilter, new SpamFilter({
        check: () => Effect.succeed(false)
      }))
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, {}, mockCtx)

    expect(checked).toBe(true)
    await dispose()
  })

  it("should allow accessing both context services and function args", async () => {
    let messageFromArg: globalThis.ForwardableEmailMessage | undefined
    let messageFromService: globalThis.ForwardableEmailMessage | undefined

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          messageFromArg = message
          messageFromService = yield* CloudflareContext.ForwardableEmailMessage
        }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage({ from: "test@example.com" })
    const mockCtx = createMockExecutionContext()

    await handler(email, {}, mockCtx)

    expect(messageFromArg).toBeDefined()
    expect(messageFromService).toBeDefined()
    expect(messageFromArg?.from).toBe("test@example.com")
    expect(messageFromService?.from).toBe("test@example.com")
    await dispose()
  })

  it("should support complex email processing logic", async () => {
    const processed: {
      from?: string
      to?: string
      subject?: string
      forwarded?: boolean
      rejected?: boolean
    } = {}

    const mockEmail = {
      ...createMockEmailMessage({ from: "user@example.com", to: "support@example.com" }),
      forward: async (email: string) => {
        processed.forwarded = true
      },
      setReject: (reason: string) => {
        processed.rejected = true
      }
    }
    mockEmail.headers.set("Subject", "Help Request")

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          processed.from = message.from
          processed.to = message.to
          processed.subject = message.headers.get("Subject") ?? undefined

          // Forward to admin if subject contains "Help"
          const subject = message.headers.get("Subject") ?? ""
          if (subject.includes("Help")) {
            yield* message.forward("admin@example.com")
          }
        }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()
    await handler(mockEmail, {}, mockCtx)

    expect(processed.from).toBe("user@example.com")
    expect(processed.to).toBe("support@example.com")
    expect(processed.subject).toBe("Help Request")
    expect(processed.forwarded).toBe(true)
    await dispose()
  })

  it("should handle multiple header operations", async () => {
    const headerData: Record<string, string | null> = {}

    const mockEmail = createMockEmailMessage()
    mockEmail.headers.set("From", "sender@test.com")
    mockEmail.headers.set("To", "receiver@test.com")
    mockEmail.headers.set("Subject", "Test")
    mockEmail.headers.set("Date", "2025-01-01")

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.sync(() => {
          headerData.from = message.headers.get("From")
          headerData.to = message.headers.get("To")
          headerData.subject = message.headers.get("Subject")
          headerData.date = message.headers.get("Date")
        }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()
    await handler(mockEmail, {}, mockCtx)

    expect(headerData.from).toBe("sender@test.com")
    expect(headerData.to).toBe("receiver@test.com")
    expect(headerData.subject).toBe("Test")
    expect(headerData.date).toBe("2025-01-01")
    await dispose()
  })
})

describe("makeEmailHandler - Error handling", () => {
  it("should propagate Effect failures", async () => {
    const { handler, dispose } = makeEmailHandler({
      handler: Effect.fail(new Error("email error")),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(email, {}, mockCtx)
    ).rejects.toThrow("email error")

    await dispose()
  })

  it("should propagate Effect defects", async () => {
    const { handler, dispose } = makeEmailHandler({
      handler: Effect.die(new Error("defect")),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(email, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should handle function pattern errors", async () => {
    const { handler, dispose } = makeEmailHandler({
      handler: () => Effect.fail(new Error("function error")),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(email, {}, mockCtx)
    ).rejects.toThrow("function error")

    await dispose()
  })

  it("should handle layer initialization errors", async () => {
    const FailingLayer = Layer.effectDiscard(
      Effect.fail(new Error("layer init failed"))
    )

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.void,
      layer: FailingLayer
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(email, {}, mockCtx)
    ).rejects.toThrow()

    await dispose()
  })

  it("should isolate errors between invocations", async () => {
    let invocationCount = 0

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.sync(() => {
        invocationCount++
        if (invocationCount === 1) {
          throw new Error("First invocation fails")
        }
      }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    // First invocation fails
    await expect(
      handler(email, {}, mockCtx)
    ).rejects.toThrow("First invocation fails")

    // Second invocation succeeds
    await handler(email, {}, mockCtx)

    expect(invocationCount).toBe(2)
    await dispose()
  })

  it("should handle errors during email forwarding", async () => {
    const mockEmail = {
      ...createMockEmailMessage(),
      forward: async (email: string) => {
        throw new Error("Forward failed")
      }
    }

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        yield* message.forward("admin@example.com")
      }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    await expect(
      handler(mockEmail, {}, mockCtx)
    ).rejects.toThrow("Forward failed")

    await dispose()
  })
})

describe("makeEmailHandler - Resource cleanup", () => {
  it("should cleanup layer resources on dispose", async () => {
    let cleanupCalled = false

    const ResourceLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.succeed({}),
        () => Effect.sync(() => { cleanupCalled = true })
      )
    )

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.void,
      layer: ResourceLayer
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, {}, mockCtx)
    expect(cleanupCalled).toBe(false)

    await dispose()
    expect(cleanupCalled).toBe(true)
  })

  it("should handle multiple dispose calls", async () => {
    const { dispose } = makeEmailHandler({
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

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.fail(new Error("error")),
      layer: ResourceLayer
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await expect(
      handler(email, {}, mockCtx)
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

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const svc1 = yield* Service1
        const svc2 = yield* Service2
        expect(svc1.value).toBe("service1")
        expect(svc2.value).toBe("service2")
      }),
      layer: Layer.mergeAll(Service1.Default, Service2.Default)
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, {}, mockCtx)

    expect(service1Cleaned).toBe(false)
    expect(service2Cleaned).toBe(false)

    await dispose()

    expect(service1Cleaned).toBe(true)
    expect(service2Cleaned).toBe(true)
  })
})

describe("makeEmailHandler - Concurrent invocations", () => {
  it("should handle concurrent email invocations", async () => {
    let executionCount = 0

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.sync(() => {
        executionCount++
      }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    // Execute multiple concurrent invocations
    const promises = Array.from({ length: 5 }, () =>
      handler(email, {}, mockCtx)
    )

    await Promise.all(promises)

    expect(executionCount).toBe(5)
    await dispose()
  })

  it("should isolate context between concurrent invocations", async () => {
    const envsSeen: Array<Record<string, unknown>> = []

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        envsSeen.push(env as Record<string, unknown>)
      }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    // Execute concurrent invocations with different envs
    const promises = [
      handler(email, { ID: 1 }, mockCtx),
      handler(email, { ID: 2 }, mockCtx),
      handler(email, { ID: 3 }, mockCtx)
    ]

    await Promise.all(promises)

    expect(envsSeen).toHaveLength(3)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 1)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 2)).toBe(true)
    expect(envsSeen.some((e) => (e as Record<string, unknown>).ID === 3)).toBe(true)
    await dispose()
  })

  it("should process different emails independently", async () => {
    const processedSenders: Array<string> = []

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        processedSenders.push(message.from)
      }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    const promises = [
      handler(createMockEmailMessage({ from: "user1@example.com" }), {}, mockCtx),
      handler(createMockEmailMessage({ from: "user2@example.com" }), {}, mockCtx),
      handler(createMockEmailMessage({ from: "user3@example.com" }), {}, mockCtx)
    ]

    await Promise.all(promises)

    expect(processedSenders).toHaveLength(3)
    expect(processedSenders).toContain("user1@example.com")
    expect(processedSenders).toContain("user2@example.com")
    expect(processedSenders).toContain("user3@example.com")
    await dispose()
  })
})

describe("makeEmailHandler - Email processing scenarios", () => {
  it("should handle spam filtering workflow", async () => {
    const results: Array<{ from: string; action: "forward" | "reject" }> = []

    const spamDomains = ["spam.com", "malicious.net"]

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          const domain = message.from.split("@")[1]
          if (spamDomains.includes(domain)) {
            yield* message.setReject("Spam detected")
            results.push({ from: message.from, action: "reject" })
          } else {
            results.push({ from: message.from, action: "forward" })
          }
        }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    await handler(createMockEmailMessage({ from: "user@spam.com" }), {}, mockCtx)
    await handler(createMockEmailMessage({ from: "user@example.com" }), {}, mockCtx)
    await handler(createMockEmailMessage({ from: "attacker@malicious.net" }), {}, mockCtx)

    expect(results).toEqual([
      { from: "user@spam.com", action: "reject" },
      { from: "user@example.com", action: "forward" },
      { from: "attacker@malicious.net", action: "reject" }
    ])
    await dispose()
  })

  it("should handle conditional forwarding based on headers", async () => {
    const forwardedEmails: Array<string> = []

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          const priority = message.headers.get("X-Priority")
          if (priority === "high") {
            forwardedEmails.push(message.from)
            yield* message.forward("urgent@example.com")
          }
        }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    const highPriorityEmail = createMockEmailMessage({ from: "urgent@sender.com" })
    highPriorityEmail.headers.set("X-Priority", "high")

    const normalEmail = createMockEmailMessage({ from: "normal@sender.com" })
    normalEmail.headers.set("X-Priority", "low")

    await handler(highPriorityEmail, {}, mockCtx)
    await handler(normalEmail, {}, mockCtx)

    expect(forwardedEmails).toEqual(["urgent@sender.com"])
    await dispose()
  })

  it("should access email raw stream", async () => {
    let rawStreamAccessed = false

    const { handler, dispose } = makeEmailHandler({
      handler: Effect.gen(function*() {
        const message = yield* CloudflareContext.ForwardableEmailMessage
        expect(message.raw).toBeInstanceOf(ReadableStream)
        rawStreamAccessed = true
      }),
      layer: Layer.empty
    })

    const email = createMockEmailMessage()
    const mockCtx = createMockExecutionContext()

    await handler(email, {}, mockCtx)

    expect(rawStreamAccessed).toBe(true)
    await dispose()
  })

  it("should handle email routing based on recipient", async () => {
    const routingLog: Array<{ to: string; action: string }> = []

    const { handler, dispose } = makeEmailHandler({
      handler: (message, env, ctx) =>
        Effect.gen(function*() {
          if (message.to.includes("support@")) {
            routingLog.push({ to: message.to, action: "forward-to-support-team" })
            yield* message.forward("support-team@example.com")
          } else if (message.to.includes("sales@")) {
            routingLog.push({ to: message.to, action: "forward-to-sales-team" })
            yield* message.forward("sales-team@example.com")
          } else {
            routingLog.push({ to: message.to, action: "default-inbox" })
          }
        }),
      layer: Layer.empty
    })

    const mockCtx = createMockExecutionContext()

    await handler(createMockEmailMessage({ to: "support@example.com" }), {}, mockCtx)
    await handler(createMockEmailMessage({ to: "sales@example.com" }), {}, mockCtx)
    await handler(createMockEmailMessage({ to: "info@example.com" }), {}, mockCtx)

    expect(routingLog).toEqual([
      { to: "support@example.com", action: "forward-to-support-team" },
      { to: "sales@example.com", action: "forward-to-sales-team" },
      { to: "info@example.com", action: "default-inbox" }
    ])
    await dispose()
  })
})
