import { useState, useEffect } from 'react'

interface UseScrollPositionOptions {
  threshold?: number
}

export function useScrollPosition({
  threshold = 200,
}: UseScrollPositionOptions = {}): boolean {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > threshold)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [threshold])

  return isScrolled
}
