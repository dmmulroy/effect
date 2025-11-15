/**
 * Mock utilities for Cloudflare Workers entrypoint testing
 */

/**
 * Creates a mock ExecutionContext for testing
 */
export function createMockExecutionContext(): ExecutionContext {
  const waitUntilPromises: Array<Promise<unknown>> = []

  return {
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilPromises.push(promise)
    },
    passThroughOnException: () => {},
    props: {}
  }
}

/**
 * Creates a mock ScheduledController for testing scheduled handlers
 */
export function createMockScheduledController(
  options: { cron?: string; scheduledTime?: number } = {}
): globalThis.ScheduledController {
  return {
    scheduledTime: options.scheduledTime ?? Date.now(),
    cron: options.cron ?? "0 0 * * *",
    noRetry: () => {}
  }
}

/**
 * Creates a mock MessageBatch for testing queue handlers
 */
export function createMockMessageBatch<T = unknown>(
  queueName: string,
  messages: Array<{ id?: string; timestamp?: Date; body: T }> = []
): globalThis.MessageBatch<T> {
  const ackedMessages = new Set<string>()
  const retriedMessages = new Set<string>()

  return {
    queue: queueName,
    messages: messages.map((msg, idx) => {
      const id = msg.id ?? `msg-${idx}`
      return {
        id,
        timestamp: msg.timestamp ?? new Date(),
        body: msg.body,
        ack: () => {
          ackedMessages.add(id)
        },
        retry: () => {
          retriedMessages.add(id)
        }
      }
    }),
    ackAll: () => {
      messages.forEach((_, idx) => ackedMessages.add(`msg-${idx}`))
    },
    retryAll: () => {
      messages.forEach((_, idx) => retriedMessages.add(`msg-${idx}`))
    }
  }
}

/**
 * Creates a mock ForwardableEmailMessage for testing email handlers
 */
export function createMockEmailMessage(
  options: {
    from?: string
    to?: string
    subject?: string
  } = {}
): globalThis.ForwardableEmailMessage {
  return {
    from: options.from ?? "sender@example.com",
    to: options.to ?? "recipient@example.com",
    headers: new Headers(),
    raw: new ReadableStream(),
    rawSize: 1024,
    forward: async (email: string) => {},
    setReject: (reason: string) => {}
  }
}

/**
 * Creates mock TailEvents for testing tail handlers
 */
export function createMockTailEvents(
  events: Array<Partial<globalThis.TailEvent>> = []
): ReadonlyArray<globalThis.TailEvent> {
  return events.map((event) => ({
    event: event.event ?? null,
    eventTimestamp: event.eventTimestamp ?? Date.now(),
    logs: event.logs ?? [],
    exceptions: event.exceptions ?? [],
    scriptName: event.scriptName ?? "test-worker"
  })) as ReadonlyArray<globalThis.TailEvent>
}
