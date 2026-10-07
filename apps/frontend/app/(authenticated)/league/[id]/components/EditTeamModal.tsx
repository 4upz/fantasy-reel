'use client'

import { useState, useRef, useCallback, useId } from 'react'
import { toast } from 'sonner'
import { X, Camera, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Avatar from '@/app/components/Avatar'
import Modal from '@/app/components/Modal'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import {
  AVATAR_INPUT_TYPES,
  MAX_AVATAR_INPUT_BYTES,
  prepareAvatarImage,
  removeAvatarFiles,
  uploadAvatar,
} from '@/utils/avatarUpload'
import { updateTeamName, updateTeamAvatarUrl } from '../dashboard/actions'

interface Props {
  teamId: string
  leagueId: string
  currentName: string
  currentAvatarUrl: string | null
  onClose: () => void
}

const MAX_NAME_LENGTH = 100

/**
 * Toasts render outside the dialog, so while it is open they are hidden and
 * silent. Avatar results are shown here instead, in a live line of their own.
 */
type AvatarMessage = { kind: 'success' | 'error'; text: string }

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
  const [avatarMessage, setAvatarMessage] = useState<AvatarMessage | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const countId = useId()
  const errorId = useId()

  const trimmedName = name.trim()
  const isNameValid = trimmedName.length >= 1 && trimmedName.length <= MAX_NAME_LENGTH
  const isTooLong = trimmedName.length > MAX_NAME_LENGTH
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

  const { execute: handleSave, isLoading: isSaving, error: saveError } = useAsyncAction(saveAction)

  const canClose = !isBusy && !isSaving

  const onSave = async () => {
    try {
      await handleSave()
      // Shown once the dialog has closed, so it is both visible and announced.
      toast.success('Team updated')
      onClose()
    } catch {
      // Error already set by useAsyncAction and rendered below the name field
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!AVATAR_INPUT_TYPES.includes(file.type)) {
      setAvatarMessage({ kind: 'error', text: 'Please select a PNG, JPEG, WebP, or GIF image' })
      return
    }

    if (file.size > MAX_AVATAR_INPUT_BYTES) {
      setAvatarMessage({ kind: 'error', text: 'Image must be less than 10MB' })
      return
    }

    setIsUploading(true)
    setAvatarMessage(null)

    try {
      const supabase = createClient()

      let image: Blob
      try {
        image = await prepareAvatarImage(file)
      } catch (error) {
        console.error('Avatar decode error:', error)
        setAvatarMessage({ kind: 'error', text: 'Could not read that image' })
        return
      }

      let publicUrl: string
      try {
        publicUrl = await uploadAvatar(supabase, 'team-avatars', teamId, image)
      } catch (error) {
        console.error('Upload error:', error)
        setAvatarMessage({ kind: 'error', text: 'Failed to upload image' })
        return
      }

      const result = await updateTeamAvatarUrl(teamId, leagueId, publicUrl)

      if (result.success) {
        setAvatarUrl(publicUrl)
        setAvatarMessage({ kind: 'success', text: 'Team avatar updated' })
        await removeAvatarFiles(supabase, 'team-avatars', teamId, { keepCurrent: true })
      } else {
        setAvatarMessage({ kind: 'error', text: result.error ?? 'Failed to update avatar' })
      }
    } catch (error) {
      console.error('Avatar upload error:', error)
      setAvatarMessage({ kind: 'error', text: 'Something went wrong' })
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
    setAvatarMessage(null)

    try {
      const supabase = createClient()

      const result = await updateTeamAvatarUrl(teamId, leagueId, null)

      if (result.success) {
        setAvatarUrl(null)
        await removeAvatarFiles(supabase, 'team-avatars', teamId, { keepCurrent: false })
        setAvatarMessage({ kind: 'success', text: 'Team avatar removed' })
      } else {
        setAvatarMessage({ kind: 'error', text: result.error ?? 'Failed to remove avatar' })
      }
    } catch (error) {
      console.error('Avatar remove error:', error)
      setAvatarMessage({ kind: 'error', text: 'Something went wrong' })
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      preventClose={!canClose}
      closeOnBackdrop
      labelledBy={titleId}
      data-testid="edit-team-modal"
    >
      <div className="glass card p-6 w-full max-w-md animate-slide-up motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 id={titleId} className="type-panel text-foreground">Edit team</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            aria-label="Close edit team"
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

            {/* A pointer shortcut for "Upload photo" beside it, which is the
                keyboard and screen-reader route - so it is not a second stop. */}
            {!isBusy && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
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
                onClick={handleRemoveAvatar}
                disabled={isBusy}
                className="type-control btn btn-ghost text-crimson-text hover:text-crimson-text-hover hover:bg-error-bg"
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

            <p className="type-meta text-foreground-secondary">PNG, JPEG, WebP or GIF. Max 10MB.</p>
          </div>
        </div>

        {/* Avatar results, kept in a region that is always present so the
            change is heard; errors interrupt, successes wait their turn. */}
        <div role="status">
          {avatarMessage?.kind === 'success' && (
            <p className="type-body-sm text-success mb-6 -mt-3">{avatarMessage.text}</p>
          )}
        </div>
        {avatarMessage?.kind === 'error' && (
          <p role="alert" className="type-body-sm text-error mb-6 -mt-3">{avatarMessage.text}</p>
        )}

        {/* Team Name */}
        <div className="mb-6">
          <label htmlFor="team-name" className="type-label block text-foreground-secondary mb-2">
            Team name
          </label>
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH + 10}
            className="input w-full"
            placeholder="Enter team name"
            aria-required="true"
            aria-invalid={!isNameValid || Boolean(saveError) || undefined}
            aria-describedby={[saveError && errorId, countId].filter(Boolean).join(' ')}
            data-dialog-initial-focus
            data-testid="team-name-input"
          />
          {saveError && (
            <p id={errorId} role="alert" className="type-body-sm text-error mt-1">
              {saveError}
            </p>
          )}
          <div className="flex justify-end mt-1">
            <span
              id={countId}
              className={`type-meta ${isTooLong ? 'text-error' : 'text-foreground-secondary'}`}
              data-testid="team-name-char-count"
            >
              <span aria-hidden="true">{trimmedName.length}/{MAX_NAME_LENGTH}</span>
              <span className="sr-only">
                {trimmedName.length} of {MAX_NAME_LENGTH} characters{isTooLong ? ', too long' : ''}
              </span>
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
    </Modal>
  )
}
