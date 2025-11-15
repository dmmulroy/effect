import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpRouter, HttpServerResponse } from "@effect/platform"
import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareEntrypoint"
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { createMockExecutionContext } from "../utils/mocks.js"

describe("makeFetchHandler - HttpApi pattern", () => {
  // Test API definition
  class TestGroup extends HttpApiGroup.make("test")
    .add(
      HttpApiEndpoint.get("hello", "/hello").addSuccess(
        Schema.Struct({ message: Schema.String })
      )
    )
    .add(
      HttpApiEndpoint.get("env", "/env").addSuccess(
        Schema.Struct({ value: Schema.String })
      )
    )
  {}

  class TestApi extends HttpApi.make("test-api").add(TestGroup) {}

  const TestHandlers = HttpApiBuilder.group(
    TestApi,
    "test",
    (handlers) =>
      handlers
        .handle("hello", () => Effect.succeed({ message: "Hello, World!" }))
        .handle("env", () =>
          Effect.gen(function*() {
            const env = yield* CloudflareContext.Env
            const envRecord = env as Record<string, unknown>
            return { value: envRecord.TEST_VAR as string || "not found" }
          })
        )
  )

  const TestApiLive = Layer.provide(
    HttpApiBuilder.api(TestApi),
    TestHandlers
  )

  it("should create handler from HttpApi.Api", () => {
    const { handler, dispose } = makeFetchHandler({
      layer: TestApiLive
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should handle requests with HttpApi routing", async () => {
    const { handler, dispose } = makeFetchHandler({
      layer: TestApiLive
    })

    const request = new Request("http://localhost/hello")
    const env = {}
    const ctx = createMockExecutionContext()

    const response = await handler(request, env, ctx)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ message: "Hello, World!" })

    await dispose()
  })

  it("should provide Env to API handlers", async () => {
    const { handler, dispose } = makeFetchHandler({
      layer: TestApiLive
    })

    const request = new Request("http://localhost/env")
    const env = { TEST_VAR: "test-value-123" }
    const ctx = createMockExecutionContext()

    const response = await handler(request, env, ctx)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ value: "test-value-123" })

    await dispose()
  })

  it("should provide ExecutionContext to API handlers", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = []

    class CtxGroup extends HttpApiGroup.make("ctx")
      .add(
        HttpApiEndpoint.get("test", "/ctx-test").addSuccess(
          Schema.Struct({ success: Schema.Boolean })
        )
      )
    {}

    class CtxApi extends HttpApi.make("ctx-api").add(CtxGroup) {}

    const CtxHandlers = HttpApiBuilder.group(
      CtxApi,
      "ctx",
      (handlers) =>
        handlers.handle("test", () =>
          Effect.gen(function*() {
            const ctx = yield* CloudflareContext.ExecutionContext
            yield* ctx.waitUntil(Effect.log("Background task"))
            return { success: true }
          })
        )
    )

    const CtxApiLive = Layer.provide(
      HttpApiBuilder.api(CtxApi),
      CtxHandlers
    )

    const { handler, dispose } = makeFetchHandler({
      layer: CtxApiLive
    })

    const request = new Request("http://localhost/ctx-test")
    const env = {}
    const ctx: ExecutionContext = {
      waitUntil: (promise) => {
        waitUntilPromises.push(promise)
      },
      passThroughOnException: () => {},
      props: {}
    }

    const response = await handler(request, env, ctx)

    expect(response.status).toBe(200)
    expect(waitUntilPromises.length).toBe(1)

    await dispose()
  })

  it("should cache handler after first request", async () => {
    let initCount = 0

    const InitLayer = Layer.effectDiscard(
      Effect.sync(() => { initCount++ })
    )

    const { handler, dispose } = makeFetchHandler({
      layer: Layer.provide(TestApiLive, InitLayer)
    })

    const request1 = new Request("http://localhost/hello")
    const request2 = new Request("http://localhost/hello")
    const env = {}
    const ctx = createMockExecutionContext()

    expect(initCount).toBe(0) // Not initialized yet

    await handler(request1, env, ctx)
    expect(initCount).toBe(1) // Initialized on first request

    await handler(request2, env, ctx)
    expect(initCount).toBe(1) // Reused, not re-initialized

    await dispose()
  })

  it("should isolate env between requests", async () => {
    const { handler, dispose } = makeFetchHandler({
      layer: TestApiLive
    })

    const request = new Request("http://localhost/env")
    const ctx = createMockExecutionContext()

    const response1 = await handler(request, { TEST_VAR: "value1" }, ctx)
    const data1 = await response1.json()

    const response2 = await handler(request, { TEST_VAR: "value2" }, ctx)
    const data2 = await response2.json()

    expect(data1).toEqual({ value: "value1" })
    expect(data2).toEqual({ value: "value2" })

    await dispose()
  })

  it("should apply middleware when provided", async () => {
    let middlewareCalled = false

    const { handler, dispose } = makeFetchHandler({
      layer: TestApiLive,
      middleware: (httpApp) => {
        middlewareCalled = true
        return httpApp
      }
    })

    const request = new Request("http://localhost/hello")
    const env = {}
    const ctx = createMockExecutionContext()

    await handler(request, env, ctx)

    expect(middlewareCalled).toBe(true)

    await dispose()
  })
})

describe("makeFetchHandler - HttpApp pattern", () => {
  it("should create handler from HttpApp", () => {
    const httpApp = HttpServerResponse.text("test")

    const { handler, dispose } = makeFetchHandler({
      httpApp,
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")
    expect(typeof dispose).toBe("function")
  })

  it("should handle requests with HttpApp", async () => {
    const httpApp = HttpServerResponse.text("Hello from HttpApp")

    const { handler, dispose } = makeFetchHandler({
      httpApp,
      layer: Layer.empty
    })

    const request = new Request("http://localhost/test")
    const env = {}
    const ctx = createMockExecutionContext()

    const response = await handler(request, env, ctx)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toBe("Hello from HttpApp")

    await dispose()
  })

  it("should provide context to HttpApp", async () => {
    const httpApp = Effect.gen(function*() {
      const env = yield* CloudflareContext.Env
      const envRecord = env as Record<string, unknown>
      return HttpServerResponse.text(envRecord.MESSAGE as string || "no message")
    })

    const { handler, dispose } = makeFetchHandler({
      httpApp,
      layer: Layer.empty
    })

    const request = new Request("http://localhost/test")
    const env = { MESSAGE: "test-message" }
    const ctx = createMockExecutionContext()

    const response = await handler(request, env, ctx)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toBe("test-message")

    await dispose()
  })

  it("should support complex HttpApp with routing", async () => {
    const httpApp = HttpRouter.empty.pipe(
      HttpRouter.get("/hello", HttpServerResponse.text("Hello")),
      HttpRouter.get("/world", HttpServerResponse.text("World"))
    )

    const { handler, dispose } = makeFetchHandler({
      httpApp,
      layer: Layer.empty
    })

    const ctx = createMockExecutionContext()

    const response1 = await handler(new Request("http://localhost/hello"), {}, ctx)
    const text1 = await response1.text()

    const response2 = await handler(new Request("http://localhost/world"), {}, ctx)
    const text2 = await response2.text()

    expect(text1).toBe("Hello")
    expect(text2).toBe("World")

    await dispose()
  })
})

describe("makeFetchHandler - Effect pattern", () => {
  it("should create handler from Effect<Response>", async () => {
    const { handler, dispose } = makeFetchHandler({
      effect: Effect.succeed(new Response("hello")),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")

    const response = await handler(new Request("http://localhost"), {}, createMockExecutionContext())
    expect(await response.text()).toBe("hello")

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

    const mockCtx = createMockExecutionContext()

    await handler(new Request("http://localhost"), {}, mockCtx)
    await handler(new Request("http://localhost"), {}, mockCtx)

    expect(callCount).toBe(2)
    await dispose()
  })

  it("should provide Env and ExecutionContext to effect", async () => {
    let receivedEnv: Record<string, unknown> | undefined
    let receivedCtx = false

    const effect = Effect.gen(function*() {
      const env = yield* CloudflareContext.Env
      const ctx = yield* CloudflareContext.ExecutionContext
      receivedEnv = env as Record<string, unknown>
      receivedCtx = true
      return new Response("ok")
    })

    const { handler, dispose } = makeFetchHandler({
      effect,
      layer: Layer.empty
    })

    await handler(new Request("http://localhost"), { TEST: "val" }, createMockExecutionContext())

    expect(receivedEnv).toEqual({ TEST: "val" })
    expect(receivedCtx).toBe(true)

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

    const response = await handler(new Request("http://localhost"), {}, createMockExecutionContext())
    expect(await response.text()).toBe("test")
    await dispose()
  })

  it("should handle concurrent requests", async () => {
    const effect = Effect.succeed(new Response("ok"))

    const { handler, dispose } = makeFetchHandler({
      effect,
      layer: Layer.empty
    })

    const promises = Array.from({ length: 10 }, () =>
      handler(new Request("http://localhost"), {}, createMockExecutionContext())
    )

    const responses = await Promise.all(promises)

    expect(responses).toHaveLength(10)
    responses.forEach((r) => expect(r.status).toBe(200))

    await dispose()
  })
})

describe("makeFetchHandler - Function pattern", () => {
  it("should create handler from function", async () => {
    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) => Effect.succeed(new Response("hello")),
      layer: Layer.empty
    })

    expect(typeof handler).toBe("function")

    const response = await handler(new Request("http://localhost"), {}, createMockExecutionContext())
    expect(await response.text()).toBe("hello")

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

    await handler(new Request("http://example.com/test"), {}, createMockExecutionContext())
    expect(receivedUrl).toBe("http://example.com/test")
    await dispose()
  })

  it("should pass env to handler function", async () => {
    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) => {
        const envRecord = env as Record<string, unknown>
        return Effect.succeed(new Response(envRecord.TEST_VAR as string))
      },
      layer: Layer.empty
    })

    const response = await handler(
      new Request("http://localhost"),
      { TEST_VAR: "value123" },
      createMockExecutionContext()
    )

    expect(await response.text()).toBe("value123")
    await dispose()
  })

  it("should pass ExecutionContext to handler function", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = []

    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.gen(function*() {
          yield* ctx.waitUntil(Effect.log("Background task"))
          return new Response("ok")
        }),
      layer: Layer.empty
    })

    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => {
        waitUntilPromises.push(promise)
      },
      passThroughOnException: () => {},
      props: {}
    }

    await handler(new Request("http://localhost"), {}, mockCtx)
    expect(waitUntilPromises.length).toBe(1)
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

    const response = await handler(new Request("http://localhost"), {}, createMockExecutionContext())
    expect(await response.text()).toBe("data")
    await dispose()
  })

  it("should allow accessing both context services and function args", async () => {
    const { handler, dispose } = makeFetchHandler({
      handler: (request, env, ctx) =>
        Effect.gen(function*() {
          const envFromService = yield* CloudflareContext.Env
          const envRecord = env as Record<string, unknown>
          const fromServiceRecord = envFromService as Record<string, unknown>

          // Both should be the same
          return new Response(
            fromServiceRecord.VALUE === envRecord.VALUE ? "same" : "different"
          )
        }),
      layer: Layer.empty
    })

    const response = await handler(
      new Request("http://localhost"),
      { VALUE: "test" },
      createMockExecutionContext()
    )

    expect(await response.text()).toBe("same")
    await dispose()
  })
})

describe("makeFetchHandler - Error handling", () => {
  it("should handle HttpApi endpoint errors gracefully", async () => {
    class ErrorGroup extends HttpApiGroup.make("errors")
      .add(HttpApiEndpoint.get("error", "/error"))
    {}

    class ErrorApi extends HttpApi.make("error-api").add(ErrorGroup) {}

    const ErrorHandlers = HttpApiBuilder.group(
      ErrorApi,
      "errors",
      (handlers) => handlers.handle("error", () => Effect.die(new Error("test error")))
    )

    const ErrorApiLive = Layer.provide(
      HttpApiBuilder.api(ErrorApi),
      ErrorHandlers
    )

    const { handler, dispose } = makeFetchHandler({
      layer: ErrorApiLive
    })

    const response = await handler(new Request("http://localhost/error"), {}, createMockExecutionContext())
    expect(response.status).toBeGreaterThanOrEqual(400)
    await dispose()
  })

  it("should handle Effect failures in HttpApi", async () => {
    class FailGroup extends HttpApiGroup.make("fail")
      .add(HttpApiEndpoint.get("fail", "/fail"))
    {}

    class FailApi extends HttpApi.make("fail-api").add(FailGroup) {}

    const FailHandlers = HttpApiBuilder.group(
      FailApi,
      "fail",
      (handlers) => handlers.handle("fail", () => Effect.fail(new Error("failure")))
    )

    const FailApiLive = Layer.provide(
      HttpApiBuilder.api(FailApi),
      FailHandlers
    )

    const { handler, dispose } = makeFetchHandler({
      layer: FailApiLive
    })

    const response = await handler(new Request("http://localhost/fail"), {}, createMockExecutionContext())
    expect(response.status).toBeGreaterThanOrEqual(400)
    await dispose()
  })

  it("should propagate errors from raw Effect pattern", async () => {
    const { handler, dispose } = makeFetchHandler({
      effect: Effect.fail(new Error("raw error")),
      layer: Layer.empty
    })

    await expect(
      handler(new Request("http://localhost"), {}, createMockExecutionContext())
    ).rejects.toThrow()

    await dispose()
  })
})

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

    await handler(new Request("http://localhost"), {}, createMockExecutionContext())
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
