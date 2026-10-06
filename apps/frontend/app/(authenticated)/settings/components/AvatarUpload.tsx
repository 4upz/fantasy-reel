'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Camera, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Avatar from '@/app/components/Avatar'
import {
  AVATAR_INPUT_TYPES,
  MAX_AVATAR_INPUT_BYTES,
  prepareAvatarImage,
  removeAvatarFiles,
  uploadAvatar,
} from '@/utils/avatarUpload'
import { updateAvatarUrl } from '../actions'

interface Props {
  userId: string
  currentAvatarUrl: string | null
  displayName: string
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
    if (!AVATAR_INPUT_TYPES.includes(file.type)) {
      toast.error('Please select a PNG, JPEG, WebP, or GIF image')
      return
    }

    // Validate file size
    if (file.size > MAX_AVATAR_INPUT_BYTES) {
      toast.error('Image must be less than 10MB')
      return
    }

    setIsUploading(true)

    try {
      const supabase = createClient()

      let image: Blob
      try {
        image = await prepareAvatarImage(file)
      } catch (error) {
        console.error('Avatar decode error:', error)
        toast.error('Could not read that image')
        return
      }

      let publicUrl: string
      try {
        publicUrl = await uploadAvatar(supabase, 'avatars', userId, image)
      } catch (error) {
        console.error('Upload error:', error)
        toast.error('Failed to upload image')
        return
      }

      // Update profile with new URL
      const result = await updateAvatarUrl(publicUrl)

      if (result.success) {
        setAvatarUrl(publicUrl)
        toast.success('Profile photo updated')
        await removeAvatarFiles(supabase, 'avatars', userId, { keepCurrent: true })
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

      const result = await updateAvatarUrl(null)

      if (result.success) {
        setAvatarUrl(null)
        await removeAvatarFiles(supabase, 'avatars', userId, { keepCurrent: false })
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
          className="type-control btn btn-secondary"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 mr-2" />
              Upload photo
            </>
          )}
        </button>

        {avatarUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isLoading}
            className="type-control btn btn-ghost text-crimson hover:text-crimson-hover hover:bg-error-bg"
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

        <p className="type-meta text-foreground-secondary mt-1">
          PNG, JPEG, WebP or GIF. Max 10MB.
        </p>
      </div>
    </div>
  )
}
