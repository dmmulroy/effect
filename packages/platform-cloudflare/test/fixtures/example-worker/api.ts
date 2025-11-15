import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

// Hello endpoint group
export class HelloGroup extends HttpApiGroup.make("hello")
  .add(
    HttpApiEndpoint.get("greet")`/hello/${HttpApiSchema.param("name", Schema.String)}`.addSuccess(
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

// Env test endpoint group
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

// Background work endpoint group
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
