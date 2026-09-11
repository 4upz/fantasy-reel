---
category: Movies
---

# FranchiseSummary

Compact franchise context for a bid dialog or another constrained surface.
The series average and most recent film's Tomatometer sit beside a disclosure
that reveals prior titles, years, and individual scores.

Pass a `FranchiseHistory`; `defaultOpen` initializes the disclosure as expanded,
and `className` controls its surrounding placement. The component manages its
own disclosure state and exposes `aria-expanded` and `aria-controls`.
Missing RT scores remain pending, and missing posters use the built-in fallback.

The previews share a consistent illustrative history with `FranchiseHistoryPanel`
and cover collapsed, expanded, and unscored states. The disclosure remains
interactive in every story.
