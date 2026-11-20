/**
 * Minimal ambient Cloudflare Workers globals for the intelligence gateway.
 *
 * The gateway is excluded from the root tsconfig (ADR-0002 §6) because worker
 * runtime types differ from the DOM/Next types of the app. To avoid adding a
 * dependency to package.json for one small service, only the subset of
 * worker types the gateway uses is declared here. If the gateway grows, swap
 * to `@cloudflare/workers-types` as a devDependency of its own workspace.
 */

interface DurableObjectState {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<boolean>
    list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>
  }
  waitUntil(promise: Promise<unknown>): void
}

interface DurableObjectNamespace {
  newUniqueId(): DurableObjectId
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

interface Env {
  INTELLIGENCE_LIMITER: DurableObjectNamespace
  INTELLIGENCE_CALLERS?: string
  INTELLIGENCE_GATEWAY_DISABLED?: string
  GATEWAY_VERSION?: string
}
