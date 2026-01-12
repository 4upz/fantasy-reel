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

export const StarIcon = createFillableIcon(Star, 'w-4 h-4', true)
export const HeartIcon = createFillableIcon(Heart, 'w-4 h-4', false)

export function SpinnerIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <div
      className={`border-2 border-current border-t-transparent rounded-full animate-spin ${className}`}
    />
  )
}
