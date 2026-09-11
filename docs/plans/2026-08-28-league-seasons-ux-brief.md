# League Seasons & Completion — UX Brief

Companion to `2026-08-28-league-seasons-design.md`. Covers every surface in that
plan's "Frontend surfaces" list. Cinematic Dark only — no new tokens except the
two component classes named in §0.

## 0. The through-line: the year is a film-can label

One device ties nine surfaces together: **a season year is always set in
`font-mono`, uppercase-flat, letter-spaced** — the way a number is stencilled on
a film can or a slate. It never uses `font-display` (that's for names) and never
becomes a `.badge` (those are reserved for status colours).

```
Season pill   — rounded-md border border-border bg-elevated px-2 py-0.5
                font-mono text-[11px] tracking-[0.08em] text-foreground-secondary
```

The one loud moment is the **champion banner**. Everything else stays quiet;
gold gradient appears on exactly one surface per page. Two new classes in
`globals.css @layer components`:

```css
.champion-plate {            /* gold-lit card, one per page */
  background: linear-gradient(135deg, oklch(0.65 0.15 85 / 0.16), transparent 62%),
              var(--color-surface);
  border: 1px solid oklch(0.65 0.15 85 / 0.4);
}
```
Reuse the existing `.accolade-shine` on the trophy glyph inside it — it already
sweeps once then rests and already honours `prefers-reduced-motion`. Do not add
a new keyframe.

---

## 1. Settings: the Season section + End Season

**New `SeasonSection.tsx`**, placed in the settings column **above** Danger Zone
and below `TradeConfigSection`. Standard `card p-6` + `SectionHeader` from
`./shared` with `icon={CalendarDays}` — gold circle, identical to every other
settings card. It is configuration, not demolition.

Fields:

| Field | State |
|---|---|
| Season year | `input` type number, editable **only** while `status === 'setup'`. Otherwise render `LockedMessage` copy: "The season year is fixed once the draft starts." |
| Season ends | `DateTimeField` (date only). Helper: "Scores freeze on this date and the champion is recorded." |
| Trade deadline | `DateTimeField`, placeholder shows the season end date. Helper: "Leave empty to trade until the season ends." |

Below a `border-t border-border pt-5`, the end-season row — deliberately **not**
crimson:

```
┌ bg-elevated rounded-lg border border-border p-4 ────────────┐
│ End season now                          [ End season ]      │
│ Freezes scores, records the champion,    btn btn-secondary   │
│ and tells everyone.                                          │
└──────────────────────────────────────────────────────────────┘
```

**How it differs from Danger Zone**, visually and in kind: Danger Zone is
`border-crimson/30`, a crimson `AlertTriangle`, `bg-crimson/5` rows and a
`btn-danger`. Season is gold-headed, `bg-elevated`, `btn-secondary`. Deleting
destroys data; ending a season *completes a record* — the league gets more
valuable, not less. The words "can't be undone" appear only inside the confirm
modal, never on the settings surface.

**`EndSeasonModal.tsx`** — `modal-overlay` + `card modal-panel max-w-md`:

- Eyebrow, mono: `2026 SEASON`
- `h2 font-display`: **End the season?**
- Champion preview from `league_standings`: top 3 rows reusing
  `PODIUM_CHIP` gradients from `TeamStandingCard.tsx`, rank chip + team name +
  points. Rank 1 row gets `text-gold`.
- Line under it: "Academy Aces wins the 2026 title." / co-champion variant:
  "Academy Aces and Award Hunters share the 2026 title."
- Three bullets: "Scores stop updating." · "Bids, trades and drops close." ·
  "Everyone gets the final standings."
- **Early-end warning** (`alert alert-warning`), shown only when `season_end` is
  in the future: "This season isn't scheduled to end until Dec 31 — you're
  freezing scores 125 days early."
- **Confirm gate:** type the season year (`2026`) into an `input`. Four
  characters, unambiguous, far cheaper than `ConfirmDeleteModal`'s
  type-the-league-name, and it makes ending the *wrong season* impossible.
- Buttons: `btn btn-ghost` "Cancel" · `btn btn-primary` "End season".
  Wrap the call in `useAsyncAction` + `callEdgeFunction`.

**After:** modal closes → `toast.success('Season ended. Academy Aces wins.')` →
`router.refresh()`. The page returns in completed state; the Season card's row
now reads "Start the 2027 season" with a `btn-secondary`.

---

## 2. Season identity in the header, and the completed state

**Season pill** — `layout.tsx`, inside the existing metadata strip, placed
*after* the status badge and *before* the `·` dot run, so mobile line 2 reads
`2026 · Invite Only · 3 participants` and desktop reads
`Active · 2026 · Invite Only · 3 participants`. Static `<span>` when
`series.seasons.length === 1`; the switcher button from §3 when more.

**Champion banner** — `ChampionBanner.tsx`, rendered at the top of both the
league dashboard and the standings page when `status === 'completed'`.
`champion-plate rounded-xl p-5 animate-fade-in`, full width:

```
┌──────────────────────────────────────────────────────────────┐
│ ◎  2026 CHAMPION                                             │
│    Academy Aces                              345.0           │
│    Carol Coppola                             FINAL POINTS    │
└──────────────────────────────────────────────────────────────┘
```
- Glyph: `Trophy` `h-5 w-5 text-gold` in a `h-11 w-11 rounded-full bg-gold-muted`
  circle wrapped in `.accolade-shine`.
- Eyebrow: `font-mono text-[11px] uppercase tracking-[0.14em] text-gold`.
- Name: `font-display text-2xl font-semibold text-foreground`, owner beneath in
  `text-sm text-foreground-muted`.
- Points: `font-display text-[28px] font-bold text-gold` + `FINAL POINTS`
  caption, mirroring `TeamStandingCard`'s points column so the eye lands in the
  same place.

**Co-champion variant:** eyebrow `2026 CO-CHAMPIONS`; names joined with ` · `
(four or more → `Alice, Bob and 2 others`); avatars overlap `-space-x-2`; one
points figure, with a caption line under it: **"Tied on 345.0 pts — both teams
hold the title."** That sentence is load-bearing; without it a two-gold-chip
standings table reads as a rendering bug.

**Reigning-champion crown** — `ChampionCrown.tsx`, a `Crown h-3.5 w-3.5
text-gold` with `<span className="sr-only">2026 champion</span>` and a `title`.
Renders inside `TeamStandingCard`'s name row, before the `You` chip, and in
`ParticipantsList`. Deliberately tiny and monochrome: the row already carries a
podium chip and possibly a gold `isCurrentUser` edge, and a third gold surface
would flatten all three.

---

## 3. Season switcher — recommendation: a **sibling control**, not inside `LeagueSwitcher`

Put a season menu next to the league name, not in it.

**Why not inside `LeagueSwitcher`:** it answers a different question. The league
switcher answers *which league*; the season menu answers *which year of this
league*. Nesting seasons under each league makes the list O(leagues × seasons)
and forces every user with three leagues to scan past years they don't want.
Its list is also fetched with a flat `.from('leagues').select('id, name,
status')` — grouping it means restructuring a menu that works.

**Why not tabs:** `LeagueTabs` is a destination row. A season is scope, not a
destination, and adding it would break `splitTabsForBottomBar`'s four-slot
arithmetic.

**The control:** the season pill from §2 becomes a button when
`series.seasons.length > 1` — `ChevronDown h-3 w-3` appended, `hover:text-gold`.
Its panel copies `LeagueSwitcher`'s exact anatomy (`glass card animate-fade-in
z-50`, `role="listbox"`, click-outside + Escape, gold dot on the current row) at
`w-56` — narrower, because rows are short:

```
┌ Seasons ──────────────────┐
│ ● 2026        Active      │
│   2025        Completed 🏆 │
│   2024        Completed 🏆 │
├───────────────────────────┤
│ All seasons →             │
└───────────────────────────┘
```
Year in `font-mono`, status via the existing `.badge` + `STATUS_BADGE_CLASS`, a
small gold `Trophy` on any season you won. Switching preserves the current tab
segment exactly as `getLeagueUrl` already does — reuse that function verbatim.

**Mobile:** the pill sits on metadata line 2, thumb-reachable, and the panel
opens downward under it. It stays **out of `LeagueBottomNav`** — the bottom bar
is four destinations plus More, and a scope control there would read as a fifth
page. The two dropdowns never collide: they're on different lines, different
shapes (`text-lg font-display` + chevron vs. an 11px mono pill), and separated
by the status badge.

---

## 4. "Start next season", and what members see afterwards

**Owner CTA, one loud placement:** trailing action inside `ChampionBanner` on
the completed league's dashboard — `btn btn-primary` reading **"Start the 2027
season"**. On mobile it drops to a full-width button below the banner body.
Second, quiet placement: the Season settings card's row, `btn-secondary`. Never
two primaries.

A small confirm (`ConfirmStartSeasonModal`) before the call, because it copies
people: lists the carried-over participants by name, and states plainly —
"Everyone from 2026 comes along with their team name. Rosters start empty, and
anyone can leave from the new season's page."

**After success:** redirect to `/league/{newId}/settings`. The new season lands
in `setup` and the owner's next job is draft dates — the dashboard has nothing
to show yet. Toast: `2027 season created. Set your draft dates.`

**Non-owner first view.** They arrive from the `season_started` notification at
`/league/{newId}/dashboard` with no movies and no explanation — the single
biggest confusion risk in this feature ("where did my roster go?"). Give them a
dismissible `SeasonWelcomeCard` at the top of the dashboard, `card p-5
animate-slide-up`, dismissal stored in `localStorage` per league id:

> **The 2027 season is open**
> Your team, Golden Globe Gang, carried over. Rosters start empty — the draft
> hasn't been scheduled yet.
> `See the 2026 final standings →`  (text link, `text-gold`)

---

## 5. Series history — recommendation: a **route**, `/league/[id]/history`

Not a dashboard panel. The league dashboard is season-scoped and already dense;
history is series-scoped and grows by one row a year forever. A route also
gives the season menu's "All seasons" footer somewhere to go, and gives the
champion banner's "See the 2026 final standings" link a home when the season in
question isn't the one you're viewing.

**Entry points** (both gated on `series.seasons.length > 1`, one shared check):
the "All seasons →" footer in the season menu, and a `History` tab added to
`getVisibleTabs`. Register it as `secondary: true` always, so it sorts before
Settings on desktop and falls into the More sheet on mobile without competing
with Standings. This needs a signature change:
`getVisibleTabs(league, isOwner, outbidCount, seasonCount)` — flag it, since
`leagueNav.ts` currently keys visibility off status alone and both nav
components call it.

**Per season, one row** (`card card-interactive p-4`), newest first, with a
vertical hairline spine on the left (`border-l border-border`) that the mono
year sits on — the film-can label repeating down the page:

```
2026 │ ◎ Academy Aces            345.0    Completed
     │   🥈 Golden Globe Gang · 🥉 Award Hunters
     │                              View season →
```
Champion in `font-display font-semibold text-gold`; 2nd/3rd in
`text-xs text-foreground-muted` on one line; status badge right-aligned. The
in-progress season is the first row, without a champion, reading `In progress`.
Co-champions: both names on the champion line joined by ` · `.

**Empty state** (reachable by URL on a one-season league): show the current
season's row, then `text-center py-10 text-sm text-foreground-muted` —
"This is the league's first season. Past seasons show up here once one ends."

---

## 6. Dashboard grouping

`LeagueListItem` becomes `SeriesListItem`, one card per series. The card *is*
the current season — same anatomy as today, so the common case (everyone with
one season) looks unchanged:

```
┌ card card-interactive ───────────────────────────────────────┐
│ Oscar Contenders          [Active]  2026                     │
│ Private · 6 participants · Drafted Mar 4                     │
│ ─────────────────────────────────────────────────────────── │
│ ⌄ 2 past seasons                          🏆 2025 Alice      │  ← only when >1
└──────────────────────────────────────────────────────────────┘
```

- "Current season" = the one whose status isn't `completed`; if all are
  completed, the highest `season_year`.
- The collapsed row is a `<button aria-expanded>` inside the card but **outside**
  the `<Link>` — nesting interactive elements breaks keyboard nav. Restructure
  the card so the link wraps only the top block.
- Expanded rows: `2025 · Completed` + `🏆 Alice Spielberg`, each linking to that
  season's standings.

**On the badge copy:** keep the `.badge badge-completed` reading exactly
`2025 · Completed` and put the champion in a *separate* chip
(`rounded-full bg-gold-muted px-2 py-px text-[11px] text-gold`). A status badge
is a fixed-width status token; a person's name inside it truncates
unpredictably and mixes two semantics in one pill. Same reason the current
season shows `[Active]` and the mono `2026` as two adjacent elements rather
than one merged badge.

---

## 7. Profile trophies

**There is no profile page in this app** — `/settings` is account settings, and
`ProfileMenu` is a three-item dropdown. Creating a profile route is scope the
plan doesn't fund. Put the trophy case in `DashboardSidebar`, above "Browse
Movies": it's already the "about you" column on the dashboard, it needs no new
route, and it's the screen people land on.

`TrophyCase.tsx`, `sidebar-action-card` (existing class), non-interactive:

```
◎  Trophy case
   3 championships

   2026  Oscar Contenders
   2025  Oscar Contenders
   2023  Reel Talk          (each row: mono year + series name, links to that
                             season's standings)
```
Year `font-mono text-[11px] text-foreground-muted`, series name
`text-sm text-foreground`, hover `text-gold`. Cap the visible list at 5 with
"+2 more" linking to the relevant history pages. The count line uses
`font-display text-gold`.

**Zero titles.** Don't hide the card — an empty trophy case is a hook, and
hiding it means nobody knows titles exist. Copy, in the interface's voice, no
apology:

> **Trophy case**
> No titles yet. Win a season to hang the first one.

Data: the plan's optional `my_championships()` RPC is worth adding — the client
query is `leagues.winner_team_ids @> my team ids` across every series, which is
awkward from PostgREST and needs the series name joined in.

---

## 8. Standings on a completed league

- `ChampionBanner` renders first, above the three `SummaryCard`s.
- The summary strip gains a leading caption: `font-mono text-[11px]
  uppercase tracking-[0.1em] text-foreground-muted` — `FINAL · 2026 SEASON`.
- The "No scores available yet" `alert-info` must not render on a completed
  league; replace it with nothing (the banner already says the season is over).
- Rank-1 row keeps its gold `PODIUM_CHIP` and gains `ChampionCrown`.
- Co-champions: both rank-1 rows show `T1` in the gold chip; the banner supplies
  the word **"Co-champions"** and the tie caption. Never invent a tiebreak.
- Wiring: `league_standings` supplies `rank`, `is_tied` and `total_points`;
  `StandingsClient` keeps its `groupBy` for holdings and drops
  `calculateRankings`. The RPC is now the only source of rank — including for
  active leagues, so ranks can't drift between the page and the banner.

---

## 9. Copy

**In-app — `season_completed`** (title 34 / body 62 chars at the example values;
body clamps to 2 lines at 12px in a 320px dropdown, so keep it under ~90):
- title: `2026 season final: Academy Aces wins` — co-variant: `2026 season final: co-champions crowned`
- body: `Final standings are locked. Academy Aces finished on 345.0 pts.` — co-variant: `Final standings are locked. Academy Aces and Award Hunters tied on 345.0 pts.`
- `NotificationBell`: icon `Trophy` `text-gold`; href branch → `/league/${leagueId}/standings`.

**In-app — `season_started`**:
- title: `The 2027 season is open`
- body: `Your team carried over. Rosters start empty until the draft.`
- icon `Clapperboard` `text-gold`; href → `/league/${leagueId}/dashboard`.
- The row's `league_id` must be the **new** league id, or the link lands on the
  season that just ended.

**Discord — final standings** (extend the embed already in `update-league`,
moving to `_shared/league-completion.ts`; `category: 'scores'`,
`color: DISCORD_COLORS.green`):
- title: `🏆 2026 Final Standings`
- description: `Oscar Contenders is a wrap. Academy Aces takes the 2026 title.` — co-variant: `… Academy Aces and Award Hunters share the 2026 title.`
- fields: today's `🥇🥈🥉` inline three. Prefix `👑 ` to the previous season's
  champion wherever they land. If they finished outside the top 3, add one
  non-inline field: `{ name: 'Defending champion', value: '👑 Golden Globe Gang — 5th, 88.0 pts' }`.
- footer: `{ text: 'Oscar Contenders · 2026 season' }`, url `/standings`.

**Discord — 7-day reminder** (`category: 'general'`,
`color: DISCORD_COLORS.yellow` — "you may need to act"):
- title: `The 2026 season ends in 7 days`
- description: `Final scores lock on <t:…:D>. Settle any open trades and bids before then.`
- fields: `Leader` → `🥇 Academy Aces — 345.0 pts` (inline) · `Ends` → `<t:…:R>` (inline)
- footer `{ text: leagueName }`, url `/standings`.

**Discord — season started** (`general`, `DISCORD_COLORS.gold`):
- title: `🎬 The 2027 season is open`
- description: `6 teams carried over from 2026. Draft dates haven't been set yet.`

**Email — `season-final-standings`** (new
`_shared/email-templates/season-final-standings.ts`, `getSeasonFinalStandingsEmailHtml/Text`;
follow the `buildInvitationEmailHtml` skeleton — it's the closest thing to a
celebration layout — accent `#c9a227`):
- subject: `Oscar Contenders: Academy Aces wins the 2026 season` — co-variant: `Oscar Contenders: co-champions crowned in 2026`
- preheader: `Final standings are locked. Here's how the 2026 season finished.`
- body: `<h1>FANTASY REEL</h1>` header → `<h2>` `2026 Champion` (or
  `2026 Co-champions`) in gold at 28px → champion team + owner → a full final
  standings `<table>` on the `#262626` inner panel (rank · team · pts, the
  recipient's own row bolded in `#e8e8e8`) → one personal line,
  `You finished 2nd with 339.0 pts.` → CTA `View Final Standings` →
  `${leagueUrl}/standings` → standard footer.
- Escape every interpolated name with `escapeHtml`, subjects with
  `sanitizeEmailHeader`. Log with `logNotificationDelivery(..., 'season_completed')`.

---

## Devil's advocate

**1 · Someone ends the season by accident, and there's no reopen window.**
Decision D defers reopen-for-corrections, so this is genuinely irreversible in
v1. Mitigations, layered: `btn-secondary` not `btn-primary`; type-the-year gate;
the modal names the champion so a mistimed end is visibly wrong; and the
`alert-warning` that counts the days you're cutting short. The 7-day Discord
warning also means members see it coming.

**2 · "Series name" vs "season name" — two names for one thing.**
Kill it by never having two. Seasons get no editable name; `league_series.name`
is the only name a user ever types, and a season is always a bare year in mono.
This has a backend consequence worth flagging: `LeagueInfoSection`'s rename must
write `league_series.name` (mirroring to `leagues.name`) or renaming will apply
to one season and silently diverge from its siblings.

**3 · Two dropdowns side by side is clutter.**
The season pill is static text until a second season exists, so today's users
see no new control at all. When it does appear, it differs in shape, size, face
and colour from the league switcher, and on mobile the two are on separate
lines.

**4 · Members are auto-copied into a season they never agreed to join.**
They get a notification for a thing they didn't ask for and a league that looks
wiped. Mitigation: the `SeasonWelcomeCard` explains the empty roster before they
can misread it, and the owner's confirm modal states in advance that anyone can
leave. Don't build per-member opt-in — an eight-person league would never reach
quorum, which is exactly why Fantasy Critic copies everyone too.

**5 · Moving `season_end` mid-season silently breaks the reminder.**
Real bug, not a UX nit: the plan makes `season_end_reminder` idempotent via a
partial unique index on `(league_id, notification_type) WHERE movie_id IS NULL`
— which is once per league *ever*, not once per season-end date. Push the end
date out after the reminder fires and nobody is ever warned again. Ask fn-dev-a
to key it per season (include the date or the season year), and post a Discord
`general` note when an owner changes `season_end` on an active league: "The 2026
season now ends Jan 15." Reject dates in the past.

**6 · Ties read as a rendering bug.**
Two gold podium chips both saying `T1` looks broken. The word "Co-champions" in
the banner plus the explicit "Tied on 345.0 pts — both teams hold the title."
caption is the fix; every consumer (banner, history row, Discord, email,
notification) must use the plural wording, not just the standings page.

**7 · The champion banner fights everything else on the page.**
It's gold-gradient on a page that already has gold podium chips, a gold current-
user border and gold point totals. Discipline: `.champion-plate` is the only
gradient on any page, the crown is monochrome and 14px, and on a completed
league the standings page drops its `alert-info` entirely.

**8 · A champion who leaves the league breaks their own trophy.**
`winner_team_ids` points at `teams` rows that a later kick or leave can remove,
and `league_standings` only returns `status='active'` participants — so a past
season's champion can vanish from its own history row. Ask backend to resolve
winner names at completion time (or via a left join that survives), and have
`ChampionBanner` fall back to `2026 champion · team removed` rather than
rendering an empty name.

---

## Build order

1. **Types + `league_standings` wiring.** `League` fields, `SeasonSummary`,
   `StandingRow`; swap `StandingsClient` off `calculateRankings`. Everything
   else reads from here, and it's the only change that touches an existing
   working page — land it first and verify standings are unchanged.
2. **`SeasonSection` + `EndSeasonModal`.** Nothing else can be demoed until a
   season can actually be ended.
3. **`ChampionBanner` + `ChampionCrown` + `.champion-plate`.** The payoff, and
   the piece most worth screenshotting for the PR.
4. **Season pill + season switcher** in `layout.tsx`.
5. **`start-next-season` CTA + `ConfirmStartSeasonModal` + `SeasonWelcomeCard`.**
6. **Notification copy** — enum values, `NotificationBell` icon and href
   branches, Discord embeds, the email template.
7. **`/league/[id]/history`** + the `getVisibleTabs` signature change.
8. **Dashboard `SeriesListItem` grouping.**
9. **`TrophyCase`** in `DashboardSidebar` (+ `my_championships()` if needed).

Steps 7–9 are the ones to cut if the PR gets too large; 1–6 are the feature.
