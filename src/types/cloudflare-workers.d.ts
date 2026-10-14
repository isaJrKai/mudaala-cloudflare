declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState
    protected env: Env
    constructor(ctx: DurableObjectState, env: Env)
  }
}

interface DurableObjectState {
  storage: {
    sql: {
      exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): {
        one(): T
      }
    }
    getAlarm(): Promise<number | null>
    setAlarm(scheduledTime: number): Promise<void>
  }
}

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): unknown
  get(id: unknown): T
}
