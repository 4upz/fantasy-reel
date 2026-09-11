---
category: League
---

# OfferExpiryPicker

Controlled trade-offer expiry selection: league-bound presets, a movie release,
a custom local date and time, or no expiry. The resolved time or validation
message appears below the choices. This controls an unanswered offer's window;
it does not configure the league trade deadline or commissioner review period.

Pass the league's `bounds`, the current `value`, an `onChange` handler, and the
`releaseAnchor` and `resolution` from the shared trade-expiry helpers. `fellBack`
explains a selection changed because its release anchor no longer applies.
The server validates the submitted expiry again.

The previews use relative dates and the real resolution helpers. Try a preset,
choose between the two movie releases, enter a custom time, or select no expiry.
The invalid-date story starts in the past and remains editable.
