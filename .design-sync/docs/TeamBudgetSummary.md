---
category: League
---

# TeamBudgetSummary

Compact Fantasy Budget summary showing the budget row's remaining amount
and total spent. A null or undefined `budget` displays the full
`startingBudget` and zero spent. A depleted budget uses secondary text
instead of gold; the numeric amount remains visible.

Supply the actual budget record. The component does not infer spending
from the starting balance or perform any transactions. Give the row enough
width for its label and the remaining/spent pair.
