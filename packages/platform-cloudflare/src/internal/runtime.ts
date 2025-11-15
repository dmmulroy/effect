/**
 * @since 1.0.0
 */
import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApp from "@effect/platform/HttpApp";
import { makeRunMain } from "@effect/platform/Runtime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as internalContext from "./context.js";
import * as internalWrangler from "./wrangler.js";

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export function makeFetchHandler<LA, LE, LR>(options: {
  readonly layer: Layer.Layer<LA | HttpApi.Api, LE, LR>;
  readonly memoMap?: Layer.MemoMap;
  readonly middleware?: (
    httpApp: HttpApp.Default,
  ) => HttpApp.Default<
    never,
    HttpApi.Api | HttpApiBuilder.Router | HttpApiBuilder.Middleware
  >;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export function makeFetchHandler<R, E>(options: {
  readonly httpApp: HttpApp.Default<E, R>;
  readonly layer: Layer.Layer<R, E>;
  readonly memoMap?: Layer.MemoMap;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export function makeFetchHandler<LA, LE, LR, R, E>(
  options:
    | {
        readonly layer: Layer.Layer<LA | HttpApi.Api, LE, LR>;
        readonly memoMap?: Layer.MemoMap;
        readonly middleware?: (
          httpApp: HttpApp.Default,
        ) => HttpApp.Default<
          never,
          HttpApi.Api | HttpApiBuilder.Router | HttpApiBuilder.Middleware
        >;
      }
    | {
        readonly httpApp: HttpApp.Default<E, R>;
        readonly layer: Layer.Layer<R, E>;
        readonly memoMap?: Layer.MemoMap;
      },
): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} {
  if ("httpApp" in options) {
    // This is the HttpApp variant
    return makeFetchHandlerFromHttpApp(options);
  } else {
    // This is the HttpApi.Api variant
    return makeFetchHandlerFromApi(options);
  }
}

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
const makeFetchHandlerFromApi = <LA, LE, LR>(options: {
  readonly layer: Layer.Layer<LA | HttpApi.Api, LE, LR>;
  readonly memoMap?: Layer.MemoMap;
  readonly middleware?: (
    httpApp: HttpApp.Default,
  ) => HttpApp.Default<
    never,
    HttpApi.Api | HttpApiBuilder.Router | HttpApiBuilder.Middleware
  >;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} => {
  // LR (layer requirements) are provided per-request via requestContext, not by the layer itself.
  // Type assertion needed because TypeScript can't verify this runtime pattern.
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      options.layer,
      HttpApiBuilder.Router.Live,
      HttpApiBuilder.Middleware.layer,
    ) as Layer.Layer<
      LA | HttpApi.Api | HttpApiBuilder.Router | HttpApiBuilder.Middleware,
      LE,
      never
    >,
    options.memoMap,
  );

  let cachedHandler:
    | ((
        request: Request,
        context?: Context.Context<never>,
      ) => Promise<Response>)
    | undefined;

  const build = Effect.flatMap(HttpApiBuilder.httpApp, (app) =>
    Effect.map(runtime.runtimeEffect, (rt) => {
      // Type assertion pattern matches HttpApiBuilder.toWebHandler:174
      // Middleware transforms HttpApp.Default<never, DefaultServices> to
      // HttpApp.Default<never, Api | Router | Middleware>, creating a union type
      // that TypeScript cannot unify in the conditional expression.
      // Using 'as any' is the established pattern in the Effect codebase for this scenario.
      const handler = HttpApp.toWebHandlerRuntime(rt)(
        options?.middleware ? (options.middleware(app as any) as any) : app,
      )
      cachedHandler = handler;
      return handler;
    }),
  );

  const handlerPromise = runtime.runPromise(build);

  const handler = <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> => {
    // Cloudflare Workers provides env and ctx per-request, not at worker initialization.
    // We merge them into the Effect context for each request using Context.make/add.
    // This allows handlers to access ExecutionContext and Env via Effect tags.
    const requestContext = Context.make(
      internalContext.ExecutionContext,
      internalContext.makeExecutionContext(ctx),
    ).pipe(Context.add(internalContext.Env, env));

    // Use cached handler if available (after first request completes)
    if (cachedHandler !== undefined) {
      return cachedHandler(request, requestContext);
    }

    // First request: wait for handler to build, then use it
    return handlerPromise.then((handler) => handler(request, requestContext));
  };

  return {
    handler,
    dispose: runtime.dispose,
  };
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
const makeFetchHandlerFromHttpApp = <R, E>(options: {
  readonly httpApp: HttpApp.Default<E, R>;
  readonly layer: Layer.Layer<R, E>;
  readonly memoMap?: Layer.MemoMap;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} => {
  const runtime = ManagedRuntime.make(options.layer, options.memoMap);

  let cachedHandler:
    | ((
        request: Request,
        context?: Context.Context<never>,
      ) => Promise<Response>)
    | undefined;

  const build = Effect.map(runtime.runtimeEffect, (rt) => {
    const handler = HttpApp.toWebHandlerRuntime(rt)(options.httpApp);
    cachedHandler = handler;
    return handler;
  });

  const handlerPromise = runtime.runPromise(build);

  const handler = <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> => {
    // Cloudflare Workers provides env and ctx per-request, not at worker initialization.
    // We merge them into the Effect context for each request using Context.make/add.
    // This allows handlers to access ExecutionContext and Env via Effect tags.
    const requestContext = Context.make(
      internalContext.ExecutionContext,
      internalContext.makeExecutionContext(ctx),
    ).pipe(Context.add(internalContext.Env, env));

    // Use cached handler if available (after first request completes)
    if (cachedHandler !== undefined) {
      return cachedHandler(request, requestContext);
    }

    // First request: wait for handler to build, then use it
    return handlerPromise.then((handler) => handler(request, requestContext));
  };

  return {
    handler,
    dispose: runtime.dispose,
  };
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export const makeScheduledHandler = <R, E>(options: {
  readonly handler: Effect.Effect<void, E, R>;
  readonly layer: Layer.Layer<R, E>;
  readonly memoMap?: Layer.MemoMap;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    controller: globalThis.ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
} => {
  const runtime = ManagedRuntime.make(options.layer, options.memoMap);

  const handler = <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    controller: globalThis.ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> => {
    const requestContext = Context.make(
      internalContext.ScheduledController,
      internalContext.makeScheduledController(controller),
    )
      .pipe(Context.add(internalContext.ExecutionContext, internalContext.makeExecutionContext(ctx)))
      .pipe(Context.add(internalContext.Env, env));

    return runtime.runPromise(
      Effect.provide(
        Effect.die("Scheduled handler not implemented yet"),
        requestContext,
      ),
    );
  };

  return {
    handler,
    dispose: runtime.dispose,
  };
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export const makeQueueHandler = <R, E, Body = unknown>(options: {
  readonly handler: Effect.Effect<void, E, R>;
  readonly layer: Layer.Layer<R, E>;
  readonly memoMap?: Layer.MemoMap;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    batch: globalThis.MessageBatch<Body>,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
} => {
  const runtime = ManagedRuntime.make(options.layer, options.memoMap);

  const handler = <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    batch: globalThis.MessageBatch<Body>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> => {
    const requestContext = Context.make(
      internalContext.MessageBatch,
      internalContext.makeMessageBatch(batch),
    )
      .pipe(Context.add(internalContext.ExecutionContext, internalContext.makeExecutionContext(ctx)))
      .pipe(Context.add(internalContext.Env, env));

    return runtime.runPromise(
      Effect.provide(
        Effect.die("Queue handler not implemented yet"),
        requestContext,
      ),
    );
  };

  return {
    handler,
    dispose: runtime.dispose,
  };
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export const makeEmailHandler = <R, E>(options: {
  readonly handler: Effect.Effect<void, E, R>;
  readonly layer: Layer.Layer<R, E>;
  readonly memoMap?: Layer.MemoMap;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    message: globalThis.ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
} => {
  const runtime = ManagedRuntime.make(options.layer, options.memoMap);

  const handler = <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    message: globalThis.ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> => {
    const requestContext = Context.make(
      internalContext.ForwardableEmailMessage,
      internalContext.makeForwardableEmailMessage(message),
    )
      .pipe(Context.add(internalContext.ExecutionContext, internalContext.makeExecutionContext(ctx)))
      .pipe(Context.add(internalContext.Env, env));

    return runtime.runPromise(
      Effect.provide(
        Effect.die("Email handler not implemented yet"),
        requestContext,
      ),
    );
  };

  return {
    handler,
    dispose: runtime.dispose,
  };
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export const makeTailHandler = <R, E>(options: {
  readonly handler: Effect.Effect<void, E, R>;
  readonly layer: Layer.Layer<R, E>;
  readonly memoMap?: Layer.MemoMap;
}): {
  readonly handler: <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    events: ReadonlyArray<globalThis.TailEvent>,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
} => {
  const runtime = ManagedRuntime.make(options.layer, options.memoMap);

  const handler = <
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(
    events: ReadonlyArray<globalThis.TailEvent>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> => {
    const requestContext = Context.make(
      internalContext.TailEvents,
      internalContext.makeTailEvents(events),
    )
      .pipe(Context.add(internalContext.ExecutionContext, internalContext.makeExecutionContext(ctx)))
      .pipe(Context.add(internalContext.Env, env));

    return runtime.runPromise(
      Effect.provide(
        Effect.die("Tail handler not implemented yet"),
        requestContext,
      ),
    );
  };

  return {
    handler,
    dispose: runtime.dispose,
  };
};

/**
 * @since 1.0.0
 * @category runtime
 * @internal
 */
export const runMain = makeRunMain(({ fiber, teardown }) => {
  internalWrangler.applySignalPatch();

  fiber.addObserver((exit) => {
    teardown(exit, (code) => {
      process.exit(code);
    });
  });
});
