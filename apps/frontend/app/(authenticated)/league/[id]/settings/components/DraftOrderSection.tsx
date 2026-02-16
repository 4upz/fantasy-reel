'use client'

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Shuffle, GripVertical, Crown } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import type { League, ParticipantWithProfile } from '@/types'
import { SectionHeader, LockedMessage } from './shared'
import { ButtonSpinner } from '../../components/Icons'

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  isLocked: boolean
  onReorder: (participants: ParticipantWithProfile[]) => void
}

interface SortableItemProps {
  participant: ParticipantWithProfile
  position: number
  isLocked: boolean
}

function SortableItem({ participant, position, isLocked }: SortableItemProps): React.ReactElement {
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
          className="cursor-grab active:cursor-grabbing text-foreground-muted hover:text-foreground-secondary touch-none"
          aria-label={`Drag to reorder ${getParticipantDisplayName(participant)}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-5 h-5" />
        </button>
      )}
      <div className="w-8 h-8 rounded-full bg-gold/15 flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-bold text-gold">{position}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {getParticipantDisplayName(participant)}
          </span>
          {isOwner && (
            <Crown className="w-3.5 h-3.5 text-gold flex-shrink-0" title="League Owner" />
          )}
        </div>
        {participant.teams && (
          <span className="text-xs text-foreground-muted truncate block">
            {participant.teams.name}
          </span>
        )}
      </div>
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
                aria-label="Save draft order changes"
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
            <p className="text-xs text-foreground-muted mb-4">
              Draft order will be automatically randomized when the draft starts unless you set it manually.
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={localOrder.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2" role="list">
                {localOrder.map((participant, index) => (
                  <SortableItem
                    key={participant.id}
                    participant={participant}
                    position={index + 1}
                    isLocked={isLocked}
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
