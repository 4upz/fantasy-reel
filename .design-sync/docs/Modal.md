---
category: Modals
---

# Modal

The one way to build a modal dialog. A native `<dialog>` opened with
`showModal()`: it traps focus, makes the page behind it inert for screen
readers and keyboards, closes on Escape (unless `preventClose`, e.g. while a
request is in flight), and returns focus to whatever opened it. A backdrop
click closes it only with `closeOnBackdrop` — for read-only views, never for
forms a stray click would throw away. Mount it to open it. `labelledBy` names it from its visible heading;
children render the centered panel (usually `glass card`). Mark the first
control to focus with `data-dialog-initial-focus`. Errors inside it render
inline with `role="alert"` — toasts sit behind the dialog.
