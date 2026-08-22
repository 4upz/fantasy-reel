import { PriorityList } from 'fantasy-reel'

const item = (id: string, title: string, meta: string) => ({
  id,
  title,
  meta: <span className="text-foreground-muted">{meta}</span>,
})

const items = [
  item('p1', 'Dune: Part Two', '$24'),
  item('p2', 'Kingdom of the Planet of the Apes', '$18'),
  item('p3', 'Godzilla x Kong', '$11'),
  item('p4', 'The Garfield Movie', '$7'),
]

const onReorder = async () => ({ success: true })

/** Capacity as a plain count: the first N fit, the rest grey out below the line. */
const firstN = (n: number) => (ordered: { id: string }[]) =>
  ordered.map((_, index) => index < n)

/**
 * The shared mechanism behind both bid-priority controls: reorder with the
 * chevrons, and a cut line marking where capacity runs out. Callers supply
 * their own copy and their own `computeFits` rule.
 */
export const Default = () => (
  <div className="max-w-lg">
    <PriorityList
      items={items}
      computeFits={firstN(2)}
      heading="Bid priority"
      description="If more of your bids win than you have room for, you keep the top 2."
      cutLabel="Roster runs out"
      testId="priority-list"
      cutTestId="priority-list-cut"
      onReorder={onReorder}
    />
  </div>
)

/** Nothing fits: the line sits above every row. */
export const NoCapacity = () => (
  <div className="max-w-lg">
    <PriorityList
      items={items}
      computeFits={firstN(0)}
      heading="Bid priority"
      description="Your roster is full. Only bids with a movie to drop can be honored."
      cutLabel="Roster runs out"
      testId="priority-list"
      cutTestId="priority-list-cut"
      onReorder={onReorder}
    />
  </div>
)

/** Everything fits, so no line is drawn at all. */
export const AllFit = () => (
  <div className="max-w-lg">
    <PriorityList
      items={items.slice(0, 3)}
      computeFits={firstN(5)}
      heading="Bid priority"
      description="If more of your bids win than you have room for, you keep the top 5."
      cutLabel="Roster runs out"
      testId="priority-list"
      cutTestId="priority-list-cut"
      onReorder={onReorder}
    />
  </div>
)
