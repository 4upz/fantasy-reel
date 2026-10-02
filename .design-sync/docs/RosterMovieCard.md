---
category: Movies
---

# RosterMovieCard

Poster-led roster card with a source label, pending or scored review state,
and optional lock badge. Points on a movie that has not released yet are a
pre-release score, shown muted as “N pts at release” because they don't count
until it opens. Without `onSelect` it is a static article; supplying
the callback makes the entire card a keyboard-accessible button. The caller
owns selection and gameplay rules. Leave preview-only focus props unset for
ordinary app use.
