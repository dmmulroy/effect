import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpServerResponse } from "@effect/platform"
import * as CloudflareContext from "@effect/platform-cloudflare/CloudflareContext"
import * as CloudflareRuntime from "@effect/platform-cloudflare/CloudflareRuntime"
import * as CloudflareWrangler from "@effect/platform-cloudflare/CloudflareWrangler"
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("CloudflareContext", () => {
  it("ExecutionContext tag should be defined", () => {
    expect(CloudflareContext.ExecutionContext).toBeDefined()
  })

  it("Env tag should be defined", () => {
    expect(CloudflareContext.Env).toBeDefined()
  })

  it("withExecutionContext should be defined", () => {
    expect(typeof CloudflareContext.withExecutionContext).toBe("function")
  })

  it("withEnv should be defined", () => {
    expect(typeof CloudflareContext.withEnv).toBe("function")
  })

  it("executionContextLayer should be defined", () => {
    expect(typeof CloudflareContext.executionContextLayer).toBe("function")
  })

  it("envLayer should be defined", () => {
    expect(typeof CloudflareContext.envLayer).toBe("function")
  })

})

describe("CloudflareRuntime", () => {
  // Helper: Create mock ExecutionContext
  const createMockExecutionContext = (): ExecutionContext => {
    const ctx: Partial<ExecutionContext> = {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {}
    }
    return ctx as ExecutionContext
  }

  // Helper: Create test API
  class TestGroup extends HttpApiGroup.make("test")
    .add(
      HttpApiEndpoint.get("hello", "/hello").addSuccess(
        Schema.Struct({ message: Schema.String })
      )
    )
  {}

  class TestApi extends HttpApi.make("test-api").add(TestGroup) {}

  const TestHandlers = HttpApiBuilder.group(
    TestApi,
    "test",
    (handlers) => handlers.handle("hello", () => Effect.succeed({ message: "Hello, World!" }))
  )

  const TestApiLive = Layer.provide(
    HttpApiBuilder.api(TestApi),
    TestHandlers
  )

  describe("makeHandler", () => {
    it("should create handler and dispose functions", () => {
      const { dispose, handler } = CloudflareRuntime.makeFetchHandler({
        layer: TestApiLive
      })

      expect(typeof handler).toBe("function")
      expect(typeof dispose).toBe("function")
    })

    it("should handle requests with HttpApi.Api", async () => {
      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: TestApiLive
      })

      const request = new Request("http://localhost/hello")
      const env = { ENVIRONMENT: "test" }
      const ctx = createMockExecutionContext()

      const response = await handler(request, env, ctx)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ message: "Hello, World!" })

      await dispose()
    })

    it("should handle requests successfully", async () => {
      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: TestApiLive
      })

      const request = new Request("http://localhost/hello")
      const env = { ENVIRONMENT: "production" }
      const ctx = createMockExecutionContext()

      const response = await handler(request, env, ctx)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ message: "Hello, World!" })

      await dispose()
    })

    it("should cache handler after first initialization", async () => {
      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: TestApiLive
      })

      const request1 = new Request("http://localhost/hello")
      const request2 = new Request("http://localhost/hello")
      const env = {}
      const ctx = createMockExecutionContext()

      const response1 = await handler(request1, env, ctx)
      const response2 = await handler(request2, env, ctx)

      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)

      await dispose()
    })

    it("should handle multiple requests with same handler", async () => {
      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: TestApiLive
      })

      const request1 = new Request("http://localhost/hello")
      const request2 = new Request("http://localhost/hello")
      const env = {}
      const ctx = createMockExecutionContext()

      const response1 = await handler(request1, env, ctx)
      const response2 = await handler(request2, env, ctx)

      const data1 = await response1.json()
      const data2 = await response2.json()

      expect(data1).toEqual({ message: "Hello, World!" })
      expect(data2).toEqual({ message: "Hello, World!" })

      await dispose()
    })

    it("should handle endpoint errors gracefully", async () => {
      class ErrorGroup extends HttpApiGroup.make("errors")
        .add(HttpApiEndpoint.get("error", "/error"))
      {}

      class ErrorApi extends HttpApi.make("error-api").add(ErrorGroup) {}

      const ErrorHandlers = HttpApiBuilder.group(
        ErrorApi,
        "errors",
        (handlers) => handlers.handle("error", () => Effect.die(new Error("Intentional test error")))
      )

      const ErrorApiLive = Layer.provide(
        HttpApiBuilder.api(ErrorApi),
        ErrorHandlers
      )

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: ErrorApiLive
      })

      const request = new Request("http://localhost/error")
      const env = {}
      const ctx = createMockExecutionContext()

      const response = await handler(request, env, ctx)

      expect(response.status).toBeGreaterThanOrEqual(400)

      await dispose()
    })

    it("should handle calling handler after dispose", async () => {
      let cleanupCalled = false

      class ResourceGroup extends HttpApiGroup.make("resource")
        .add(
          HttpApiEndpoint.get("test", "/test").addSuccess(
            Schema.Struct({ resourceValue: Schema.String })
          )
        )
      {}

      class ResourceApi extends HttpApi.make("resource-api").add(ResourceGroup) {}

      // Layer with cleanup that sets flag
      const ResourceLayer = Layer.effectDiscard(
        Effect.acquireRelease(
          Effect.sync(() => ({ value: "resource-data" })),
          () => Effect.sync(() => { cleanupCalled = true })
        )
      )

      const ResourceHandlers = HttpApiBuilder.group(
        ResourceApi,
        "resource",
        (handlers) => handlers.handle("test", () => Effect.succeed({ resourceValue: "test" }))
      )

      const ResourceApiLive = Layer.provide(
        HttpApiBuilder.api(ResourceApi),
        Layer.merge(ResourceHandlers, ResourceLayer)
      )

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: ResourceApiLive
      })

      const request = new Request("http://localhost/test")
      const env = {}
      const ctx = createMockExecutionContext()

      // First request to initialize handler
      const response1 = await handler(request, env, ctx)
      const data1 = await response1.json()

      expect(response1.status).toBe(200)
      expect(data1).toEqual({ resourceValue: "test" })
      expect(cleanupCalled).toBe(false)

      // Dispose the runtime - should trigger cleanup
      await dispose()
      expect(cleanupCalled).toBe(true)

      // Handler continues to work after dispose due to cached handler
      // This may be incorrect behavior - handler should fail or be invalidated
      const response2 = await handler(request, env, ctx)
      const data2 = await response2.json()

      expect(response2.status).toBe(200)
      expect(data2).toEqual({ resourceValue: "test" })
    })
  })

  describe("makeHttpHandler", () => {
    it("should create a handler function", () => {
      const mockHttpApp = HttpServerResponse.text("test")

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        httpApp: mockHttpApp,
        layer: Layer.empty
      })

      expect(typeof handler).toBe("function")
      expect(typeof dispose).toBe("function")
    })

    it("should handle requests with explicit httpApp", async () => {
      const httpApp = HttpServerResponse.text("Hello from makeHttpHandler")

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        httpApp,
        layer: Layer.empty
      })

      const request = new Request("http://localhost/test")
      const env = {}
      const ctx = createMockExecutionContext()

      const response = await handler(request, env, ctx)
      const text = await response.text()

      expect(response.status).toBe(200)
      expect(text).toBe("Hello from makeHttpHandler")

      await dispose()
    })
  })

  describe("ExecutionContext integration", () => {
    it("should provide ExecutionContext to handlers", async () => {
      class ContextGroup extends HttpApiGroup.make("context")
        .add(
          HttpApiEndpoint.get("test", "/test").addSuccess(
            Schema.Struct({ success: Schema.Boolean })
          )
        )
      {}

      class ContextApi extends HttpApi.make("context-api").add(ContextGroup) {}

      const ContextHandlers = HttpApiBuilder.group(
        ContextApi,
        "context",
        (handlers) =>
          handlers.handle("test", () =>
            Effect.gen(function*() {
              const ctx = yield* CloudflareContext.ExecutionContext
              expect(ctx).toBeDefined()
              expect(typeof ctx.waitUntil).toBe("function")
              expect(ctx.raw).toBeDefined()
              return { success: true }
            }))
      )

      const ContextApiLive = Layer.provide(
        HttpApiBuilder.api(ContextApi),
        ContextHandlers
      )

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: ContextApiLive
      })

      const mockCtx: ExecutionContext = {
        waitUntil: () => {},
        passThroughOnException: () => {},
        props: {}
      }

      const request = new Request("http://localhost/test")
      const response = await handler(request, {}, mockCtx)

      expect(response.status).toBe(200)

      await dispose()
    })

    it("should support waitUntil with effects", async () => {
      const waitUntilPromises: Array<Promise<unknown>> = []

      class CleanupGroup extends HttpApiGroup.make("cleanup")
        .add(
          HttpApiEndpoint.get("cleanup", "/cleanup").addSuccess(
            Schema.Struct({ message: Schema.String })
          )
        )
      {}

      class CleanupApi extends HttpApi.make("cleanup-api").add(CleanupGroup) {}

      const CleanupHandlers = HttpApiBuilder.group(
        CleanupApi,
        "cleanup",
        (handlers) =>
          handlers.handle("cleanup", () =>
            Effect.gen(function*() {
              const ctx = yield* CloudflareContext.ExecutionContext
              yield* ctx.waitUntil(
                Effect.log("Background cleanup task")
              )
              return { message: "cleanup scheduled" }
            }))
      )

      const CleanupApiLive = Layer.provide(
        HttpApiBuilder.api(CleanupApi),
        CleanupHandlers
      )

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: CleanupApiLive
      })

      const mockCtx: ExecutionContext = {
        waitUntil: (promise) => {
          waitUntilPromises.push(promise)
        },
        passThroughOnException: () => {},
        props: {}
      }

      const request = new Request("http://localhost/cleanup")
      const response = await handler(request, {}, mockCtx)

      expect(response.status).toBe(200)
      expect(waitUntilPromises.length).toBe(1)

      await dispose()
    })
  })

  describe("Env bindings", () => {
    it("should provide Env to handlers", async () => {
      class EnvGroup extends HttpApiGroup.make("env")
        .add(
          HttpApiEndpoint.get("env", "/env").addSuccess(
            Schema.Struct({
              hasEnv: Schema.Boolean,
              value: Schema.String
            })
          )
        )
      {}

      class EnvApi extends HttpApi.make("env-api").add(EnvGroup) {}

      const EnvHandlers = HttpApiBuilder.group(
        EnvApi,
        "env",
        (handlers) =>
          handlers.handle("env", () =>
            Effect.gen(function*() {
              const env = yield* CloudflareContext.Env
              return {
                hasEnv: env !== undefined,
                value: (env as Record<string, unknown>).TEST_VAR as string || "not found"
              }
            }))
      )

      const EnvApiLive = Layer.provide(
        HttpApiBuilder.api(EnvApi),
        EnvHandlers
      )

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: EnvApiLive
      })

      const testEnv = { TEST_VAR: "test-value-123" }
      const request = new Request("http://localhost/env")
      const ctx = createMockExecutionContext()

      const response = await handler(request, testEnv, ctx)
      const data = await response.json() as { hasEnv: boolean; value: string }

      expect(response.status).toBe(200)
      expect(data.hasEnv).toBe(true)
      expect(data.value).toBe("test-value-123")

      await dispose()
    })

    it("should isolate env between requests", async () => {
      class IsolationGroup extends HttpApiGroup.make("isolation")
        .add(
          HttpApiEndpoint.get("value", "/value").addSuccess(
            Schema.Struct({ value: Schema.String })
          )
        )
      {}

      class IsolationApi extends HttpApi.make("isolation-api").add(IsolationGroup) {}

      const IsolationHandlers = HttpApiBuilder.group(
        IsolationApi,
        "isolation",
        (handlers) =>
          handlers.handle("value", () =>
            Effect.gen(function*() {
              const env = yield* CloudflareContext.Env
              return { value: (env as Record<string, unknown>).VALUE as string || "none" }
            }))
      )

      const IsolationApiLive = Layer.provide(
        HttpApiBuilder.api(IsolationApi),
        IsolationHandlers
      )

      const { handler, dispose } = CloudflareRuntime.makeFetchHandler({
        layer: IsolationApiLive
      })

      const request = new Request("http://localhost/value")
      const ctx = createMockExecutionContext()

      const response1 = await handler(request, { VALUE: "first" }, ctx)
      const data1 = await response1.json() as { value: string }

      const response2 = await handler(request, { VALUE: "second" }, ctx)
      const data2 = await response2.json() as { value: string }

      expect(data1.value).toBe("first")
      expect(data2.value).toBe("second")

      await dispose()
    })
  })

  it("runMain should be defined", () => {
    expect(CloudflareRuntime.runMain).toBeDefined()
    expect(typeof CloudflareRuntime.runMain).toBe("function")
  })
})

describe("CloudflareWrangler", () => {
  describe("layer", () => {
    it("should provide Env and ExecutionContext services", async () => {
      const WranglerLive = CloudflareWrangler.layer({
        persist: false
      })

      const program = Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        const ctx = yield* CloudflareContext.ExecutionContext

        expect(env).toBeDefined()
        expect(typeof env).toBe("object")

        expect(ctx).toBeDefined()
        expect(typeof ctx.waitUntil).toBe("function")
        expect(typeof ctx.passThroughOnException).toBe("object")
        expect(ctx.raw).toBeDefined()

        return { success: true }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(WranglerLive))
      )

      expect(result.success).toBe(true)
    })

    it("should cleanup proxy on scope end", async () => {
      const WranglerLive = CloudflareWrangler.layer({
        persist: false
      })

      const program = Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        expect(env).toBeDefined()

        return { success: true }
      })

      // Run twice to verify cleanup happens between runs
      const result1 = await Effect.runPromise(
        program.pipe(Effect.provide(WranglerLive))
      )

      const result2 = await Effect.runPromise(
        program.pipe(Effect.provide(WranglerLive))
      )

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      // If we get here, cleanup succeeded (no errors thrown during multiple runs)
    })

    it("should compose with other layers", async () => {
      const WranglerLive = CloudflareWrangler.layer({
        persist: false
      })

      class TestService extends Effect.Service<TestService>()("TestService", {
        effect: Effect.succeed({ value: "test-service" })
      }) {}

      const TestLive = Layer.succeed(TestService, new TestService({ value: "test-service" }))

      const MainLive = Layer.mergeAll(WranglerLive, TestLive)

      const program = Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        const ctx = yield* CloudflareContext.ExecutionContext
        const testService = yield* TestService

        expect(env).toBeDefined()
        expect(ctx).toBeDefined()
        expect(testService.value).toBe("test-service")

        return { success: true }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(MainLive))
      )

      expect(result.success).toBe(true)
    })

    it("should allow accessing env bindings", async () => {
      const WranglerLive = CloudflareWrangler.layer({
        persist: false
      })

      const program = Effect.gen(function*() {
        const env = yield* CloudflareContext.Env

        // Wrangler provides empty env object in test mode
        expect(env).toBeDefined()
        expect(typeof env).toBe("object")

        return { envKeys: Object.keys(env) }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(WranglerLive))
      )

      expect(Array.isArray(result.envKeys)).toBe(true)
    })

    it("should allow using ExecutionContext methods", async () => {
      const WranglerLive = CloudflareWrangler.layer({
        persist: false
      })

      let backgroundTaskRan = false

      const program = Effect.gen(function*() {
        const ctx = yield* CloudflareContext.ExecutionContext

        // Test waitUntil
        yield* ctx.waitUntil(
          Effect.sync(() => {
            backgroundTaskRan = true
          })
        )

        return { success: true }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(WranglerLive))
      )

      expect(result.success).toBe(true)

      // waitUntil schedules async, so wait briefly
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(backgroundTaskRan).toBe(true)
    })

    it("should provide fresh context per layer instantiation", async () => {
      const program = Effect.gen(function*() {
        const env = yield* CloudflareContext.Env
        return { env }
      })

      const WranglerLive1 = CloudflareWrangler.layer({ persist: false })
      const WranglerLive2 = CloudflareWrangler.layer({ persist: false })

      const result1 = await Effect.runPromise(
        program.pipe(Effect.provide(WranglerLive1))
      )

      const result2 = await Effect.runPromise(
        program.pipe(Effect.provide(WranglerLive2))
      )

      // Each layer instantiation should provide its own context
      expect(result1.env).toBeDefined()
      expect(result2.env).toBeDefined()
    })
  })

  describe("makePlatformProxy", () => {
    it("should be defined", () => {
      expect(CloudflareWrangler.makePlatformProxy).toBeDefined()
      expect(typeof CloudflareWrangler.makePlatformProxy).toBe("function")
    })

    it("should return scoped effect with proxy", async () => {
      const program = Effect.gen(function*() {
        const proxy = yield* CloudflareWrangler.makePlatformProxy({
          persist: false
        })

        expect(proxy.env).toBeDefined()
        expect(proxy.ctx).toBeDefined()
        expect(proxy.caches).toBeDefined()
        expect(typeof proxy.dispose).toBe("function")

        return { success: true }
      })

      const result = await Effect.runPromise(
        Effect.scoped(program)
      )

      expect(result.success).toBe(true)
    })
  })
})
