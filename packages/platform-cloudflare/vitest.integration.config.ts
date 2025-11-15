import { mergeConfig, type ViteUserConfig } from "vitest/config"
import shared from "../../vitest.shared.js"

/**
 * Integration test configuration for Cloudflare Workers runtime
 *
 * Uses Wrangler's unstable_dev API to run workers in a real runtime
 * This approach works with any vitest version (no vitest-pool-workers dependency)
 */
const config: ViteUserConfig = {
  test: {
    include: ["test/entrypoints/integration.test.ts"],
    environment: "node",
    testTimeout: 30000
  }
}

export default mergeConfig(shared, config)
