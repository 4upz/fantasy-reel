import type { LucideIcon } from 'lucide-react'
import {
  Search,
  ChevronDown,
  X,
  Check,
  Star,
  Heart,
  Calendar,
  Clock,
  ExternalLink,
  User,
  ArrowRight,
  ArrowUp,
  Clapperboard,
  TrendingUp,
  Plus,
  Eye,
} from 'lucide-react'

interface IconProps {
  className?: string
}

interface FillableIconProps extends IconProps {
  filled?: boolean
}

function createIcon(Icon: LucideIcon, defaultClass: string) {
  return function IconComponent({ className = defaultClass }: IconProps) {
    return <Icon className={className} />
  }
}

function createFillableIcon(Icon: LucideIcon, defaultClass: string, defaultFilled: boolean) {
  return function IconComponent({ className = defaultClass, filled = defaultFilled }: FillableIconProps) {
    return <Icon className={className} fill={filled ? 'currentColor' : 'none'} />
  }
}

export const SearchIcon = createIcon(Search, 'w-5 h-5')
export const ChevronDownIcon = createIcon(ChevronDown, 'w-4 h-4')
export const CloseIcon = createIcon(X, 'w-5 h-5')
export const CheckIcon = createIcon(Check, 'w-4 h-4')
export const CalendarIcon = createIcon(Calendar, 'w-4 h-4')
export const ClockIcon = createIcon(Clock, 'w-4 h-4')
export const ExternalLinkIcon = createIcon(ExternalLink, 'w-4 h-4')
export const UserIcon = createIcon(User, 'w-6 h-6')
export const ArrowRightIcon = createIcon(ArrowRight, 'w-4 h-4')
export const ArrowUpIcon = createIcon(ArrowUp, 'w-4 h-4')
export const ClapperboardIcon = createIcon(Clapperboard, 'w-6 h-6')
export const TrendingUpIcon = createIcon(TrendingUp, 'w-4 h-4')
export const PlusIcon = createIcon(Plus, 'w-4 h-4')
export const EyeIcon = createIcon(Eye, 'w-4 h-4')

export const StarIcon = createFillableIcon(Star, 'w-4 h-4', true)
export const HeartIcon = createFillableIcon(Heart, 'w-4 h-4', false)

export function SpinnerIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <div
      className={`border-2 border-current border-t-transparent rounded-full animate-spin ${className}`}
    />
  )
}

interface ButtonSpinnerProps {
  variant?: 'primary' | 'danger'
}

/**
 * Spinner for use inside buttons with appropriate color for the button variant
 */
export function ButtonSpinner({ variant = 'primary' }: ButtonSpinnerProps): React.ReactElement {
  const colorClass = variant === 'danger'
    ? 'border-white/30 border-t-white'
    : 'border-foreground-inverse/30 border-t-foreground-inverse'

  return (
    <span className={`w-4 h-4 border-2 ${colorClass} rounded-full animate-spin mr-2`} />
  )
}
