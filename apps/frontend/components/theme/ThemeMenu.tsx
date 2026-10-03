import { SunMoon } from 'lucide-react'
import ThemeSelector from './ThemeSelector'
import styles from './ThemeMenu.module.css'

interface Props {
  /** Popover id; must be unique on the page. */
  id?: string
  className?: string
}

/**
 * The compact theme control: a sun/moon icon button that opens the shared
 * segmented ThemeSelector in a native popover (light dismiss, Escape, and
 * focus return come from the platform). Use this wherever a page needs a
 * standalone theme switch; menus that already have a panel (ProfileMenu,
 * the mobile marketing menu) embed ThemeSelector directly.
 */
export default function ThemeMenu({ id = 'theme-menu', className = '' }: Props): React.ReactElement {
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className={`btn btn-ghost min-h-11 min-w-11 px-2 ${styles.trigger} ${className}`}
        aria-label="Change theme"
        title="Change theme"
        data-testid="theme-menu-button"
      >
        <SunMoon size={20} aria-hidden="true" />
      </button>
      <div id={id} popover="auto" className={styles.panel} data-testid="theme-menu">
        <ThemeSelector />
      </div>
    </>
  )
}
