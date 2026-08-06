// Host shim for `next/image`. The real module depends on Next's image
// optimizer endpoint and build-time config. Renders a plain <img> with the
// same intrinsic sizing props so cards lay out exactly as in the app.
import React from 'react'

type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'> & {
  src: string | { src: string }
  alt: string
  width?: number | string
  height?: number | string
  fill?: boolean
  priority?: boolean
  quality?: number
  sizes?: string
  placeholder?: string
  blurDataURL?: string
  unoptimized?: boolean
  loader?: unknown
}

const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    alt,
    width,
    height,
    fill,
    priority: _p,
    quality: _q,
    placeholder: _ph,
    blurDataURL: _b,
    unoptimized: _u,
    loader: _lo,
    style,
    ...rest
  },
  ref
) {
  const url = typeof src === 'string' ? src : (src?.src ?? '')
  // `fill` is absolute-positioned cover in Next; reproduce that contract so
  // parents with `relative` size their children identically.
  const fillStyle: React.CSSProperties = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
    : {}
  return (
    <img
      ref={ref}
      src={url}
      alt={alt}
      width={fill ? undefined : (width as number | undefined)}
      height={fill ? undefined : (height as number | undefined)}
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  )
})

export default Image
