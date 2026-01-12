import Link from 'next/link'

export default function NavLogo(): React.ReactElement {
  return (
    <Link
      href="/dashboard"
      className="nav-logo group flex items-center gap-2 transition-all duration-300"
    >
      {/* Film reel icon */}
      <div className="relative w-8 h-8 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-gold group-hover:border-gold-hover transition-colors" />
        <div className="absolute inset-1.5 rounded-full border border-gold/40" />
        <div className="w-2 h-2 rounded-full bg-gold group-hover:bg-gold-hover transition-colors" />
        <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gold/60" />
        <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gold/60" />
        <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-gold/60" />
        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-gold/60" />
      </div>

      <span className="font-display font-bold text-lg tracking-tight text-gold group-hover:text-gold-hover transition-colors">
        Fantasy
        <span className="font-light ml-0.5">Reel</span>
      </span>
    </Link>
  )
}
