export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export const THEME_STORAGE_KEY = 'fantasy-reel:theme:v1'
export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const theme = preference === 'system'
    ? (window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light')
    : preference
  const root = document.documentElement
  root.dataset.themePreference = preference
  root.dataset.theme = theme
  root.style.colorScheme = theme
  return theme
}

// Run in <head> before the page paints. Storage may be unavailable even when
// JavaScript works, so keep the system fallback outside the storage try/catch.
export const THEME_INIT_SCRIPT = `(() => {
  let preference = 'system';
  try {
    const stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (stored === 'light' || stored === 'dark') preference = stored;
  } catch {}
  const theme = preference === 'system'
    ? (window.matchMedia('${SYSTEM_THEME_QUERY}').matches ? 'dark' : 'light')
    : preference;
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
})();`
