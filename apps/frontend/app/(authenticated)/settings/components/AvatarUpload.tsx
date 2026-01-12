'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Camera, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Avatar from '@/app/components/Avatar'
import { updateAvatarUrl } from '../actions'

interface Props {
  userId: string
  currentAvatarUrl: string | null
  displayName: string
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

function extractPathFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const pathMatch = urlObj.pathname.match(/\/storage\/v1\/object\/public\/avatars\/(.+)/)
    return pathMatch ? pathMatch[1] : null
  } catch {
    return null
  }
}

export default function AvatarUpload({ userId, currentAvatarUrl, displayName }: Props): React.ReactElement {
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl)
  const [isUploading, setIsUploading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Please select a PNG, JPEG, WebP, or GIF image')
      return
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image must be less than 2MB')
      return
    }

    setIsUploading(true)

    try {
      const supabase = createClient()

      // Generate unique filename with timestamp to avoid CDN cache issues
      const timestamp = Date.now()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const filePath = `${userId}/${timestamp}.${ext}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        toast.error('Failed to upload image')
        return
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      // Delete old avatar if exists
      if (avatarUrl) {
        const oldPath = extractPathFromUrl(avatarUrl)
        if (oldPath) {
          await supabase.storage.from('avatars').remove([oldPath])
        }
      }

      // Update profile with new URL
      const result = await updateAvatarUrl(publicUrl)

      if (result.success) {
        setAvatarUrl(publicUrl)
        toast.success('Profile photo updated')
      } else {
        toast.error(result.error ?? 'Failed to update profile')
      }
    } catch (error) {
      console.error('Avatar upload error:', error)
      toast.error('Something went wrong')
    } finally {
      setIsUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemove = async () => {
    if (!avatarUrl) return

    setIsRemoving(true)

    try {
      const supabase = createClient()

      // Delete from storage
      const oldPath = extractPathFromUrl(avatarUrl)
      if (oldPath) {
        await supabase.storage.from('avatars').remove([oldPath])
      }

      // Update profile to remove avatar URL
      const result = await updateAvatarUrl(null)

      if (result.success) {
        setAvatarUrl(null)
        toast.success('Profile photo removed')
      } else {
        toast.error(result.error ?? 'Failed to remove profile photo')
      }
    } catch (error) {
      console.error('Avatar remove error:', error)
      toast.error('Something went wrong')
    } finally {
      setIsRemoving(false)
    }
  }

  const isLoading = isUploading || isRemoving

  return (
    <div className="flex items-center gap-6">
      {/* Avatar Display */}
      <div className="relative group">
        <Avatar
          src={avatarUrl}
          name={displayName}
          size="lg"
          className="transition-all duration-200 group-hover:border-gold-hover group-hover:shadow-glow-gold"
        />

        {/* Upload overlay */}
        {!isLoading && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
            aria-label="Change profile photo"
          >
            <Camera className="w-6 h-6 text-white" />
          </button>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFileSelect}
          className="hidden"
          disabled={isLoading}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="btn btn-secondary text-sm"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 mr-2" />
              Upload Photo
            </>
          )}
        </button>

        {avatarUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isLoading}
            className="btn btn-ghost text-sm text-crimson hover:text-crimson-hover hover:bg-error-bg"
          >
            {isRemoving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Removing...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Remove
              </>
            )}
          </button>
        )}

        <p className="text-xs text-foreground-muted mt-1">
          PNG, JPEG, WebP or GIF. Max 2MB.
        </p>
      </div>
    </div>
  )
}
