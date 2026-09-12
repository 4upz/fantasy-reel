'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  applyThemePreference,
  parseThemePreference,
  SYSTEM_THEME_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/utils/theme'

interface ThemeContextValue {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  ready: boolean
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setThemePreference] = useState<ThemePreference>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')
  const [ready, setReady] = useState(false)
  const preferenceRef = useRef<ThemePreference>('system')

  const applyPreference = useCallback((next: ThemePreference) => {
    const resolved = applyThemePreference(next)
    preferenceRef.current = next
    setThemePreference(next)
    setResolvedTheme(resolved)
  }, [])

  useEffect(() => {
    // Reuse the preference applied before paint without reading storage again.
    applyPreference(parseThemePreference(document.documentElement.dataset.themePreference))
    setReady(true)

    const media = window.matchMedia(SYSTEM_THEME_QUERY)
    const onSystemChange = () => {
      if (preferenceRef.current === 'system') applyPreference('system')
    }
    const onStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        applyPreference(parseThemePreference(event.newValue))
      }
    }
    media.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorageChange)
    return () => {
      media.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorageChange)
    }
  }, [applyPreference])

  const setPreference = useCallback((next: ThemePreference) => {
    applyPreference(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // The control still works for this visit when storage is blocked/full.
    }
  }, [applyPreference])

  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, ready, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
