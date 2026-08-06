// Host shim for `next/navigation`. Navigation is a no-op in the design
// renderer — there is no route tree to push onto.
export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  }
}

export function usePathname(): string {
  return '/'
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams()
}

export function useParams(): Record<string, string> {
  return {}
}

export function redirect(_url: string): never {
  throw new Error('redirect() is not available in the design renderer')
}

export function notFound(): never {
  throw new Error('notFound() is not available in the design renderer')
}
