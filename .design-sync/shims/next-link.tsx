// Host shim for `next/link`. The real module needs Next's AppRouterContext,
// which does not exist in the design renderer. Renders the same <a> element
// Next ultimately renders, so styling and layout are identical.
import React from 'react'

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string }
  prefetch?: boolean
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  locale?: string | false
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, shallow: _sh, locale: _l, children, ...rest },
  ref
) {
  const url = typeof href === 'string' ? href : (href?.pathname ?? '#')
  return (
    <a ref={ref} href={url} {...rest}>
      {children}
    </a>
  )
})

export default Link
