---
category: League
---

# BidSummary

Movie poster, title and optional release date with a slot for bid details.
Renders sibling elements, so mount it in a flex row with a gap. Compose
`BidAmountDisplay` or deadline text as children; cancellation and counterbid
actions belong to the containing `BidCard`. Missing artwork gets a film icon.
