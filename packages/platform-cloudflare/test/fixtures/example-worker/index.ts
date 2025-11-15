import { makeFetchHandler } from "@effect/platform-cloudflare/CloudflareRuntime"
import { ApiLive } from "./handlers.js"

// Create handler (runtime created once, reused across requests)
const { handler } = makeFetchHandler({
  layer: ApiLive
})

// Export Cloudflare Workers fetch handler
export default {
  fetch: handler
}
