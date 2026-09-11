---
category: Movies
---

# FranchiseHistoryPanel

Expanded franchise context for movie detail surfaces. Prior films' Tomatometer
scores form a chart against the 60% break-even line, followed by the upcoming
pick as an unscored point. Each film also has a text title, release year, and
score badge; the graph is decorative. Wide histories scroll horizontally.

Pass a `FranchiseHistory` plus the current `movieTitle` and nullable
`movieReleaseDate`. Missing Rotten Tomatoes scores stay pending and do not
create points or count toward the average. `className` supports placement.

The previews use an illustrative three-film series with a matching average and
latest score, plus a completely unscored state. Use `FranchiseSummary` where a
compact disclosure fits better than the full chart.
