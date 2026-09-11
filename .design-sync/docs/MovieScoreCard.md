---
category: Movies
---

# MovieScoreCard

Compact standings roster row with artwork, title, release date, Tomatometer
and fantasy points. `badge` identifies a draft pick (`round`, `pick`), pickup
(`amount`) or counterpick (`targetTeam`). `isCounterpicked` adds a separate
opponent marker to an owned movie.

For counterpicks, pass the stored counterpick score as `overridePoints`;
the movie's own fantasy points are the default. An explicit null override
keeps the counterpick unscored. Missing points read “Pending” for a released
movie and “Upcoming” otherwise. Missing or failed artwork uses a film icon.

Providing `onSelect` makes the row a keyboard-accessible button and passes
the movie to the caller, without bubbling the click to its surrounding
standings accordion. Omit it for a static row. Preview scores are
illustrative and use the app's shared Rotten Tomatoes scoring curve.
