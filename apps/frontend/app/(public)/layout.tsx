import ThemeMenu from '@/components/theme/ThemeMenu'
import LegalLinks from '../components/LegalLinks'

interface Props {
  children: React.ReactNode
}

export default function PublicLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex justify-end px-4 pt-4 sm:px-6">
        <ThemeMenu />
      </header>
      <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center">
        {children}
      </main>
      {/* Sign-up collects personal information, so the policy stays one tap away. */}
      <footer className="flex justify-center px-4 py-6">
        <LegalLinks />
      </footer>
    </div>
  )
}
