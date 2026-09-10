import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fantasy Reel',
    short_name: 'Fantasy Reel',
    description: 'Draft upcoming movies and compete with your friends.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0f0f0f',
    theme_color: '#1c1c1c',
    icons: [
      { src: '/brand/v1/app-charcoal-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/v1/app-charcoal-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/v1/maskable-charcoal-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
