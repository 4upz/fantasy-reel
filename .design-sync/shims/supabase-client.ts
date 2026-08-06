// Host shim for `@/utils/supabase/client`. Returns an inert client whose
// query builders resolve empty rather than reaching for env vars that do not
// exist in the design renderer. Keeps module import side-effect free.
type Result = { data: null; error: null }

function thenable(): Promise<Result> & Record<string, unknown> {
  const result: Result = { data: null, error: null }
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: Result) => unknown) => Promise.resolve(result).then(res)
        if (prop === 'catch' || prop === 'finally') return () => chain
        return () => chain
      },
    }
  )
  return chain as Promise<Result> & Record<string, unknown>
}

export function createClient() {
  return {
    from: () => thenable(),
    rpc: () => thenable(),
    channel: () => ({
      on: function (this: unknown) {
        return this
      },
      subscribe: () => ({ unsubscribe: () => {} }),
    }),
    removeChannel: () => {},
    storage: { from: () => thenable() },
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
  }
}
