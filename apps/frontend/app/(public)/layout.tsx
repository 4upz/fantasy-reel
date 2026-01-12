interface Props {
  children: React.ReactNode
}

export default function PublicLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      {children}
    </div>
  )
}
