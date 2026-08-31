---
category: Modals
---

# EndSeasonModal

Confirms ending a season, which cannot be undone.

Every element is aimed at making a *mistimed* end visibly wrong before it
happens: the champion preview names the team that would win, an
`alert-warning` counts the days being cut short, and the confirm button is
gated behind typing the season year. The year rather than the league name is
deliberate — it is the one value that distinguishes this season from its
siblings, so it makes ending the wrong season impossible rather than merely
tedious.
