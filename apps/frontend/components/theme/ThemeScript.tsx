import { THEME_INIT_SCRIPT } from '@/utils/theme'

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
}
