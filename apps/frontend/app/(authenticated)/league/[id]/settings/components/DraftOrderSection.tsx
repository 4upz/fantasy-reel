'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { Shuffle, GripVertical, Crown, ChevronUp, ChevronDown } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { getParticipantDisplayName } from '@/utils/league'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { announce } from '@/utils/announce'
import type { League, ParticipantWithProfile } from '@/types'
import { SectionHeader, LockedMessage } from './shared'
import { ButtonSpinner } from '../../components/Icons'

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  isLocked: boolean
  onReorder: (participants: ParticipantWithProfile[]) => void
}

type MoveDirection = 'up' | 'down'

interface SortableItemProps {
  participant: ParticipantWithProfile
  position: number
  count: number
  isLocked: boolean
  onMove: (participantId: string, direction: MoveDirection) => void
}

const UNSAVED_HINT = 'Not saved yet: use Save Order to keep it.'

/** dnd-kit's spoken instructions for the drag handle, in this list's terms. */
const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'To move this player, press Space, use the up and down arrow keys, then press Space again to drop or Escape to cancel. The Move up and Move down buttons do the same one step at a time.',
}

const MOVE_BUTTON_CLASS =
  'p-1.5 rounded-md text-foreground-secondary hover:text-foreground hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'

function SortableItem({ participant, position, count, isLocked, onMove }: SortableItemProps): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: participant.id, disabled: isLocked })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isOwner = participant.role === 'owner'
  const name = getParticipantDisplayName(participant)

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="listitem"
      data-testid="draft-order-item"
      className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
        isDragging
          ? 'bg-elevated border-gold shadow-glow-gold z-10 opacity-90'
          : 'bg-surface border-border hover:border-border-hover'
      }`}
    >
      {!isLocked && (
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-foreground-secondary hover:text-foreground-secondary touch-none"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${name}, pick ${position} of ${count}`}
        >
          <GripVertical className="w-5 h-5" />
        </button>
      )}
      <div className="w-8 h-8 rounded-full bg-gold/15 flex items-center justify-center flex-shrink-0">
        <span className="type-row-title text-gold">
          <span className="sr-only">Pick </span>
          {position}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="type-label text-foreground truncate">
            {name}
          </span>
          {isOwner && (
            <>
              <Crown className="w-3.5 h-3.5 text-gold flex-shrink-0" aria-hidden="true" />
              <span className="sr-only">(league owner)</span>
            </>
          )}
        </div>
        {participant.teams && (
          <span className="type-meta text-foreground-secondary truncate block">
            {participant.teams.name}
          </span>
        )}
      </div>
      {/* Drag isn't usable everywhere -- not with a phone screen reader, and
          not where browse mode takes the arrow keys -- so each row can also be
          moved one step at a time with plain buttons. */}
      {!isLocked && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMove(participant.id, 'up')}
            disabled={position === 1}
            aria-label={`Move ${name} up`}
            className={MOVE_BUTTON_CLASS}
            data-move={`${participant.id}:up`}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(participant.id, 'down')}
            disabled={position === count}
            aria-label={`Move ${name} down`}
            className={MOVE_BUTTON_CLASS}
            data-move={`${participant.id}:down`}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

export default function DraftOrderSection({
  league,
  participants,
  isLocked,
  onReorder,
}: Props): React.ReactElement {
  const [localOrder, setLocalOrder] = useState(() =>
    [...participants].sort((a, b) => a.draft_order - b.draft_order)
  )
  const [hasChanges, setHasChanges] = useState(false)
  /** The move button to refocus once a one-step move has re-rendered the list. */
  const [pendingFocus, setPendingFocus] = useState<{ id: string; direction: MoveDirection } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setLocalOrder((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
      setHasChanges(true)
    }
  }, [])

  const handleMove = useCallback((participantId: string, direction: MoveDirection) => {
    const oldIndex = localOrder.findIndex((item) => item.id === participantId)
    const newIndex = direction === 'up' ? oldIndex - 1 : oldIndex + 1
    if (oldIndex === -1 || newIndex < 0 || newIndex >= localOrder.length) return

    setLocalOrder(arrayMove(localOrder, oldIndex, newIndex))
    setHasChanges(true)
    setPendingFocus({ id: participantId, direction })
    announce(
      `${getParticipantDisplayName(localOrder[oldIndex])} moved to pick ${newIndex + 1} of ${localOrder.length}. ${UNSAVED_HINT}`
    )
  }, [localOrder])

  // React may move the row's DOM node, which drops its focus. Put it back on
  // the same button -- or, at the top or bottom where that button is now
  // disabled, on its partner -- so a run of moves can continue.
  useEffect(() => {
    if (!pendingFocus) return
    const opposite: MoveDirection = pendingFocus.direction === 'up' ? 'down' : 'up'
    const find = (direction: MoveDirection) =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${pendingFocus.id}:${direction}"]`)
    const same = find(pendingFocus.direction)
    ;(same && !same.disabled ? same : find(opposite))?.focus()
    setPendingFocus(null)
  }, [pendingFocus])

  // dnd-kit's defaults speak the sortable ids -- participant UUIDs. Say the
  // player and the pick number instead.
  const announcements = useMemo<Announcements>(() => {
    const nameOf = (id: UniqueIdentifier) => {
      const participant = localOrder.find((item) => item.id === id)
      return participant ? getParticipantDisplayName(participant) : 'Player'
    }
    const pickOf = (id: UniqueIdentifier) => localOrder.findIndex((item) => item.id === id) + 1
    const count = localOrder.length
    return {
      onDragStart: ({ active }) =>
        `Picked up ${nameOf(active.id)}, pick ${pickOf(active.id)} of ${count}.`,
      onDragOver: ({ active, over }) =>
        over ? `${nameOf(active.id)} is over pick ${pickOf(over.id)} of ${count}.` : undefined,
      onDragEnd: ({ active, over }) =>
        over && over.id !== active.id
          ? `${nameOf(active.id)} moved to pick ${pickOf(over.id)} of ${count}. ${UNSAVED_HINT}`
          : `${nameOf(active.id)} stays at pick ${pickOf(active.id)} of ${count}.`,
      onDragCancel: ({ active }) =>
        `Reordering cancelled. ${nameOf(active.id)} stays at pick ${pickOf(active.id)} of ${count}.`,
    }
  }, [localOrder])

  const randomizeAction = useCallback(async () => {
    const { data, error } = await callEdgeFunction<{
      message: string
      participants: Array<{ id: string; draft_order: number }>
    }>('update-league', {
      body: {
        action: 'randomize_draft_order',
        league_id: league.id,
      },
    })

    if (error) throw new Error(error)

    if (data?.participants) {
      const orderMap = new Map(data.participants.map((p) => [p.id, p.draft_order]))
      const applyOrder = (list: ParticipantWithProfile[]) =>
        list
          .map((p) => ({ ...p, draft_order: orderMap.get(p.id) ?? p.draft_order }))
          .sort((a, b) => a.draft_order - b.draft_order)

      setLocalOrder(applyOrder)
      onReorder(applyOrder(participants))
      setHasChanges(false)
      toast.success(data.message)
    }
  }, [league.id, onReorder, participants])

  const saveAction = useCallback(async () => {
    const participantOrder = localOrder.map((p) => p.id)

    const { data, error } = await callEdgeFunction<{ message: string }>('update-league', {
      body: {
        action: 'reorder_participants',
        league_id: league.id,
        participant_order: participantOrder,
      },
    })

    if (error) throw new Error(error)

    if (data?.message) {
      const updated = localOrder.map((p, i) => ({ ...p, draft_order: i + 1 }))
      onReorder(updated)
      setHasChanges(false)
      toast.success(data.message)
    }
  }, [league.id, localOrder, onReorder])

  const { execute: randomize, isLoading: isRandomizing, error: randomizeError } = useAsyncAction(randomizeAction)
  const { execute: save, isLoading: isSaving, error: saveError } = useAsyncAction(saveAction)

  useEffect(() => {
    if (randomizeError) toast.error(randomizeError)
  }, [randomizeError])

  useEffect(() => {
    if (saveError) toast.error(saveError)
  }, [saveError])

  return (
    <section className="card p-6" data-testid="draft-order-section">
      <SectionHeader
        icon={Shuffle}
        title="Draft Order"
        description={isLocked ? 'Locked after draft starts' : 'Drag to reorder or randomize'}
        isLocked={isLocked}
      />

      {isLocked ? (
        <div data-testid="draft-order-locked">
          <LockedMessage message="Draft order cannot be changed after the draft has started." />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={() => randomize()}
              disabled={isRandomizing || isSaving}
              className="btn btn-secondary"
              data-testid="randomize-button"
            >
              {isRandomizing ? (
                <>
                  <ButtonSpinner />
                  Randomizing...
                </>
              ) : (
                <>
                  <Shuffle className="w-4 h-4" />
                  Randomize
                </>
              )}
            </button>
            {hasChanges && (
              <button
                type="button"
                onClick={() => save()}
                disabled={isSaving}
                className="btn btn-primary animate-fade-in"
                data-testid="save-order-button"
              >
                {isSaving ? (
                  <>
                    <ButtonSpinner />
                    Saving...
                  </>
                ) : (
                  'Save Order'
                )}
              </button>
            )}
          </div>

          {!league.custom_draft_order && (
            <p className="type-meta text-foreground-secondary mb-4">
              Draft order will be automatically randomized when the draft starts unless you set it manually.
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
          >
            <SortableContext
              items={localOrder.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div ref={listRef} className="space-y-2" role="list" aria-label="Draft order">
                {localOrder.map((participant, index) => (
                  <SortableItem
                    key={participant.id}
                    participant={participant}
                    position={index + 1}
                    count={localOrder.length}
                    isLocked={isLocked}
                    onMove={handleMove}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </section>
  )
}
