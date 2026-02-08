'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { X, Camera, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Avatar from '@/app/components/Avatar'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { updateTeamName, updateTeamAvatarUrl } from '../dashboard/actions'

interface Props {
  teamId: string
  leagueId: string
  currentName: string
  currentAvatarUrl: string | null
  onClose: () => void
}

const MAX_NAME_LENGTH = 100
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

function extractPathFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const pathMatch = urlObj.pathname.match(/\/storage\/v1\/object\/public\/team-avatars\/(.+)/)
    return pathMatch ? pathMatch[1] : null
  } catch {
    return null
  }
}

export default function EditTeamModal({
  teamId,
  leagueId,
  currentName,
  currentAvatarUrl,
  onClose,
}: Props) {
  const [name, setName] = useState(currentName)
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl)
  const [isUploading, setIsUploading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const trimmedName = name.trim()
  const isNameValid = trimmedName.length >= 1 && trimmedName.length <= MAX_NAME_LENGTH
  const isBusy = isUploading || isRemoving

  const saveAction = useCallback(async () => {
    const formData = new FormData()
    formData.set('name', name)
    const result = await updateTeamName(teamId, leagueId, formData)
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to update team name')
    }
    return result
  }, [name, teamId, leagueId])

  const { execute: handleSave, isLoading: isSaving } = useAsyncAction(saveAction)

  const canClose = !isBusy && !isSaving

  const onSave = async () => {
    try {
      await handleSave()
      toast.success('Team updated')
      onClose()
    } catch {
      // Error already set by useAsyncAction
    }
  }

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && canClose) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [canClose, onClose])

  // Click outside to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && canClose) {
      onClose()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Please select a PNG, JPEG, WebP, or GIF image')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image must be less than 2MB')
      return
    }

    setIsUploading(true)

    try {
      const supabase = createClient()

      const timestamp = Date.now()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const filePath = `${teamId}/${timestamp}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('team-avatars')
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        toast.error('Failed to upload image')
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('team-avatars')
        .getPublicUrl(filePath)

      // Delete old avatar if exists
      if (avatarUrl) {
        const oldPath = extractPathFromUrl(avatarUrl)
        if (oldPath) {
          await supabase.storage.from('team-avatars').remove([oldPath])
        }
      }

      const result = await updateTeamAvatarUrl(teamId, leagueId, publicUrl)

      if (result.success) {
        setAvatarUrl(publicUrl)
        toast.success('Team avatar updated')
      } else {
        toast.error(result.error ?? 'Failed to update avatar')
      }
    } catch (error) {
      console.error('Avatar upload error:', error)
      toast.error('Something went wrong')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemoveAvatar = async () => {
    if (!avatarUrl) return

    setIsRemoving(true)

    try {
      const supabase = createClient()

      const oldPath = extractPathFromUrl(avatarUrl)
      if (oldPath) {
        await supabase.storage.from('team-avatars').remove([oldPath])
      }

      const result = await updateTeamAvatarUrl(teamId, leagueId, null)

      if (result.success) {
        setAvatarUrl(null)
        toast.success('Team avatar removed')
      } else {
        toast.error(result.error ?? 'Failed to remove avatar')
      }
    } catch (error) {
      console.error('Avatar remove error:', error)
      toast.error('Something went wrong')
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="modal-overlay"
      onClick={handleOverlayClick}
      data-testid="edit-team-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Edit team"
    >
      <div className="glass card p-6 w-full max-w-md animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-display font-bold text-foreground">Edit Team</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            className="btn-ghost p-1 rounded-lg"
            data-testid="cancel-edit-team"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Avatar Section */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative group" data-testid="team-avatar-preview">
            <Avatar
              src={avatarUrl}
              name={trimmedName || 'T'}
              size="lg"
              className="transition-all duration-200 group-hover:border-gold-hover group-hover:shadow-glow-gold"
            />

            {!isBusy && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                aria-label="Upload team avatar"
              >
                <Camera className="w-6 h-6 text-white" />
              </button>
            )}

            {isBusy && (
              <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isBusy}
              data-testid="team-avatar-upload"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
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
                onClick={handleRemoveAvatar}
                disabled={isBusy}
                className="btn btn-ghost text-sm text-crimson hover:text-crimson-hover hover:bg-error-bg"
                data-testid="team-avatar-remove"
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

            <p className="text-xs text-foreground-muted">PNG, JPEG, WebP or GIF. Max 2MB.</p>
          </div>
        </div>

        {/* Team Name */}
        <div className="mb-6">
          <label htmlFor="team-name" className="block text-sm font-medium text-foreground-secondary mb-2">
            Team Name
          </label>
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH + 10}
            className="input w-full"
            placeholder="Enter team name"
            data-testid="team-name-input"
          />
          <div className="flex justify-end mt-1">
            <span
              className={`text-xs ${trimmedName.length > MAX_NAME_LENGTH ? 'text-error' : 'text-foreground-muted'}`}
              data-testid="team-name-char-count"
            >
              {trimmedName.length}/{MAX_NAME_LENGTH}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!isNameValid || isBusy || isSaving}
            className="btn btn-primary"
            data-testid="save-team-button"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
