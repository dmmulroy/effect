import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { unstable_dev } from "wrangler"
import type { UnstableDevWorker } from "wrangler"

/**
 * Integration tests for Cloudflare Worker entrypoints
 * These tests run in a real Workers runtime using Wrangler's unstable_dev API
 *
 * Run with: pnpm test:integration
 */

let worker: UnstableDevWorker

beforeAll(async () => {
  worker = await unstable_dev("test/fixtures/entrypoints/combined-worker/index.ts", {
    config: "test/fixtures/entrypoints/combined-worker/wrangler.toml",
    experimental: { disableExperimentalWarning: true }
  })
}, 30000)

afterAll(async () => {
  await worker.stop()
})

describe("Fetch handler integration", () => {
  it("should handle real HTTP requests", async () => {
    const response = await worker.fetch("http://example.com/")

    // Debug: log the response if it's not 200
    if (response.status !== 200) {
      console.log("Error response:", await response.text())
    }

    expect(response.status).toBe(200)

    const data = (await response.json()) as Record<string, unknown>
    expect(data).toHaveProperty("message")
    expect(data).toHaveProperty("requestCount")
    expect(data).toHaveProperty("initTime")
  })

  it("should handle multiple routes", async () => {
    const response = await worker.fetch("http://example.com/api/test")
    expect(response.status).toBe(200)

    const data = (await response.json()) as Record<string, unknown>
    expect(data).toEqual(
      expect.objectContaining({
        status: "ok",
        count: expect.any(Number)
      })
    )
  })

  it("should return 404 for unknown routes", async () => {
    const response = await worker.fetch("http://example.com/nonexistent")
    expect(response.status).toBe(404)
  })

  it("should maintain shared runtime across requests", async () => {
    // First request
    const response1 = await worker.fetch("http://example.com/")
    const data1 = (await response1.json()) as Record<string, unknown>
    const initTime1 = data1.initTime

    // Second request - should have same initTime (shared runtime)
    const response2 = await worker.fetch("http://example.com/")
    const data2 = (await response2.json()) as Record<string, unknown>
    const initTime2 = data2.initTime

    expect(initTime1).toBe(initTime2)
    expect(data2.requestCount).toBeGreaterThan(data1.requestCount as number)
  })

  it("should handle concurrent requests", async () => {
    const requests = Array.from({ length: 10 }, () =>
      worker.fetch("http://example.com/api/test")
    )

    const responses = await Promise.all(requests)

    for (const response of responses) {
      expect(response.status).toBe(200)
      const data = (await response.json()) as Record<string, unknown>
      expect(data.status).toBe("ok")
    }
  })
})

describe("Scheduled handler integration", () => {
  it("should execute on schedule", async () => {
    const { default: scheduledWorker } = await import(
      "../fixtures/entrypoints/scheduled-worker/index.ts"
    )

    expect(scheduledWorker.scheduled).toBeDefined()

    const controller = {
      scheduledTime: Date.now(),
      cron: "0 0 * * *",
      noRetry: () => {}
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(
      scheduledWorker.scheduled(controller, {}, ctx)
    ).resolves.toBeUndefined()
  })

  it("should handle different cron patterns", async () => {
    const { default: scheduledWorker } = await import(
      "../fixtures/entrypoints/scheduled-worker/index.ts"
    )

    const patterns = ["*/5 * * * *", "0 12 * * *", "0 0 1 * *"]

    for (const cron of patterns) {
      const controller = {
        scheduledTime: Date.now(),
        cron,
        noRetry: () => {}
      }

      const ctx = {
        waitUntil: () => {},
        passThroughOnException: () => {}
      }

      await expect(
        scheduledWorker.scheduled(controller, {}, ctx)
      ).resolves.toBeUndefined()
    }
  })
})

describe("Queue handler integration", () => {
  it("should process queue messages", async () => {
    const { default: queueWorker } = await import(
      "../fixtures/entrypoints/queue-worker/index.ts"
    )

    expect(queueWorker.queue).toBeDefined()

    const messages = [
      {
        id: "msg-1",
        timestamp: new Date(),
        body: { orderId: "ORD-1", amount: 100, valid: true },
        ack: () => {},
        retry: () => {}
      },
      {
        id: "msg-2",
        timestamp: new Date(),
        body: { orderId: "ORD-2", amount: 200, valid: true },
        ack: () => {},
        retry: () => {}
      }
    ]

    const batch = {
      queue: "test-queue",
      messages,
      ackAll: () => {},
      retryAll: () => {}
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(queueWorker.queue(batch, {}, ctx)).resolves.toBeUndefined()
  })

  it("should handle message acknowledgment and retry", async () => {
    const { default: queueWorker } = await import(
      "../fixtures/entrypoints/queue-worker/index.ts"
    )

    let ackedCount = 0
    let retriedCount = 0

    const messages = [
      {
        id: "msg-valid",
        timestamp: new Date(),
        body: { orderId: "A", amount: 50, valid: true },
        ack: () => {
          ackedCount++
        },
        retry: () => {
          retriedCount++
        }
      },
      {
        id: "msg-invalid",
        timestamp: new Date(),
        body: { orderId: "B", amount: 75, valid: false },
        ack: () => {
          ackedCount++
        },
        retry: () => {
          retriedCount++
        }
      }
    ]

    const batch = {
      queue: "orders",
      messages,
      ackAll: () => {},
      retryAll: () => {}
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await queueWorker.queue(batch, {}, ctx)

    expect(ackedCount).toBe(1)
    expect(retriedCount).toBe(1)
  })

  it("should handle empty message batch", async () => {
    const { default: queueWorker } = await import(
      "../fixtures/entrypoints/queue-worker/index.ts"
    )

    const batch = {
      queue: "empty-queue",
      messages: [],
      ackAll: () => {},
      retryAll: () => {}
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(queueWorker.queue(batch, {}, ctx)).resolves.toBeUndefined()
  })
})

describe("Email handler integration", () => {
  it("should process email messages", async () => {
    const { default: emailWorker } = await import(
      "../fixtures/entrypoints/email-worker/index.ts"
    )

    expect(emailWorker.email).toBeDefined()

    const message = {
      from: "sender@example.com",
      to: "recipient@example.com",
      headers: new Headers({
        Subject: "Test Email"
      }),
      raw: new ReadableStream(),
      rawSize: 1024,
      forward: async () => {},
      setReject: () => {}
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(emailWorker.email(message, {}, ctx)).resolves.toBeUndefined()
  })

  it("should forward emails when admin email configured", async () => {
    const { default: emailWorker } = await import(
      "../fixtures/entrypoints/email-worker/index.ts"
    )

    let forwardedTo: string | undefined

    const message = {
      from: "user@example.com",
      to: "support@example.com",
      headers: new Headers(),
      raw: new ReadableStream(),
      rawSize: 512,
      forward: async (email: string) => {
        forwardedTo = email
      },
      setReject: () => {}
    }

    const envWithAdmin = {
      ADMIN_EMAIL: "admin@example.com"
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await emailWorker.email(message, envWithAdmin, ctx)

    expect(forwardedTo).toBe("admin@example.com")
  })
})

describe("Tail handler integration", () => {
  it("should process tail events", async () => {
    const { default: tailWorker } = await import(
      "../fixtures/entrypoints/tail-worker/index.ts"
    )

    expect(tailWorker.tail).toBeDefined()

    const events = [
      {
        event: null,
        eventTimestamp: Date.now(),
        logs: ["log1", "log2"],
        exceptions: [],
        scriptName: "test-worker-1"
      },
      {
        event: null,
        eventTimestamp: Date.now(),
        logs: ["log3"],
        exceptions: [{ name: "Error", message: "Test error" }],
        scriptName: "test-worker-2"
      }
    ]

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(tailWorker.tail(events, {}, ctx)).resolves.toBeUndefined()
  })

  it("should handle empty tail events", async () => {
    const { default: tailWorker } = await import(
      "../fixtures/entrypoints/tail-worker/index.ts"
    )

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(tailWorker.tail([], {}, ctx)).resolves.toBeUndefined()
  })
})

describe("Combined handlers integration", () => {
  it("should handle fetch requests", async () => {
    const response = await worker.fetch("http://example.com/")
    expect(response.status).toBe(200)

    const data = (await response.json()) as Record<string, unknown>
    expect(data.message).toBe("Combined worker")
  })

  it("should handle scheduled events", async () => {
    const { default: combinedWorker } = await import(
      "../fixtures/entrypoints/combined-worker/index.ts"
    )

    const controller = {
      scheduledTime: Date.now(),
      cron: "0 * * * *",
      noRetry: () => {}
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(
      combinedWorker.scheduled(controller, {}, ctx)
    ).resolves.toBeUndefined()
  })

  it("should handle queue messages", async () => {
    const { default: combinedWorker } = await import(
      "../fixtures/entrypoints/combined-worker/index.ts"
    )

    const batch = {
      queue: "notifications",
      messages: [
        {
          id: "msg-1",
          timestamp: new Date(),
          body: { type: "email", to: "user@example.com" },
          ack: () => {},
          retry: () => {}
        }
      ],
      ackAll: () => {},
      retryAll: () => {}
    }

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    }

    await expect(combinedWorker.queue(batch, {}, ctx)).resolves.toBeUndefined()
  })

  it("should share runtime across handlers", async () => {
    const response1 = await worker.fetch("http://example.com/")
    const data1 = (await response1.json()) as Record<string, unknown>
    const initTime = data1.initTime

    const response2 = await worker.fetch("http://example.com/")
    const data2 = (await response2.json()) as Record<string, unknown>

    expect(data2.initTime).toBe(initTime)
    expect(data2.requestCount).toBeGreaterThan(data1.requestCount as number)
  })
})

describe("Performance characteristics", () => {
  it("should handle high request volume", async () => {
    const requestCount = 50
    const promises = Array.from({ length: requestCount }, () =>
      worker.fetch("http://example.com/api/test")
    )

    const start = performance.now()
    const responses = await Promise.all(promises)
    const duration = performance.now() - start

    for (const response of responses) {
      // Log error if not 200
      if (response.status !== 200) {
        console.log(`Request failed with ${response.status}:`, await response.clone().text())
      }
      expect(response.status).toBe(200)
    }

    expect(duration).toBeLessThan(10000)
  })

  it("should have fast cached handler performance", async () => {
    await worker.fetch("http://example.com/")

    const iterations = 50
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      await worker.fetch("http://example.com/api/test")
    }

    const duration = performance.now() - start
    const avgTime = duration / iterations

    expect(avgTime).toBeLessThan(100)
  })
})
