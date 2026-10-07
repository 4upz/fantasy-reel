# Accessibility: screen readers and low vision

Fantasy Reel targets **WCAG 2.2 AA** plus axe-core's best-practice rules, with
screen-reader use (VoiceOver, NVDA) and low vision (contrast, zoom, reduced
motion) as the explicit focus. This document records how coverage is measured,
the baseline before the October 2026 accessibility pass, where it stands now,
and the conventions that keep it there.

## How coverage is measured

Three independent checks. "100%" means all three are clean.

| Check | What it covers | Where it runs |
|---|---|---|
| **axe-core scan** (`e2e/tests/accessibility/axe-scan.spec.ts`) | Every route, signed out and in, in **both themes**, at desktop and mobile widths, plus every modal, menu and sheet opened from the keyboard. Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`. Also asserts per page: a page-specific `<title>`, exactly one `<h1>` and one `<main id="main-content">`, and the skip link. For dialogs: keyboard open moves focus inside, Tab stays inside, Escape closes, focus returns to the trigger. | E2E workflow (every PR) |
| **jsx-a11y strict lint** (`apps/frontend/eslint.config.mjs`) | Static rules over every TSX file: labels, roles, alt text, click handlers on non-interactive elements, autofocus, tabindex. | `next lint` and `next build` (so CI and Vercel builds fail on a violation) |
| **Manual screen-reader audit** | What automation cannot see: focus after view changes, announcements of realtime and async results, meaning carried only by color/position/symbols, `aria-label`s that hide content, dialog semantics in closed states, drag-and-drop alternatives. Checklist below. | Code review of every UI change |

Run the scan locally against a running dev server:

```bash
cd apps/frontend
A11Y_REPORT_DIR=/tmp/a11y npx playwright test e2e/tests/accessibility --project=chromium
```

`A11Y_REPORT_DIR` additionally writes each scan's violations to JSON.

## Baseline (before, `origin/main` at 138d079, 2026-10-07)

Measured with the same suite and lint rules as "Current status", run against
the unmodified `origin/main` build. A first audit of the earlier 25362e7 drove
the work; it was re-measured here once account deletion, email preferences and
unsubscribe had merged, and those are included.

**axe-core: 0 of 92 scans clean** (282 violation instances, 8 rules). Another 26
of the suite's 118 scans could not run at all: the dialogs they open were not
reachable from the keyboard or not exposed as dialogs.

| Rule | Impact | Scans affected | What it was |
|---|---|---|---|
| `select-name` | critical | 2 | Wishlist sort `<select>` had no label |
| `link-in-text-block` | serious | 74 | TMDb credit (every page) and inline links distinguishable by color only |
| `color-contrast` | serious | 14 | Dark theme: crimson text 3.2:1, completed badge 3.6:1, muted text 4.4:1, info/setup blue, Discord blurple |
| `nested-interactive` | serious | 2 | Bid search results: a wishlist button inside a `div role="button"` |
| `region` | moderate | 20 | Auth and unsubscribe pages' content outside any landmark |
| `heading-order` | moderate | 26 | Skipped heading levels (h1→h3, h2→h4) on dashboard, help, bidding, dialogs |
| `landmark-one-main` | moderate | 16 | No `<main>` on login, signup, forgot/reset password, unsubscribe, auth error, error, 404 |
| `landmark-unique` | moderate | 2 | Two unlabeled `<nav>`s with the mobile drawer open |

**Page structure:** 19 of 28 routes had the generic title "Fantasy Reel". Next's
route announcer speaks only when the title changes, so client-side navigation
between them was silent. 8 routes had no `<main>`, 4 had zero or two `<h1>`s,
and only 4 public pages had a skip link.

**Keyboard and dialogs:**
- 12 dialogs and menus failed a keyboard check.
  - Change password and Invite were not exposed as dialogs at all.
  - Six opened without moving focus inside: accept trade, cancel bid, edit
    team, end season, and both mobile sheets.
  - Create league and Place bid let Tab wander to the page behind.
  - Create league ignored Escape, and neither returned focus.
  - The notifications menu had no expanded state and ignored Escape.
- 23 of the 26 modals, sheets and drawers were hand-built `div` overlays.
- 0 of 3 screen-reader flows passed:
  - live draft announcements;
  - a failed sign-in that is announced and keeps what was typed;
  - a busy dialog that survives repeated Escape.

**jsx-a11y strict lint:** 32 errors in 17 files (10 unassociated labels,
9 handlers on non-interactive elements, 7 click-without-key handlers, autofocus,
non-interactive tabindex, misused roles).

**Manual audit:** 501 findings in 143 component files (**22 blockers, 189
major, 290 minor**): 492 from the first audit, plus 9 in the newly merged
delete-account dialog, email preferences switch and unsubscribe page. The
patterns:

- Hand-built `div` modals: no focus move, no focus trap, page behind them still
  reachable, no focus return, several with no dialog role or name.
- The live draft announced nothing on desktop (its only live region was
  `lg:hidden`), and nobody was ever told what was picked.
- `aria-label="View {title}"` on roster, standings and movie cards replaced the
  visible points, dates and status, hiding them from screen readers.
- Bid and trade amount inputs had no label; validation errors were a red border
  only; errors and successes were rarely announced.
- Focus dropped to `<body>` whenever an action removed its own button or a view
  swapped steps.
- Meaning carried only by color or position: cut lines, selected items, rank
  movement, champions, unread notifications.

## Current status (after the October 2026 pass)

| Check | Baseline (138d079) | Now |
|---|---|---|
| axe-core scans clean | 0 of 92 (282 violations, 8 rules; 26 more could not run) | **122 of 122** (61 pages, dialogs, menus and sheets × 2 themes; 0 violations) |
| Routes with their own `<title>` | 9 of 28 | **28 of 28** (league tabs also name the league) |
| Routes with one `<main>` + skip link | 4 of 28 | **28 of 28** |
| Dialogs and menus passing every keyboard check | 12 of 19 failing (2 not exposed as dialogs) | **All 19 exercised pass** (focus in, Tab contained, Escape closes, focus returns) |
| Modal dialogs on native `<dialog>` | 3 of 26 | **26 of 26** |
| Screen-reader flow tests | 0 of 3 | **3 of 3** |
| jsx-a11y strict lint errors | 32 in 17 files | **0** (now enforced by `next lint` / `next build`) |
| Manual audit findings | 501 (22 blockers, 189 major, 290 minor) | All blockers and majors fixed; minors fixed except the few declined below |

How the blocker patterns were resolved:

- **Dialogs:** every modal, sheet and drawer uses `Modal` / `useModalDialog`.
  The suite opens each from the keyboard and checks focus moves in, Tab stays
  in, Escape closes, and focus returns. Escape cannot close a dialog while its
  request is in flight (tested, including the browser's
  repeated-Escape escape hatch).
- **Live draft:** picks, counterpicks, phase changes and "It's your turn" are
  announced at every width without repeating your own pick or speaking on
  page load (`e2e/tests/accessibility/screen-reader-flows.spec.ts`).
- **Realtime elsewhere:** being outbid, bids closing, other teams' trade
  actions and settings results are announced once.
- **Hidden data:** cards and rows read their points, dates and status; ranks
  read "Tied for rank 2"; budgets read with their currency; standings,
  rosters and bid lists are real lists.
- **Forms:** every control is labelled, errors are linked and announced once,
  and focus goes to the field or button the user acts on next.
- **Keyboard alternatives:** draft order and bid priorities can be reordered
  with buttons or selects, and drag announcements name items and the cut line.
- **Low vision:** dark-theme tokens reach 4.5:1 on every surface, inline links
  are underlined, input focus is a solid 2px gold edge, and the OS
  reduce-motion setting stops the looping animations.

Declined, with reasons (from the fix reports):

- The unavailable "When it releases" expiry chip stays a disabled radio, with
  its reason as screen-reader text. Making it `aria-disabled` would let arrow
  keys select it. Sighted keyboard users still see the reason only on hover.
- The InviteModal user search is not a full ARIA combobox. It has a live
  result count, and Escape closes the results.
- Regenerating a join link has no confirmation step. That is a product choice
  rather than a screen-reader issue; its consequence is exposed through
  `aria-describedby`.

Verified locally on a production build (`next build` + `next start`, as CI
runs it): the accessibility suite passes in full. The full E2E suite fails
locally in exactly the same 10 specs as unmodified `origin/main`. Those depend
on local Realtime delivery or on migrations not yet applied to the local
database (draft Realtime, avatar upload, join links, email preferences). CI
runs on a fresh stack and is the authoritative run for them.

## Conventions (keep it at 100%)

- **Every page names itself.** Server pages export `metadata.title` (the root
  template adds "| Fantasy Reel"; league tabs add the league name). Client
  pages get it from a sibling `layout.tsx`.
- **Landmarks.** Each page renders exactly one `<main id="main-content"
  tabIndex={-1}>` (layouts already do for authenticated and public pages) and
  one `<h1>`. The root layout's skip link targets it.
- **Dialogs** use `app/components/Modal.tsx` (or `hooks/useModalDialog.ts` for
  custom placement such as sheets and drawers). Never build a modal from a
  `fixed inset-0` div. Give it `labelledBy`, close buttons an `aria-label`, and
  render errors inside it with `role="alert"` (toasts are hidden behind a modal).
- **Announcements.** Transient news a sighted user would notice — realtime
  picks, "your turn", "copied", "saved", search result counts — goes through
  `announce()` from `utils/announce.ts`. Persistent status text uses
  `role="status"` / `role="alert"` in place. Never put `aria-live` on large
  containers or ticking countdowns.
- **Focus** moves deliberately whenever the focused control disappears: to the
  new step's heading, the next logical control, or the list.
- **Names don't hide content.** Don't put `aria-label` on a control whose visible
  text carries information; icon-only controls do need one.
- **Not by color alone.** Status, selection, cut lines and gains/losses also
  appear as text (visible or `sr-only`).
- **Forms:** programmatic labels, `aria-describedby` for help and error text,
  `aria-invalid`, errors with `role="alert"`. Never focus a live message — it
  would be read twice. After a failed submit, focus the field the error is
  about (its error is linked by `aria-describedby` and rendered with
  `announce={false}`) or the submit button. A `FormError`/`FormSuccess` given a
  `ref` as a focus target drops its live role.
- **Toasts vs `announce()`:** outside a modal, a sonner toast is already
  announced, so don't also `announce()` it. Inside a modal, toasts are hidden
  behind it: use inline `role="alert"` text or `announce()`, or raise the toast
  after the dialog has closed.
- **Dialogs always close on Escape; a backdrop click is opt-in**
  (`closeOnBackdrop`). Use it for read-only views; don't add it to a form whose
  typed input a stray click would throw away.
- **Color tokens** are checked to 4.5:1 against every surface in both themes.
  Crimson text uses `text-crimson-text`; `bg-crimson` is for fills behind white
  text.
- **Motion:** the global `prefers-reduced-motion` rule collapses animations;
  don't override it.

## Manual audit checklist

Run through this for any new screen or component (the automated suite can't):

1. Open every dialog/menu/sheet from the keyboard: focus moves in, Tab stays in,
   Escape closes, focus returns.
2. Trigger every async action: is its success or failure announced?
3. Remove/replace the focused element (delete a row, advance a step): where does
   focus go?
4. Is anything conveyed only by color, position, an icon, or a symbol like
   "+36", "T2", "2d 4h"?
5. Do `aria-label`s replace visible information?
6. Realtime updates (draft, bids, trades): would a screen-reader user know they
   happened, without being spammed on load or reconnect?
7. Drag-and-drop: is there a keyboard path and are moves announced?
8. At 200% zoom and 320px width, does everything still fit without horizontal
   scrolling?
