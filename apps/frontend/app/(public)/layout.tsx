import ThemeSelector from '@/components/theme/ThemeSelector'

interface Props {
  children: React.ReactNode
}

export default function PublicLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex justify-end px-4 pt-4 sm:px-6">
        <ThemeSelector compact />
      </div>
      <div className="flex flex-1 items-center justify-center">
        {children}
      </div>
    </div>
  )
}
