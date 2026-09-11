import Link from 'next/link'
import BrandLogo from '../BrandLogo'

interface NavLogoProps {
  href?: string
}

/** @design-system Identity & brand */
export default function NavLogo({ href = '/dashboard' }: NavLogoProps): React.ReactElement {
  return (
    <Link href={href} className="nav-logo inline-flex shrink-0 items-center rounded-sm">
      <BrandLogo />
    </Link>
  )
}
