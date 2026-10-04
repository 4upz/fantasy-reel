import type { SupabaseClient } from '@supabase/supabase-js'

export type AvatarBucket = 'avatars' | 'team-avatars'

/** Image types the file picker accepts. Every upload is re-encoded anyway. */
export const AVATAR_INPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Largest original we will decode. The stored image is far smaller. */
export const MAX_AVATAR_INPUT_BYTES = 10 * 1024 * 1024 // 10MB

const AVATAR_SIZE = 512
const AVATAR_QUALITY = 0.85
/** Fills transparent areas when the browser can only encode JPEG. */
const JPEG_BACKGROUND = '#1c1c1c'

/**
 * Each owner holds one object, at this name inside their folder. The storage
 * policies only accept writes to `<folder>/avatar`, so re-uploading replaces
 * the file instead of adding another (see
 * supabase/migrations/20261003152100_single_avatar_object_per_owner.sql).
 */
const AVATAR_OBJECT_NAME = 'avatar'

async function decodeImage(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    // Applies the EXIF orientation before the metadata is thrown away.
    return createImageBitmap(file, { imageOrientation: 'from-image' })
  }

  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, AVATAR_QUALITY))
}

/**
 * Re-draws the image onto a canvas, centre-cropped to a square of at most
 * 512px, and exports it as WebP (JPEG where the browser can't encode WebP).
 *
 * The canvas holds pixels only, so the export carries none of the original's
 * EXIF/XMP metadata: no GPS position, camera model or capture time. Animated
 * GIFs keep their first frame.
 */
export async function prepareAvatarImage(file: Blob): Promise<Blob> {
  const image = await decodeImage(file)
  const side = Math.min(image.width, image.height)
  if (!side) throw new Error('Image has no pixels')

  const size = Math.min(side, AVATAR_SIZE)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')

  const sx = (image.width - side) / 2
  const sy = (image.height - side) / 2
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size)
  if ('close' in image && typeof image.close === 'function') image.close()

  // Browsers that can't encode WebP silently return PNG instead.
  const webp = await canvasToBlob(canvas, 'image/webp')
  if (webp?.type === 'image/webp') return webp

  context.globalCompositeOperation = 'destination-over'
  context.fillStyle = JPEG_BACKGROUND
  context.fillRect(0, 0, size, size)
  const jpeg = await canvasToBlob(canvas, 'image/jpeg')
  if (!jpeg) throw new Error('Could not encode image')
  return jpeg
}

/**
 * Uploads a prepared avatar to the owner's single object and returns its
 * public URL. The `v` query parameter changes on every upload so browsers and
 * the CDN don't keep serving the image it replaced.
 */
export async function uploadAvatar(
  supabase: SupabaseClient,
  bucket: AvatarBucket,
  folder: string,
  image: Blob,
): Promise<string> {
  const path = `${folder}/${AVATAR_OBJECT_NAME}`
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, image, { contentType: image.type, upsert: true })
  if (error) throw error

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path)
  return `${publicUrl}?v=${Date.now()}`
}

/**
 * Deletes the owner's stored files, optionally keeping the current avatar
 * object. This also clears files left by older uploads, which used a new
 * timestamped name each time.
 *
 * Only the owner's own folder is touched. A team avatar carried over from a
 * previous season points into that season's team folder, and stays there.
 * Best effort: a failure leaves files behind but never fails the caller.
 */
export async function removeAvatarFiles(
  supabase: SupabaseClient,
  bucket: AvatarBucket,
  folder: string,
  { keepCurrent }: { keepCurrent: boolean },
): Promise<void> {
  const { data: files, error } = await supabase.storage.from(bucket).list(folder, { limit: 100 })
  if (error || !files) {
    console.error('Avatar cleanup list error:', error)
    return
  }

  const stale = files
    .filter((file) => !(keepCurrent && file.name === AVATAR_OBJECT_NAME))
    .map((file) => `${folder}/${file.name}`)
  if (stale.length === 0) return

  const { error: removeError } = await supabase.storage.from(bucket).remove(stale)
  if (removeError) console.error('Avatar cleanup remove error:', removeError)
}
