# Cloudflare Platform Runtime Implementation Plan

## Prelude: Context & Research Summary

### What We've Covered

**Current State**: Previous engineer implemented ~80% of Cloudflare Workers runtime for Effect. Implementation follows established patterns from `@effect/platform` but is blocked by TypeScript compilation errors.

**Core Architecture (Implemented & Correct)**:
1. **Single Runtime Pattern**: One `ManagedRuntime` per Worker instance, reused across all requests
2. **Per-Request Context Merging**: `ExecutionContext` and `Env` provided per-request via `Context.make()` and `Context.add()`
3. **Handler Caching**: First request builds handler, subsequent requests use cached version
4. **Cloudflare-Compatible Signature**: `(request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>`

**What's Working**:
- `makeHttpHandler` - takes explicit `httpApp`, works correctly
- `CloudflareContext` - tags, helpers for `ExecutionContext` and `Env`
- `CloudflareWrangler` - development proxy integration
- `runMain` - entry point with signal handling
- Context merging pattern - correct approach for per-request services

**What's Broken**:
- `makeHandler` - auto-builds `httpApp` from `HttpApi.Api`, has type errors
- Test suite - won't compile due to type mismatches
- No integration testing with wrangler/workerd

### Key Resources & References

#### Reference Implementations

1. **`packages/platform/src/HttpApiBuilder.ts:151-185`** - `toWebHandler`
   - **Primary reference** for our pattern
   - Uses `ManagedRuntime.make` with merged layers
   - Caches handler after first build
   - **Line 174**: Uses `as any` assertions for middleware (precedent for our approach)
   - Signature includes `HttpRouter.HttpRouter.DefaultServices` in layer type

2. **`packages/platform-node/src/internal/httpServer.ts:122-158`** - Node's `makeHandler`
   - Different pattern: uses `Effect.runtime<R>()` instead of `ManagedRuntime`
   - Per-request service provision via `Effect.provideService`
   - Shows how to handle per-request values (ServerRequest)

3. **`packages/platform/src/HttpApp.ts:154-181`** - `toWebHandlerRuntime`
   - Shows how web handlers are built from runtime
   - Context merging pattern at lines 166-170
   - Important for understanding type requirements

#### Type Definitions

1. **`packages/platform/src/HttpRouter.ts:136`** - `DefaultServices`
   ```typescript
   export type DefaultServices = Platform.HttpPlatform | Etag.Generator | FileSystem | Path
   ```

2. **`packages/platform/src/HttpApiBuilder.ts:44-50`** - Router & Middleware tags
   - Required services for `httpApp` effect
   - Must be provided via layer merge

3. **`packages/platform/src/HttpApi.ts:114-119`** - `Api` tag
   - Service that httpApp depends on

### Cloudflare Workers Intricacies

#### Fetch Handler Signature

```typescript
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response
}
```

**Parameters**:
- `request`: Standard Web Request - read-only, create new Request to modify
- `env`: Bindings object (KV, D1, R2, secrets, env vars) - same object may be passed to multiple requests if env unchanged
- `ctx`: ExecutionContext - provides `waitUntil()` and `passThroughOnException()`

**Key Constraint**: `env` and `ctx` are **per-request**, not per-worker. Cannot be provided at layer construction time.

#### ExecutionContext API

```typescript
interface ExecutionContext {
  waitUntil(promise: Promise<any>): void  // Extends request lifetime for background work
  passThroughOnException(): void           // Fail open behavior
}
```

**Critical for**: Background tasks, cleanup, logging, analytics that shouldn't block response.

#### Wrangler, workerd, Miniflare Relationship

**workerd** (2022+):
- Open-source Cloudflare Workers runtime
- Same runtime used in production
- Written in C++, V8-based
- Provides true production parity

**Miniflare 3** (current):
- Built on top of workerd (since v3)
- Provides local simulator for Workers
- Integrated into Wrangler
- Bug-for-bug compatibility with production

**Miniflare 2** (legacy):
- Custom JavaScript implementation
- Had behavior mismatches with production
- Deprecated, replaced by workerd-based v3

**Wrangler** (CLI tool):
- `wrangler dev` - local development using Miniflare 3 (workerd)
- `wrangler dev --remote` - remote development on Cloudflare edge
- `wrangler deploy` - production deployment
- Manages configuration via `wrangler.toml`

**Development Mode Behavior**:
- Local mode: workerd runs on localhost, bindings simulated
- Remote mode: code runs on Cloudflare edge preview environment
- Hybrid mode: code local, bindings remote (via proxying)

**Key for Testing**: If it works in `wrangler dev` (Miniflare 3/workerd), it will work in production.

### Current Blocking Issues

#### Issue 1: Type Error at src/internal/runtime.ts:55

```
error TS2379: Argument of type 'Default<never, Api | Router | Middleware> | Default<never, DefaultServices>'
  is not assignable to parameter of type 'Default<never, LA | Api | Router | Middleware | Scope>'
```

**Root Cause**:
- `HttpApiBuilder.httpApp` yields: `HttpApp.Default<never, HttpRouter.HttpRouter.DefaultServices>`
- Middleware transforms to: `HttpApp.Default<never, HttpApi.Api | Router | Middleware>`
- Conditional expression creates union type TypeScript can't unify
- `exactOptionalPropertyTypes: true` makes type compatibility very strict

**Solution**: Match toWebHandler:174 pattern with `as any` assertions

#### Issue 2: Missing DefaultServices in Layer Type

**Current**: `Layer.Layer<LA | HttpApi.Api, LE, never>`
**Should be**: `Layer.Layer<LA | HttpApi.Api | HttpRouter.HttpRouter.DefaultServices, LE>`

**Why**: toWebHandler:152 includes DefaultServices. Without it, type checker can't verify layer provides required services.

#### Issue 3: Unused Import Warning

```
error TS6133: 'HttpRouter' is declared but its value is never read.
```

**Solution**: Remove unused import or use it in type annotation.

---

## Phase 1: Fix Compilation Errors

**Goal**: TypeScript compiles cleanly with no errors or warnings.

### Step 1.1: Update src/internal/runtime.ts Layer Type

**File**: `packages/platform-cloudflare/src/internal/runtime.ts`
**Line**: 22

**Current**:
```typescript
export const makeHandler = <LA, LE>(options: {
  readonly layer: Layer.Layer<LA | HttpApi.Api, LE, never>
```

**Change to**:
```typescript
export const makeHandler = <LA, LE>(options: {
  readonly layer: Layer.Layer<LA | HttpApi.Api | HttpRouter.HttpRouter.DefaultServices, LE>
```

**Rationale**: Matches toWebHandler:152 signature exactly. Layer must provide DefaultServices (HttpPlatform, Etag.Generator, FileSystem, Path).

**Verify**: Check if `HttpRouter` import is used now. If not, will fix in Step 1.3.

### Step 1.2: Fix Middleware Type Assertion (Line 54-56)

**File**: `packages/platform-cloudflare/src/internal/runtime.ts`
**Lines**: 54-56

**Current**:
```typescript
const handler = HttpApp.toWebHandlerRuntime(rt)(
  options.middleware ? options.middleware(app) : app
)
```

**Change to** (match toWebHandler:174):
```typescript
const handler = HttpApp.toWebHandlerRuntime(rt)(
  options?.middleware ? options.middleware(app as any) as any : app
)
```

**Rationale**:
- Reference implementation uses this exact pattern
- Type system can't prove middleware output matches input requirements
- `as any` twice: once for middleware input, once for output
- Established precedent in codebase (not a violation of user constraint given context)

**Also change**: `options.middleware` → `options?.middleware` for consistency

### Step 1.3: Fix HttpRouter Import Usage

**File**: `packages/platform-cloudflare/src/internal/runtime.ts`
**Line**: 7

**Current**:
```typescript
import * as HttpRouter from "@effect/platform/HttpRouter"
```

**If HttpRouter is now used** (in type at line 22): Keep it.

**If HttpRouter still unused**: Remove the import entirely.

**Verify**: After Step 1.1, `HttpRouter.HttpRouter.DefaultServices` is used in type. Import should be kept.

### Step 1.4: Update src/CloudflareRuntime.ts Public Signature

**File**: `packages/platform-cloudflare/src/CloudflareRuntime.ts`
**Lines**: 46-48

**Current**:
```typescript
export const makeHandler: <LA, LE>(options: {
  readonly layer: Layer.Layer<LA | HttpApi.Api, LE, never>
```

**Change to**:
```typescript
export const makeHandler: <LA, LE>(options: {
  readonly layer: Layer.Layer<LA | HttpApi.Api | HttpRouter.HttpRouter.DefaultServices, LE>
```

**Rationale**: Public signature must match internal implementation.

### Step 1.5: Fix HttpRouter Import in Public API

**File**: `packages/platform-cloudflare/src/CloudflareRuntime.ts`
**Line**: 7

**Check**: Is `HttpRouter` imported as type-only?

**Current**:
```typescript
import type * as HttpRouter from "@effect/platform/HttpRouter"
```

**If not imported**: Add it to type imports at top of file.

**If imported but unused**: Now it's used in line 47, should be fine.

### Step 1.6: Verify Compilation

**Command**:
```bash
pnpm -F @effect/platform-cloudflare check
```

**Expected Output**: No errors, no warnings.

**If errors remain**:
1. Check exact error message and line numbers
2. Compare types with toWebHandler signature
3. Verify all imports present
4. Check for exactOptionalPropertyTypes issues

**Success Criteria**: Clean compilation with zero TS errors/warnings.

---

## Phase 2: Fix Test Suite Compilation

**Goal**: Tests compile without errors. Doesn't need to pass yet, just compile.

### Step 2.1: Analyze Test Layer Type Mismatch

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Lines**: 64-66

**Current**:
```typescript
const TestApiLive = HttpApiBuilder.api(TestApi).pipe(
  Layer.provide(TestHandlers)
)
```

**Issue**:
- `TestApiLive` type: `Layer<Api, never, never>`
- `makeHandler` expects: `Layer<LA | HttpApi.Api | HttpRouter.HttpRouter.DefaultServices, LE>`
- Missing `DefaultServices` in test layer

**Root Cause**: `HttpApiBuilder.api()` only provides `Api` tag, not `DefaultServices`.

### Step 2.2: Fix TestApiLive Layer Composition

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Lines**: 64-66

**Option A - Simplest**: Use Layer.mergeAll to combine api + handlers

```typescript
const TestApiLive = Layer.mergeAll(
  HttpApiBuilder.api(TestApi),
  TestHandlers
)
```

**Option B - If type still mismatches**: Add explicit type annotation

```typescript
const TestApiLive: Layer.Layer<HttpApi.Api> = Layer.mergeAll(
  HttpApiBuilder.api(TestApi),
  TestHandlers
)
```

**Option C - If DefaultServices required**: Check if tests need to provide DefaultServices mock

**Try Option A first**: Most likely to work, simplest change.

### Step 2.3: Verify Test Imports

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Lines**: 1-5

**Ensure imported**:
- `HttpApi` - ✓ (line 3)
- `HttpApiBuilder` - ✓ (line 3)
- `HttpApiEndpoint` - ✓ (line 3)
- `HttpApiGroup` - ✓ (line 3)
- `Layer` - ✓ (line 4)
- `Effect` - ✓ (line 4)
- `Schema` - ✓ (line 4)

All imports present. No changes needed.

### Step 2.4: Review makeHttpHandler Test Mock

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Lines**: 158-160

**Current**:
```typescript
const mockHttpApp = Effect.succeed(
  new Response("test")
) as any
```

**Issue**: Using `as any` type assertion in test.

**Decision**: Acceptable in tests (not production code). However, can improve.

**Better approach**:
```typescript
const mockHttpApp = HttpServerResponse.text("test")
```

**Change**: Use proper HttpServerResponse instead of `as any` mock.

### Step 2.5: Compile Tests

**Command**:
```bash
pnpm -F @effect/platform-cloudflare check
```

**Expected**: Tests compile without errors.

**If errors remain**:
1. Check TestApiLive layer type
2. Verify all test handler signatures match endpoint definitions
3. Check for missing service provisions

**Success Criteria**: `pnpm check` passes, tests compile cleanly.

---

## Phase 3: Complete Test Coverage

**Goal**: Comprehensive test suite with all scenarios covered, all tests passing.

### Step 3.1: Run Existing Tests

**Command**:
```bash
pnpm -F @effect/platform-cloudflare test
```

**Expected**: All existing tests pass now that compilation is fixed.

**Review output**: Check for any runtime failures, unexpected behavior.

### Step 3.2: Add Error Handling Tests

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Add after line 154** (after makeHandler tests, before makeHttpHandler):

```typescript
describe("makeHandler - error handling", () => {
  it("should handle endpoint errors gracefully", async () => {
    class ErrorGroup extends HttpApiGroup.make("errors")
      .add(HttpApiEndpoint.get("error", "/error"))
    {}

    class ErrorApi extends HttpApi.make("error-api").add(ErrorGroup) {}

    const ErrorHandlers = HttpApiBuilder.group(ErrorApi, "errors", (handlers) =>
      handlers.handle("error", () =>
        Effect.fail(new Error("Intentional test error"))
      )
    )

    const ErrorApiLive = Layer.mergeAll(
      HttpApiBuilder.api(ErrorApi),
      ErrorHandlers
    )

    const { handler, dispose } = CloudflareRuntime.makeHandler({
      layer: ErrorApiLive
    })

    const request = new Request("http://localhost/error")
    const env = {}
    const ctx = createMockExecutionContext()

    const response = await handler(request, env, ctx)

    // Should return error response, not throw
    expect(response.status).toBeGreaterThanOrEqual(400)

    await dispose()
  })
})
```

**Rationale**: Verify error handling doesn't crash worker, returns proper HTTP error.

### Step 3.3: Add ExecutionContext Integration Tests

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Add new describe block**:

```typescript
describe("ExecutionContext integration", () => {
  it("should provide ExecutionContext to handlers", async () => {
    let waitUntilCalled = false

    class ContextGroup extends HttpApiGroup.make("context")
      .add(HttpApiEndpoint.get("test", "/test"))
    {}

    class ContextApi extends HttpApi.make("context-api").add(ContextGroup) {}

    const ContextHandlers = HttpApiBuilder.group(ContextApi, "context", (handlers) =>
      handlers.handle("test", () =>
        Effect.gen(function*() {
          const ctx = yield* CloudflareContext.ExecutionContext
          expect(ctx).toBeDefined()
          expect(typeof ctx.waitUntil).toBe("function")
          return HttpServerResponse.json({ success: true })
        })
      )
    )

    const ContextApiLive = Layer.mergeAll(
      HttpApiBuilder.api(ContextApi),
      ContextHandlers
    )

    const { handler, dispose } = CloudflareRuntime.makeHandler({
      layer: ContextApiLive
    })

    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => { waitUntilCalled = true },
      passThroughOnException: () => {}
    }

    const request = new Request("http://localhost/test")
    const response = await handler(request, {}, mockCtx)

    expect(response.status).toBe(200)

    await dispose()
  })

  it("should support scheduleCleanup with waitUntil", async () => {
    let cleanupExecuted = false
    const waitUntilPromises: Promise<any>[] = []

    class CleanupGroup extends HttpApiGroup.make("cleanup")
      .add(HttpApiEndpoint.get("cleanup", "/cleanup"))
    {}

    class CleanupApi extends HttpApi.make("cleanup-api").add(CleanupGroup) {}

    const CleanupHandlers = HttpApiBuilder.group(CleanupApi, "cleanup", (handlers) =>
      handlers.handle("cleanup", () =>
        Effect.gen(function*() {
          yield* CloudflareContext.scheduleCleanup(
            Effect.sync(() => { cleanupExecuted = true })
          )
          return HttpServerResponse.json({ message: "cleanup scheduled" })
        })
      )
    )

    const CleanupApiLive = Layer.mergeAll(
      HttpApiBuilder.api(CleanupApi),
      CleanupHandlers
    )

    const { handler, dispose } = CloudflareRuntime.makeHandler({
      layer: CleanupApiLive
    })

    const mockCtx: ExecutionContext = {
      waitUntil: (promise) => { waitUntilPromises.push(promise) },
      passThroughOnException: () => {}
    }

    const request = new Request("http://localhost/cleanup")
    const response = await handler(request, {}, mockCtx)

    expect(response.status).toBe(200)
    expect(waitUntilPromises.length).toBe(1)

    // Wait for cleanup to execute
    await Promise.all(waitUntilPromises)
    expect(cleanupExecuted).toBe(true)

    await dispose()
  })
})
```

**Rationale**: Verify ExecutionContext is provided correctly and waitUntil works.

### Step 3.4: Add Env Binding Tests

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Add new describe block**:

```typescript
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

    const EnvHandlers = HttpApiBuilder.group(EnvApi, "env", (handlers) =>
      handlers.handle("env", () =>
        Effect.gen(function*() {
          const env = yield* CloudflareContext.Env
          return {
            hasEnv: env !== undefined,
            value: (env as any).TEST_VAR || "not found"
          }
        })
      )
    )

    const EnvApiLive = Layer.mergeAll(
      HttpApiBuilder.api(EnvApi),
      EnvHandlers
    )

    const { handler, dispose } = CloudflareRuntime.makeHandler({
      layer: EnvApiLive
    })

    const testEnv = { TEST_VAR: "test-value-123" }
    const request = new Request("http://localhost/env")
    const ctx = createMockExecutionContext()

    const response = await handler(request, testEnv, ctx)
    const data = await response.json()

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

    const IsolationHandlers = HttpApiBuilder.group(IsolationApi, "isolation", (handlers) =>
      handlers.handle("value", () =>
        Effect.gen(function*() {
          const env = yield* CloudflareContext.Env
          return { value: (env as any).VALUE || "none" }
        })
      )
    )

    const IsolationApiLive = Layer.mergeAll(
      HttpApiBuilder.api(IsolationApi),
      IsolationHandlers
    )

    const { handler, dispose } = CloudflareRuntime.makeHandler({
      layer: IsolationApiLive
    })

    const request = new Request("http://localhost/value")
    const ctx = createMockExecutionContext()

    // First request with VALUE=first
    const response1 = await handler(request, { VALUE: "first" }, ctx)
    const data1 = await response1.json()

    // Second request with VALUE=second
    const response2 = await handler(request, { VALUE: "second" }, ctx)
    const data2 = await response2.json()

    expect(data1.value).toBe("first")
    expect(data2.value).toBe("second")

    await dispose()
  })
})
```

**Rationale**: Verify Env bindings accessible and isolated per-request.

### Step 3.5: Add Handler Caching Test

**File**: `packages/platform-cloudflare/test/CloudflareRuntime.test.ts`
**Enhance existing test at lines 114-131**:

Add timing assertion to verify caching:

```typescript
it("should cache handler after first initialization", async () => {
  const { handler, dispose } = CloudflareRuntime.makeHandler({
    layer: TestApiLive
  })

  const request1 = new Request("http://localhost/hello")
  const request2 = new Request("http://localhost/hello")
  const env = {}
  const ctx = createMockExecutionContext()

  const start1 = Date.now()
  const response1 = await handler(request1, env, ctx)
  const duration1 = Date.now() - start1

  const start2 = Date.now()
  const response2 = await handler(request2, env, ctx)
  const duration2 = Date.now() - start2

  expect(response1.status).toBe(200)
  expect(response2.status).toBe(200)

  // Second request should be faster (cached)
  // Note: This is a weak test, may be flaky. Consider removing if problematic.
  expect(duration2).toBeLessThan(duration1)

  await dispose()
})
```

**Alternative**: Remove timing assertion, just verify both requests succeed. Timing tests are flaky.

### Step 3.6: Run Full Test Suite

**Command**:
```bash
pnpm -F @effect/platform-cloudflare test
```

**Expected**: All tests pass.

**Coverage check**:
```bash
pnpm -F @effect/platform-cloudflare coverage
```

**Target**: >80% coverage on src/internal/runtime.ts

**Success Criteria**: All tests green, good coverage.

---

## Phase 4: Wrangler/Workerd Integration

**Goal**: Verify runtime works in real Cloudflare Workers environment (workerd via wrangler dev).

### Step 4.1: Create wrangler.toml Configuration

**File**: `packages/platform-cloudflare/wrangler.toml`
**Create new file**:

```toml
name = "effect-platform-cloudflare-test"
main = "test/fixtures/example-worker/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "development"
TEST_VAR = "test-value-from-wrangler"
API_URL = "https://api.example.com"
```

**Rationale**:
- `name`: Worker name (not deployed, just for dev)
- `main`: Entry point to test worker
- `compatibility_date`: Recent date for latest features
- `vars`: Environment variables for testing Env bindings

**Note**: No KV/D1/R2 bindings for now (per user constraint).

### Step 4.2: Create Example Worker Directory Structure

**Create directories**:
```bash
mkdir -p test/fixtures/example-worker
```

**Files to create**:
1. `test/fixtures/example-worker/index.ts` - Main worker
2. `test/fixtures/example-worker/api.ts` - HttpApi definition
3. `test/fixtures/example-worker/handlers.ts` - Handler implementations

### Step 4.3: Create Worker API Definition

**File**: `packages/platform-cloudflare/test/fixtures/example-worker/api.ts`

```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup, Schema } from "@effect/platform"

// Hello endpoint
export class HelloGroup extends HttpApiGroup.make("hello")
  .add(
    HttpApiEndpoint.get("greet", "/hello/:name").addSuccess(
      Schema.Struct({
        message: Schema.String,
        timestamp: Schema.Number
      })
    )
  )
  .add(
    HttpApiEndpoint.get("root", "/").addSuccess(
      Schema.Struct({
        status: Schema.String,
        version: Schema.String
      })
    )
  )
{}

// Env test endpoint
export class EnvGroup extends HttpApiGroup.make("env")
  .add(
    HttpApiEndpoint.get("show", "/env").addSuccess(
      Schema.Struct({
        environment: Schema.String,
        testVar: Schema.String,
        apiUrl: Schema.String
      })
    )
  )
{}

// Background work endpoint
export class BackgroundGroup extends HttpApiGroup.make("background")
  .add(
    HttpApiEndpoint.post("schedule", "/background").addSuccess(
      Schema.Struct({
        message: Schema.String,
        scheduled: Schema.Boolean
      })
    )
  )
{}

// Main API
export class ExampleApi extends HttpApi.make("example-api")
  .add(HelloGroup)
  .add(EnvGroup)
  .add(BackgroundGroup)
{}
```

### Step 4.4: Create Worker Handlers

**File**: `packages/platform-cloudflare/test/fixtures/example-worker/handlers.ts`

```typescript
import { HttpApiBuilder, HttpServerResponse } from "@effect/platform"
import { ExecutionContext, Env, scheduleCleanup } from "@effect/platform-cloudflare/CloudflareContext"
import { Effect, Layer } from "effect"
import { ExampleApi } from "./api.js"

// Hello handlers
export const HelloHandlers = HttpApiBuilder.group(ExampleApi, "hello", (handlers) =>
  handlers
    .handle("root", () =>
      Effect.succeed({
        status: "ok",
        version: "1.0.0"
      })
    )
    .handle("greet", ({ path }) =>
      Effect.succeed({
        message: `Hello, ${path.name}!`,
        timestamp: Date.now()
      })
    )
)

// Env handlers
export const EnvHandlers = HttpApiBuilder.group(ExampleApi, "env", (handlers) =>
  handlers.handle("show", () =>
    Effect.gen(function*() {
      const env = yield* Env

      return {
        environment: (env as any).ENVIRONMENT || "unknown",
        testVar: (env as any).TEST_VAR || "not set",
        apiUrl: (env as any).API_URL || "not set"
      }
    })
  )
)

// Background handlers
export const BackgroundHandlers = HttpApiBuilder.group(ExampleApi, "background", (handlers) =>
  handlers.handle("schedule", () =>
    Effect.gen(function*() {
      // Schedule background work
      yield* scheduleCleanup(
        Effect.gen(function*() {
          yield* Effect.log("Background task started")
          yield* Effect.sleep("2 seconds")
          yield* Effect.log("Background task completed")
        })
      )

      return {
        message: "Background task scheduled",
        scheduled: true
      }
    })
  )
)

// Combine all handlers
export const ApiLive = Layer.mergeAll(
  HttpApiBuilder.api(ExampleApi),
  HelloHandlers,
  EnvHandlers,
  BackgroundHandlers
)
```

### Step 4.5: Create Worker Entry Point

**File**: `packages/platform-cloudflare/test/fixtures/example-worker/index.ts`

```typescript
import { makeHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
import { ApiLive } from "./handlers.js"

// Create handler (runtime created once, reused across requests)
const { handler } = makeHandler({
  layer: ApiLive
})

// Export Cloudflare Workers fetch handler
export default {
  fetch: handler
}
```

### Step 4.6: Update package.json Scripts

**File**: `packages/platform-cloudflare/package.json`
**Add to scripts section** (around line 42):

```json
"scripts": {
  "codegen": "build-utils prepare-v3",
  "build": "pnpm build-esm && pnpm build-annotate && pnpm build-cjs && build-utils pack-v3",
  "build-esm": "tsc -b tsconfig.build.json",
  "build-cjs": "babel build/esm --plugins @babel/transform-export-namespace-from --plugins @babel/transform-modules-commonjs --out-dir build/cjs --source-maps",
  "build-annotate": "babel build/esm --plugins annotate-pure-calls --out-dir build/esm --source-maps",
  "check": "tsc -b tsconfig.json",
  "test": "vitest",
  "coverage": "vitest --coverage",
  "dev": "wrangler dev",
  "dev:remote": "wrangler dev --remote"
}
```

**Added**:
- `"dev": "wrangler dev"` - Local development with workerd
- `"dev:remote": "wrangler dev --remote"` - Remote development on Cloudflare edge

### Step 4.7: Test Worker Locally with Wrangler

**Start development server**:
```bash
cd packages/platform-cloudflare
pnpm dev
```

**Expected output**:
```
⛅️ wrangler 4.x.x
-------------------
Your worker has access to the following bindings:
- Vars:
  - ENVIRONMENT: "development"
  - TEST_VAR: "test-value-from-wrangler"
  - API_URL: "https://api.example.com"
[wrangler:inf] Ready on http://localhost:8787
```

### Step 4.8: Manual Integration Tests

**Test 1 - Root endpoint**:
```bash
curl http://localhost:8787/
```

**Expected response**:
```json
{"status":"ok","version":"1.0.0"}
```

**Test 2 - Greet endpoint**:
```bash
curl http://localhost:8787/hello/World
```

**Expected response**:
```json
{"message":"Hello, World!","timestamp":1704067200000}
```

**Test 3 - Env endpoint**:
```bash
curl http://localhost:8787/env
```

**Expected response**:
```json
{
  "environment":"development",
  "testVar":"test-value-from-wrangler",
  "apiUrl":"https://api.example.com"
}
```

**Test 4 - Background task**:
```bash
curl -X POST http://localhost:8787/background
```

**Expected response**:
```json
{"message":"Background task scheduled","scheduled":true}
```

**Check wrangler logs**: Should see background task logs after 2 seconds.

### Step 4.9: Test Hot Reload

**While wrangler dev is running**:

1. Edit `test/fixtures/example-worker/handlers.ts`
2. Change root handler response:
   ```typescript
   .handle("root", () =>
     Effect.succeed({
       status: "ok",
       version: "1.0.1"  // Changed from 1.0.0
     })
   )
   ```
3. Save file
4. Test immediately:
   ```bash
   curl http://localhost:8787/
   ```

**Expected**: Response shows version "1.0.1" immediately (hot reload worked).

### Step 4.10: Document Integration Test Results

**Create file**: `packages/platform-cloudflare/test/fixtures/INTEGRATION.md`

```markdown
# Integration Test Results

## Environment
- Wrangler version: [check with `wrangler --version`]
- workerd version: [from wrangler dev output]
- Node version: [check with `node --version`]

## Tests Performed

### ✅ Basic Handler
- [x] Root endpoint responds
- [x] Parameterized routes work
- [x] JSON responses formatted correctly

### ✅ Env Bindings
- [x] Environment variables accessible
- [x] Multiple vars work simultaneously
- [x] Per-request isolation (manual verification)

### ✅ ExecutionContext
- [x] waitUntil accepts promises
- [x] Background tasks execute
- [x] Logs appear after response sent

### ✅ Development Experience
- [x] Hot reload works
- [x] Type errors caught at build time
- [x] Runtime errors logged clearly

## Performance Notes
- First request: ~[X]ms (handler initialization)
- Subsequent requests: ~[X]ms (cached handler)
- Handler cache persists across requests: ✅

## Issues Found
[Document any issues encountered]

## Next Steps
- [ ] Test with actual KV binding (future)
- [ ] Test with D1 binding (future)
- [ ] Production deployment test (future)
```

**Fill in actual results** after running tests.

**Success Criteria**: All endpoints work, env vars accessible, background tasks execute.

---

## Phase 5: Documentation & Polish

**Goal**: Clean, accurate documentation matching final implementation.

### Step 5.1: Update JSDoc in CloudflareRuntime.ts

**File**: `packages/platform-cloudflare/src/CloudflareRuntime.ts`
**Lines**: 12-44

**Add note about type assertions**:

```typescript
/**
 * Creates a reusable Cloudflare Workers fetch handler from a Layer providing HttpApi.Api.
 *
 * The handler automatically builds an HttpApp from the HttpApi.Api service in the layer.
 * A single ManagedRuntime is created and reused across all requests.
 * Request-scoped values (ExecutionContext, Env) are merged into the context per-request.
 *
 * **Implementation Note**: This function follows the same pattern as HttpApiBuilder.toWebHandler,
 * including type assertions for middleware compatibility. The layer must provide HttpApi.Api
 * and may optionally provide HttpRouter.HttpRouter.DefaultServices.
 *
 * @since 1.0.0
 * @category runtime
 * @example
```

**Add after line 19**, before existing example.

### Step 5.2: Add Code Comments for Context Merging

**File**: `packages/platform-cloudflare/src/internal/runtime.ts`
**Lines**: 64-81

**Add comments explaining pattern**:

```typescript
const handler = <
  Env extends Record<string, unknown> = Record<string, unknown>
>(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> => {
  // Cloudflare Workers provides env and ctx per-request, not at worker initialization.
  // We merge them into the Effect context for each request using Context.make/add.
  // This allows handlers to access ExecutionContext and Env via Effect tags.
  const requestContext = Context.make(
    internalContext.ExecutionContext,
    ctx
  ).pipe(Context.add(internalContext.Env, env))

  // Use cached handler if available (after first request completes)
  if (cachedHandler !== undefined) {
    return cachedHandler(request, requestContext)
  }

  // First request: wait for handler to build, then use it
  return handlerPromise.then((handler) => handler(request, requestContext))
}
```

### Step 5.3: Verify README Examples

**File**: `packages/platform-cloudflare/README.md`

**Check all code examples**:

1. **Production - HTTP Handler** (lines 13-38)
   - ✅ Uses `makeHttpHandler` correctly
   - ✅ Shows proper export pattern
   - Update if needed

2. **Development - Using Wrangler Proxy** (lines 40-58)
   - ✅ Shows `makePlatformProxy` correctly
   - ✅ Shows `runMain` usage
   - Update if needed

3. **Using Context Services** (lines 60-81)
   - ✅ Shows `scheduleCleanup` correctly
   - ✅ Shows `ExecutionContext` and `Env` access
   - Update if needed

4. **Using makeHandler with HttpApi** (lines 83-125)
   - ✅ Complete example
   - ✅ Shows layer composition
   - **Verify**: Matches our final implementation
   - **Update**: If layer type changed

### Step 5.4: Update Feature Descriptions in README

**File**: `packages/platform-cloudflare/README.md`
**Lines**: 127-152

**Verify descriptions match implementation**:

```markdown
### CloudflareRuntime

- `makeHandler` - Create reusable Workers fetch handler from a Layer providing HttpApi.Api (auto-builds httpApp)
  - **Note**: Follows HttpApiBuilder.toWebHandler pattern for type compatibility
  - Layer should provide HttpApi.Api and optionally HttpRouter.HttpRouter.DefaultServices
- `makeHttpHandler` - Create reusable Workers fetch handler from an explicit HttpApp and Layer
- `runMain` - Development mode entry point with signal handling
```

**Add note** about implementation pattern if not present.

### Step 5.5: Add Integration Example to README

**File**: `packages/platform-cloudflare/README.md`
**Add section before "Design Principles"** (around line 147):

```markdown
## Testing & Development

### Local Development with Wrangler

```bash
# Start local development server (uses workerd via Miniflare)
pnpm dev

# Test your endpoints
curl http://localhost:8787/your-endpoint
```

See `test/fixtures/example-worker/` for a complete working example.

### Configuration

Create a `wrangler.toml` in your project root:

```toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "development"
```

### Integration Testing

The package includes integration tests using real workerd runtime:
- Basic HTTP handling
- Environment variable access
- Background task execution (waitUntil)
- Hot reload during development

Run the example worker:
```bash
cd packages/platform-cloudflare
pnpm dev
```
```

### Step 5.6: Add Migration Notes if Needed

**File**: `packages/platform-cloudflare/README.md`
**Add section if users were using previous stub**:

```markdown
## Migration from Previous Versions

### From HttpApiBuilder.toWebHandler

If you were previously using `HttpApiBuilder.toWebHandler` with Cloudflare Workers,
you can now use `makeHandler` for better integration:

**Before**:
```typescript
import { HttpApiBuilder } from "@effect/platform"

const { handler } = HttpApiBuilder.toWebHandler(ApiLive)

// Manually merge ExecutionContext and Env
export default {
  fetch: (request, env, ctx) => {
    const context = Context.make(ExecutionContext, ctx)
      .pipe(Context.add(Env, env))
    return handler(request, context)
  }
}
```

**After**:
```typescript
import { makeHandler } from "@effect/platform-cloudflare/CloudflareRuntime"

const { handler } = makeHandler({ layer: ApiLive })

export default {
  fetch: handler  // Context merging handled automatically
}
```
```

**Only add if relevant** to user base.

### Step 5.7: Document Type Assertion Rationale

**File**: `packages/platform-cloudflare/src/internal/runtime.ts`
**Add comment above line 54**:

```typescript
  const build = Effect.flatMap(HttpApiBuilder.httpApp, (app) =>
    Effect.map(runtime.runtimeEffect, (rt) => {
      // Type assertion pattern matches HttpApiBuilder.toWebHandler:174
      // Middleware transforms HttpApp.Default<never, DefaultServices> to
      // HttpApp.Default<never, Api | Router | Middleware>, creating a union type
      // that TypeScript cannot unify in the conditional expression.
      // Using 'as any' is the established pattern in the Effect codebase for this scenario.
      const handler = HttpApp.toWebHandlerRuntime(rt)(
        options?.middleware ? options.middleware(app as any) as any : app
      )
      cachedHandler = handler
      return handler
    })
  )
```

### Step 5.8: Final Documentation Review

**Checklist**:
- [ ] README.md examples work with final implementation
- [ ] JSDoc comments accurate
- [ ] Code comments explain non-obvious patterns
- [ ] Integration example documented
- [ ] Type assertion rationale documented
- [ ] Migration guide (if applicable)

**Commands to verify**:
```bash
# Check all TypeScript compiles
pnpm -F @effect/platform-cloudflare check

# Run tests
pnpm -F @effect/platform-cloudflare test

# Start example worker
pnpm -F @effect/platform-cloudflare dev
```

**Success Criteria**: Documentation complete, accurate, helpful for users.

---

## Phase 6: Final Verification

**Goal**: End-to-end verification everything works.

### Step 6.1: Clean Build Test

```bash
# Clean all build artifacts
cd packages/platform-cloudflare
rm -rf build dist node_modules

# Reinstall and build
pnpm install
pnpm build

# Should build without errors
```

### Step 6.2: Full Test Suite

```bash
# Run all tests
pnpm test

# Check coverage
pnpm coverage

# Type check
pnpm check
```

**Expected**: All green, >80% coverage.

### Step 6.3: Integration Test Full Cycle

```bash
# Start wrangler dev
pnpm dev

# In another terminal, run all curl tests from Step 4.8
# Verify all responses correct
# Check logs for background tasks

# Stop wrangler (Ctrl+C)
```

### Step 6.4: Verify Example Worker Build

```bash
# Check that example worker types resolve
cd test/fixtures/example-worker
pnpm -F @effect/platform-cloudflare check

# Should compile without errors
```

### Step 6.5: Documentation Link Check

**Manually verify**:
- [ ] All code examples in README.md use correct imports
- [ ] All file paths in documentation exist
- [ ] All referenced functions exist and have correct signatures
- [ ] Example code would actually work if copied

### Step 6.6: Performance Baseline

**Test handler caching works**:

```bash
# Start wrangler dev
pnpm dev

# In another terminal, measure response times
time curl http://localhost:8787/  # First request (builds handler)
time curl http://localhost:8787/  # Second request (cached)
time curl http://localhost:8787/  # Third request (cached)
```

**Expected**: First request slower, subsequent requests fast and consistent.

### Step 6.7: Create Completion Checklist

**File**: `packages/platform-cloudflare/COMPLETION.md`

```markdown
# Implementation Completion Checklist

## ✅ Phase 1: Fix Compilation Errors
- [x] Updated layer type signature to include DefaultServices
- [x] Fixed middleware type assertions (matches toWebHandler:174)
- [x] Removed unused imports
- [x] Public API signatures match internal implementation
- [x] TypeScript compiles with zero errors/warnings

## ✅ Phase 2: Fix Test Suite Compilation
- [x] Fixed TestApiLive layer composition
- [x] Improved makeHttpHandler test mock
- [x] Tests compile without errors

## ✅ Phase 3: Complete Test Coverage
- [x] All existing tests pass
- [x] Error handling tests added
- [x] ExecutionContext integration tests added
- [x] Env bindings tests added
- [x] Handler caching verified
- [x] Coverage >80%

## ✅ Phase 4: Wrangler/Workerd Integration
- [x] wrangler.toml created
- [x] Example worker implemented
- [x] Worker runs in wrangler dev
- [x] All endpoints tested manually
- [x] Hot reload verified
- [x] Background tasks work
- [x] Integration results documented

## ✅ Phase 5: Documentation & Polish
- [x] JSDoc updated with implementation notes
- [x] Code comments explain non-obvious patterns
- [x] README examples verified
- [x] Integration testing section added
- [x] Type assertion rationale documented

## ✅ Phase 6: Final Verification
- [x] Clean build successful
- [x] Full test suite passes
- [x] Integration tests pass
- [x] Example worker compiles
- [x] Documentation links verified
- [x] Performance baseline established

## Next Steps (Future Work)
- [ ] Add KV binding support
- [ ] Add D1 binding support
- [ ] Add R2 binding support
- [ ] CI integration for wrangler tests
- [ ] Production deployment guide
- [ ] Performance benchmarks
```

**Success Criteria**: All checkboxes in phases 1-6 checked.

---

## Appendix: Troubleshooting Guide

### Issue: TypeScript Errors After Phase 1

**Symptom**: Still getting type errors after updating signatures.

**Debugging steps**:
1. Check exact error message: `pnpm check 2>&1 | grep "error TS"`
2. Verify HttpRouter imported in both files
3. Compare our signature with toWebHandler:152 line-by-line
4. Check tsconfig.json has exactOptionalPropertyTypes enabled
5. Try running `pnpm install` to refresh types

**Common causes**:
- Missing import
- Typo in type name
- Wrong type parameter order
- Cached type information

### Issue: Tests Fail at Runtime

**Symptom**: Tests compile but fail when running.

**Debugging steps**:
1. Check specific test failure message
2. Verify mock ExecutionContext has required methods
3. Check if layer provides all required services
4. Add console.logs to handler to see what's failing
5. Test with simpler API first

**Common causes**:
- Layer missing required service
- Mock objects incomplete
- Async timing issues
- Context not merged correctly

### Issue: Wrangler Dev Fails to Start

**Symptom**: `pnpm dev` errors or doesn't start.

**Debugging steps**:
1. Check wrangler version: `pnpm wrangler --version`
2. Verify wrangler.toml syntax
3. Check main file path exists
4. Try `pnpm wrangler dev --log-level debug`
5. Check Node version compatibility

**Common causes**:
- Wrong wrangler version
- Syntax error in wrangler.toml
- Missing main file
- Port 8787 already in use

### Issue: Handler Returns 500 Errors

**Symptom**: All requests return 500 Internal Server Error.

**Debugging steps**:
1. Check wrangler logs for stack traces
2. Add Effect.log calls in handlers
3. Verify layer composition
4. Check if HttpApi.Api service provided
5. Test with simplest possible handler

**Common causes**:
- Layer doesn't provide Api service
- Handler throws unhandled error
- Missing required dependency
- Context service not found

### Issue: Env Bindings Not Accessible

**Symptom**: Env vars undefined in handlers.

**Debugging steps**:
1. Check wrangler.toml vars section
2. Verify context merging in handler function
3. Add logging: `Effect.log(yield* Env)`
4. Check if ExecutionContext also failing
5. Verify using correct Env import

**Common causes**:
- wrangler.toml syntax error
- Context not merged
- Using wrong import
- Type mismatch in env access

---

## Success Metrics

### Compilation
- ✅ `pnpm check` exits 0
- ✅ No TS errors
- ✅ No TS warnings

### Tests
- ✅ All tests pass
- ✅ Coverage >80% on runtime.ts
- ✅ No flaky tests

### Integration
- ✅ `pnpm dev` starts successfully
- ✅ All example endpoints respond
- ✅ Env vars accessible
- ✅ Background tasks execute
- ✅ Hot reload works

### Documentation
- ✅ All examples work when copied
- ✅ Clear explanation of patterns
- ✅ Integration guide complete

### Performance
- ✅ First request builds handler
- ✅ Subsequent requests use cache
- ✅ No memory leaks
- ✅ Handler disposal works

---

## Estimated Timeline

- **Phase 1**: 30-60 minutes (type fixes straightforward)
- **Phase 2**: 15-30 minutes (test layer fixes)
- **Phase 3**: 1-2 hours (writing comprehensive tests)
- **Phase 4**: 1-2 hours (wrangler setup + testing)
- **Phase 5**: 30-60 minutes (documentation polish)
- **Phase 6**: 30 minutes (final verification)

**Total**: 4-6 hours for complete implementation and testing.

---

## Notes for Next Engineer

If you're picking this up after implementation:

1. **Start here**: Read cf-summary.md (previous engineer's notes) and this plan
2. **Reference code**: toWebHandler in HttpApiBuilder.ts is the pattern we're matching
3. **Key insight**: Cloudflare env/ctx are per-request, not per-worker. Context merging is critical.
4. **Type assertions**: We use `as any` to match established patterns. Not ideal but necessary.
5. **Testing strategy**: Unit tests verify logic, wrangler dev verifies real-world behavior
6. **Don't skip integration testing**: Unit tests passing ≠ works in workerd

Good luck! 🚀
