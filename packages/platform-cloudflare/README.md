# @effect/platform-cloudflare

Platform-specific implementations for Cloudflare Workers.

## Installation

```bash
npm install @effect/platform-cloudflare effect
```

## Usage

### Production - HTTP Handler

```typescript
import { CloudflareRuntime } from "@effect/platform-cloudflare/CloudflareRuntime"
import { HttpApiBuilder } from "@effect/platform/HttpApiBuilder"
import { HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { Layer } from "effect"
import { OtelLayer } from './Otel'

const httpApp = HttpApiBuilder.make("api").pipe(
  HttpApiBuilder.handleEndpoint(
    HttpApiBuilder.get("hello"),
    () => HttpServerResponse.text("Hello, World!")
  )
)

const { handler } = CloudflareRuntime.makeHttpHandler({
  httpApp,
  layer: OtelLayer
})

export default {
  fetch: handler
}
```

### Development - Using Wrangler Proxy

```typescript
import { CloudflareRuntime } from "@effect/platform-cloudflare/CloudflareRuntime"
import { makePlatformProxy } from "@effect/platform-cloudflare/CloudflareWrangler"
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const { env, ctx } = yield* makePlatformProxy({
    configPath: "./wrangler.toml",
    persist: true
  })

  // Your application logic here
  console.log("Environment:", env)
})

CloudflareRuntime.runMain((program))
```

### Using Context Services

```typescript
import { ExecutionContext, Env, scheduleCleanup } from "@effect/platform-cloudflare/CloudflareContext"
import { Effect } from "effect"

const cleanup = Effect.gen(function*() {
  yield* Effect.log("Cleaning up...")
  yield* Effect.sleep("5 seconds")
  yield* Effect.log("Cleanup complete")
})

const program = Effect.gen(function*() {
  const ctx = yield* ExecutionContext
  const env = yield* Env

  // Schedule background work
  yield* scheduleCleanup(cleanup)

  return Response.json({ message: "Started cleanup" })
})
```

### Using makeHandler with HttpApi

```typescript
import { CloudflareRuntime } from "@effect/platform-cloudflare/CloudflareRuntime"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"

// Define API
class UsersGroup extends HttpApiGroup.make("users")
  .add(
    HttpApiEndpoint.get("getUser", "/:id").addSuccess(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String
      })
    )
  )
{}

class MyApi extends HttpApi.make("api").add(UsersGroup) {}

// Implement handlers
const UsersLive = HttpApiBuilder.group(MyApi, "users", (handlers) =>
  handlers.handle("getUser", ({ path }) =>
    Effect.succeed({
      id: path.id,
      name: "John Doe"
    })
  )
)

// Create layer and handler
const ApiLive = Layer.mergeAll(
  HttpApiBuilder.api(MyApi),
  UsersLive
)

const { handler } = CloudflareRuntime.makeHandler({ layer: ApiLive })

export default {
  fetch: handler
}
```

## Features

### CloudflareRuntime

- `makeHandler` - Create reusable Workers fetch handler from a Layer providing HttpApi.Api (auto-builds httpApp)
  - Follows `HttpApiBuilder.toWebHandler` pattern for type compatibility
  - Layer should provide `HttpApi.Api` and handlers
- `makeHttpHandler` - Create reusable Workers fetch handler from an explicit HttpApp and Layer
- `runMain` - Development mode entry point with signal handling

### CloudflareContext

- `ExecutionContext` - Tag for Cloudflare Workers ExecutionContext
- `Env` - Tag for Cloudflare Workers environment bindings
- `withExecutionContext` - Provide ExecutionContext to an effect
- `withEnv` - Provide Env to an effect
- `scheduleCleanup` - Schedule background work using waitUntil

### CloudflareWrangler

- `makePlatformProxy` - Create scoped Wrangler development proxy

## Design Principles

1. **Single Runtime Pattern**: Create one `ManagedRuntime` per Worker instance, reuse across all requests
2. **Request-Scoped Context**: `ExecutionContext` and `Env` are merged per-request via `Effect.locally`
3. **No Per-Request Disposal**: Runtime cleanup only happens on Worker shutdown
4. **Signal Safety**: Wrangler's SIGINT/SIGTERM handlers are patched to allow Effect cleanup

## Example: Complete Worker

```typescript
import { makeHttpHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
import { ExecutionContext, Env } from "@effect/platform-cloudflare/CloudflareContext"
import { HttpApiBuilder } from "@effect/platform/HttpApiBuilder"
import { HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { Effect, Layer } from "effect"

// Define your services
class MyService extends Effect.Tag("MyService")<MyService, {
  readonly hello: (name: string) => Effect.Effect<string>
}>() {
  static Live = Layer.succeed(this, {
    hello: (name) => Effect.succeed(`Hello, ${name}!`)
  })
}

// Build HTTP API
const httpApp = HttpApiBuilder.make("api").pipe(
  HttpApiBuilder.handleEndpoint(
    HttpApiBuilder.get("hello/:name"),
    ({ params }) => Effect.gen(function*() {
      const service = yield* MyService
      const env = yield* Env
      const message = yield* service.hello(params.name)

      return HttpServerResponse.json({
        message,
        environment: env
      })
    })
  )
)

// Create handler
const { handler } = makeHttpHandler({
  httpApp,
  layer: MyService.Live
})

// Export Workers handler
export default {
  fetch: handler
}
```

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
compatibility_date = "2025-11-14"

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

See `test/fixtures/INTEGRATION.md` for detailed test results.

## License

MIT
