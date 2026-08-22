---
category: League
---

# PriorityList

The reorderable list behind both bid-priority controls.

Pickup bids and counterpick bids stay two separate lists on screen — they draw
on different capacity pools, so ranking one against the other would mean
nothing. What they share is the mechanism, and it lives here: up/down
reordering, a debounced save, and a line marking where the team runs out of
room.

Which items fit is not decided here. Callers pass `computeFits`, evaluated
against the *local* order so the cut line moves as the user reorders rather
than lagging a save behind.
