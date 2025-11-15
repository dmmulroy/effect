import { mergeConfig, type ViteUserConfig } from "vitest/config"
import shared from "../../vitest.shared.js"

const config: ViteUserConfig = {
  test: {
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "**/integration.test.ts"
    ]
  }
}

export default mergeConfig(shared, config)
