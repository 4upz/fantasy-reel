'use client'

import { Fragment, useCallback, useId } from 'react'
import { GripVertical, ListOrdered, Scissors } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export interface PriorityListItem {
  id: string
  title: string
  /** Optional detail line under the title, e.g. amount or target team. */
  meta?: React.ReactNode
}

interface PriorityListProps {
  /** Items in the team's chosen order, most wanted first. */
  items: PriorityListItem[]
  /** Forecast capacity against the draft order so the cut line moves with it. */
  computeFits: (items: PriorityListItem[]) => boolean[]
  heading: string
  description: string
  cutLabel: string
  testId: string
  cutTestId: string
  disabled: boolean
  onReorder: (ids: string[]) => void
}

function SortablePriorityItem({
  item,
  position,
  count,
  willFit,
  disabled,
  onMove,
}: {
  item: PriorityListItem
  position: number
  count: number
  willFit: boolean
  disabled: boolean
  onMove: (position: number) => void
}): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`priority-item-${item.id}`}
      className={`relative flex items-center gap-3 rounded-lg border p-3 motion-reduce:!transition-none ${
        isDragging
          ? 'z-10 border-gold bg-elevated shadow-medium'
          : willFit ? 'border-border bg-elevated' : 'border-border/60 bg-surface'
      }`}
    >
      <select
        value={position}
        disabled={disabled}
        onChange={(event) => onMove(Number(event.target.value))}
        aria-label={`Priority for ${item.title}`}
        className={`type-number h-11 w-11 shrink-0 appearance-none rounded-lg bg-transparent text-center cursor-pointer hover:bg-surface-hover disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${willFit ? 'text-gold' : 'text-foreground-secondary'}`}
      >
        {Array.from({ length: count }, (_, index) => (
          <option key={index + 1} value={index + 1}>{index + 1}</option>
        ))}
      </select>
      <div className="flex-1 min-w-0">
        <p className="type-row-title text-foreground break-words">{item.title}</p>
        {item.meta && (
          <p className="type-meta text-foreground-secondary mt-0.5 flex flex-wrap items-center gap-1">
            {item.meta}
          </p>
        )}
      </div>
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Reorder ${item.title}, priority ${position}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground-secondary cursor-grab active:cursor-grabbing touch-none hover:text-gold hover:bg-surface-hover disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        <GripVertical className="w-5 h-5" aria-hidden="true" />
      </button>
    </li>
  )
}

/** Shared controlled editor for the separate pickup and counterpick priorities. */
/** @design-system League */
export default function PriorityList({
  items,
  computeFits,
  heading,
  description,
  cutLabel,
  testId,
  cutTestId,
  disabled,
  onReorder,
}: PriorityListProps): React.ReactElement | null {
  const contextId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const moveItem = useCallback((from: number, to: number) => {
    if (disabled || from === to || from < 0 || to < 0 || to >= items.length) return
    onReorder(arrayMove(items, from, to).map((item) => item.id))
  }, [disabled, items, onReorder])
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    moveItem(
      items.findIndex((item) => item.id === active.id),
      items.findIndex((item) => item.id === over.id),
    )
  }

  if (items.length === 0) return null

  const fits = computeFits(items)
  const cutIndex = fits.indexOf(false)
  const describeItem = (id: string | number) => items.find((item) => item.id === id)?.title || 'Bid'
  const describePosition = (id: string | number) => items.findIndex((item) => item.id === id) + 1

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-gold" aria-hidden="true" />
          <h3 className="type-row-title text-foreground">{heading}</h3>
        </div>
        <p className="type-body-sm text-foreground-secondary">{description}</p>
      </div>

      <DndContext
        id={contextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable: 'Press Space to pick up a bid. Use the arrow keys to change its priority, then press Space to drop. Press Escape to cancel.',
          },
          announcements: {
            onDragStart: ({ active }: DragStartEvent) => `Picked up ${describeItem(active.id)}, priority ${describePosition(active.id)} of ${items.length}.`,
            onDragOver: ({ active, over }: DragOverEvent) => over
              ? `${describeItem(active.id)}, priority ${describePosition(over.id)} of ${items.length}.`
              : undefined,
            onDragEnd: ({ active, over }: DragEndEvent) => over
              ? `${describeItem(active.id)} dropped at priority ${describePosition(over.id)}.`
              : 'Reorder cancelled.',
            onDragCancel: () => 'Reorder cancelled.',
          },
        }}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2" aria-label={heading}>
            {items.map((item, index) => (
              <Fragment key={item.id}>
                {index === cutIndex && (
                  <li className="flex items-center gap-2 py-2" data-testid={cutTestId} role="presentation">
                    <Scissors className="w-3.5 h-3.5 text-foreground-secondary shrink-0" aria-hidden="true" />
                    <span className="type-meta text-foreground-secondary">{cutLabel}</span>
                    <span className="h-px flex-1 bg-border" />
                  </li>
                )}
                <SortablePriorityItem
                  item={item}
                  position={index + 1}
                  count={items.length}
                  willFit={fits[index]}
                  disabled={disabled || items.length < 2}
                  onMove={(position) => moveItem(index, position - 1)}
                />
              </Fragment>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  )
}
