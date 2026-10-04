# Fantasy Reel native iOS requirements

**Purpose:** implementation handoff for the product owner and an engineering agent building a native app with complete web feature parity.

**Audit baseline:** October 4, 2026; repository `main` at `b576a5a` (the first draft cited `4d13657`, which is not on the remote; a completeness review re-checked the web app at `b576a5a` and added §14–§15). The product name in the repository is **Fantasy Reel**. This document describes source code and checked-in migrations, not a verified production deployment. No live database, provider configuration, or running UI was audited. Older plans and comments are supporting context; current executable code takes precedence when describing existing behavior. Conflicts are recorded in §10 rather than silently resolved.

**Deliverable scope:** requirements only. No iOS project, backend changes, or changes to the published legal pages are included in this document.

**Reading paths:** start with [scope](#1-scope-and-how-to-use-this-document) and [feature requirements](#3-feature-requirements-and-acceptance-criteria) for product planning; use [native foundation](#4-native-client-foundation), [design translation](#5-translate-web-interaction-into-native-ios-design), and [backend contracts](#6-backend-and-data-contract-map) for implementation. Review [launch gaps](#7-additional-launch-requirements-and-gaps), [build sequence](#9-build-sequence-and-work-packages), [open decisions](#10-observed-inconsistencies-and-gaps-to-resolve), and [acceptance tests](#12-verification-and-definition-of-complete-parity) before estimating or starting a work package. Designers should start from the [screen inventory](#15-screen-inventory-for-native-design).

## 1. Scope and how to use this document

Complete parity means an existing user can sign into the same account and perform every currently supported player, commissioner, and authorized administrator workflow against the same leagues and records. Screens may be reorganized; permissions, game rules, results, and access to information must remain consistent. A web view containing the web app does not meet the native-app requirement.

Requirement labels:

- **P — Parity:** existing functionality that must be available at the parity release.
- **N — Native foundation:** new client work needed to deliver existing functionality correctly on iOS.
- **L — Launch requirement:** additional work to resolve platform, privacy, or distribution requirements before App Store release.
- **O — Optional:** a proposed enhancement, not part of current web parity.
- **D — Decision:** a known ambiguity or product choice requiring resolution before its dependent work ships.

The `F-*` feature IDs and `N-*`/`L-*` requirements are stable handoff identifiers. Implementation tickets should cite them and the acceptance scenarios in §12. Delivery phases are sequencing, not permission to omit late-phase features while claiming full parity.

### Recommended starting assumptions

Use Swift and SwiftUI, native navigation and controls, and the official Supabase Swift client through Swift Package Manager. Keep the shared Postgres/Auth/Storage/Realtime/Edge backend. Use UIKit bridges only where necessary, such as a controlled CAPTCHA surface. Pin dependency versions and record the selected Xcode/Swift toolchain at project creation.

Start with an iPhone-first application. Minimum iOS version, iPad support, bundle identifier, Apple Developer team, App Store territories, and whether push ships with version 1 remain decisions in §11. Do not infer an OS minimum from the current web stack. The architecture below does not depend on selecting the newest iOS-only navigation treatment.

### What exists today

| Layer | Current implementation | iOS disposition |
| --- | --- | --- |
| Web client | Next.js 15.3.8, React 19, TypeScript, Tailwind 4; server-rendered reads, server actions, client hooks, SWR caches | Rebuild presentation, routing, and client state natively. Do not treat Next server actions as a public mobile API. |
| Backend | Supabase Auth, Postgres with RLS, SQL RPCs, Edge Functions, Realtime, Storage | Reuse with the signed-in user's identity. Add shared backend capability only for identified gaps. |
| Movies and scores | TMDb discovery/metadata/images; MDBList supplies critic data; Rotten Tomatoes alone determines fantasy points | Keep provider secrets and scoring on the server. Reuse the current movie functions and cached data. |
| Scheduled processing | Vercel Cron calls authenticated proxies for bids, trades, scores, seasons, and announcements | Remains server-operated; no phone needs to be running. |
| Communications | In-app notification rows, Resend email, Discord bot and webhook announcements | Preserve existing delivery from native-originated actions. APNs is additional work. |
| Observability | Sentry, structured Edge logs, request IDs, job/delivery records, Vercel web analytics | Native diagnostics and event adapters must preserve semantics; browser SDKs do not transfer to Swift. |
| Installation | Web manifest and app icons | Does not establish a native app, offline synchronization, or push support. |

## 2. Roles, seasons, and identity

### Access model

| Actor | Required access |
| --- | --- |
| Signed-out visitor | Product introduction, how-to-play, privacy/terms, sign-up, sign-in, confirmation/recovery flows, and safe handling of incoming invitations. Gameplay and movie endpoints currently require authentication. |
| Authenticated user without a league | Own profile/settings, movie search, own wishlist, create/join league, pending invitations. |
| Active league participant | League overview, appropriate draft/season screens, league standings and team information, own gameplay mutations, and permitted shared wishlists. |
| League owner / commissioner | Participant capabilities plus owner tools: invitations, configuration, draft order/start, counterpick-round control, removal before drafting, setup-season deletion, trade approval/veto, announcements, completion, and rollover. |
| Application administrator | Restricted growth statistics through `admin_growth_stats()`, authorized by `app_admins`. This is separate from league ownership. |
| Left/kicked participant or unrelated user | Access is determined by backend policies and endpoint checks. Never infer access from a cached league card or a guessed ID. Clear inaccessible data after refresh. |

The participant type contains `owner`, `admin`, and `member`, but current commissioner endpoints generally check `leagues.owner_id`, not merely `role = admin`. Do not invent a co-commissioner permission model or role-management UI.

### Season model

`league_series.id` identifies the continuing league. Each `leagues.id` identifies **one season**. Team and participant IDs are also per-season; user IDs survive rollover. Every gameplay query and mutation must use the selected season's `league_id`. Cache keys must include account identity and season identity.

```text
setup → drafting → counterpicking → active → completed
                   └─ owner may skip/end remaining counterpicks → active
         └─ activation path depends on configured counterpick slots

completed → start-next-season → a NEW leagues.id in setup, same series_id
```

The draft may be fully picked while the phase still awaits owner action. Derive available actions from the saved phase, configured slots, and current counts; do not assume that filling the board always makes the league active.

| Phase | Player-facing behavior | Owner controls / restrictions |
| --- | --- | --- |
| Setup | Participants, invitations, order, empty team/roster, movie research | Join/invite, setup settings, custom/random draft order, start draft; removal and deletion allowed here only. |
| Drafting | Snake draft, current turn, pick history, research and wishlist | Scoring rule remains editable through drafting. Other setup-only configuration is locked. Start/skip counterpicks only after all draft picks exist. |
| Counterpicking | Reverse-snake opponent selection, remaining counterpick slots | Owner can explicitly end remaining counterpicks; already saved counterpicks remain. |
| Active | Standings, rosters, pickup/counterpick bidding, trading | Trade settings and season-end date remain editable; owner may complete the season. |
| Completed | Final standings, champion/co-champions, history, historical roster/draft | Gameplay is frozen. Rollover creates a new season. No reopen/correction workflow exists. Series rename is a separate permitted operation. |

The web changes league-tab visibility and prominence by phase (`leagueNav.ts`). iOS must keep the same capabilities reachable without reproducing a moving set of global tabs. Current web rules:

| League section | Setup | Drafting | Counterpicking | Active | Completed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Overview | ✓ | ✓ | ✓ | ✓ | ✓ | Opening a league lands on Draft in setup/drafting/counterpicking, otherwise Overview. |
| Draft | ✓ | ✓ | ✓ | secondary | secondary | Becomes a record, not a destination, once the season is active. |
| Roster | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Standings | — | — | — | ✓ | ✓ | |
| Bidding | — | — | — | ✓ | — | Badge shows the user's outbid count. |
| Trading | — | — | — | ✓ | — | Header shows how many trades need the user's response. |
| History | 2+ seasons | 2+ seasons | 2+ seasons | 2+ seasons | 2+ seasons | Hidden until the series has a second season; always secondary. |
| Settings | owner | owner | owner | owner | owner | Members have no settings or read-only rules view today; iOS v1 adds League Rules for everyone (D-09). |

## 3. Feature requirements and acceptance criteria

Each subsection identifies the supported behavior, its native translation, and a minimum acceptance check. The source catalog in §13 provides implementation entry points.

### F-01 · Introduction, help, legal, and support — P

- Provide a concise native welcome experience explaining movie leagues, drafting, counterpicks, Fantasy Budget, points, and seasonal competition. Preserve access to the full how-to-play material available publicly at `/how-to-play` and to signed-in users at `/help`.
- Provide privacy policy, terms, support contact, and movie-data attribution from onboarding and Settings/About. Preserve the current minimum-age wording and the notice accepting Terms beside **every** account-creation path, including social sign-in that can create an account.
- The service is free entertainment. Budget units, bids, points, and rankings have no monetary value; the Terms prohibit paid-entry leagues, wagers, and cash prizes. Do not introduce purchases, payouts, or wallet UX.
- Marketing scroll effects, SEO metadata, site footers on every screen, and landing-page demo scenes need not be copied. Their useful explanation and links must remain available.

**Accept:** a signed-out person can understand the game and reach legal/support information without creating an account. New-account actions visibly carry the legal notice. Sources: [help](../apps/frontend/app/components/HowToPlayContent.tsx), [legal notice](../apps/frontend/app/components/legal/LegalNotice.tsx), [Terms](../apps/frontend/app/terms/page.tsx), [Privacy](../apps/frontend/app/privacy/page.tsx).

### F-02 · Authentication and recovery — P + N

- Email/password registration collects display name, email, password, and confirmation. Preserve password matching and the current six-character minimum, while honoring any stronger server policy. Show the email-confirmation state and resend action.
- Email/password sign-in, Google sign-in, Discord sign-in, sign-out, persistent sessions, expired-session recovery, and provider cancellation/errors are required.
- Forgot-password requests, email links, reset-password entry, confirmation, and authenticated password change must work. Password change currently reauthenticates with the old password; OAuth-only users are directed through password recovery to establish one.
- Preserve non-enumerating responses for reset/resend, rate-limit feedback, and CAPTCHA failure/retry. Do not report a security-check failure as “email sent.”
- Google and Discord account linking/unlinking must preserve the same Supabase user and their league history. Do not allow disconnecting the only usable sign-in method.
- Duplicate-account recovery currently offers password verification to link a new OAuth duplicate to the existing email account, or keeping the accounts separate. This is a restricted recovery flow, not general merging of two established accounts.
- Existing merge protections include proof of both authenticated sessions, matching email, supported provider, a duplicate less than one hour old, and no league ownership or membership on the duplicate. The web's 10-minute HTTP-only linking cookie is orchestration that iOS cannot reuse directly.

**Native:** Keychain-backed session persistence; authentication through the system authentication session; secure callback processing; password AutoFill/content types; explicit loading/disabled states. Retain pending invitation/deep-link intent through login, signup, provider round-trips, and cold launches. Never put access tokens, passwords, or duplicate-session proof into navigation URLs or logs. Native callback, CAPTCHA, and duplicate-recovery gaps are N-02/N-03 and §10.

**Accept:** the same existing account and league IDs appear on web and iOS after each supported sign-in method. Recovery works after the app is terminated, an expired callback is recoverable, a cancelled provider login leaves the prior session intact, and a duplicate-recovery attempt cannot claim another user's account. Sources: [authentication actions](<../apps/frontend/app/(public)>), [callback](../apps/frontend/app/auth/callback/route.ts), [linking](../apps/frontend/app/auth/link-account/actions.ts), [merge endpoint](../supabase/functions/merge-accounts/index.ts).

### F-03 · Account profile and appearance — P

- View account email; edit display name (trimmed, 1–100 characters); upload, replace, and remove a profile image. Email editing is currently support-assisted, not self-service.
- Preserve initials/fallback avatars and provider-derived initial profile information.
- Profile storage: public `avatars` bucket, path under the authenticated user ID, unique image filename, PNG/JPEG/WebP/GIF, maximum 2 MiB. URLs are publicly accessible; do not describe them as private uploads.
- Appearance has **System**, **Light**, and **Dark**, defaults to System, and is saved on the device. Include both existing brand palettes; “Cinematic Dark” does not mean dark-only.
- Include connected-account and password controls from F-02. Account deletion is additional launch work, L-02.

**Native:** grouped settings, PhotosPicker and a file-import option where needed to preserve accepted formats. Convert an unsupported HEIC selection to a supported upload format and verify final size; report upload failure without losing the prior image. Do not require broad photo-library access just to choose one image. Store theme preference locally, separately from secure credentials.

**Accept:** profile and image changes appear on the web after refresh; replacing/removing an image has a recoverable failure state; system theme changes update the app while open; long display names remain readable. Source: [account settings](<../apps/frontend/app/(authenticated)/settings>).

### F-04 · Home, league directory, and switching — P

- List the user's accessible leagues grouped by continuing series, with the current running season or most recent completed season as the entry point. Do not render each past season as an unrelated league.
- Show league/season status, appropriate ownership/team context, pending invitations, and title/trophy history. Preserve empty states guiding people to create or join.
- Switch leagues and switch among accessible seasons of a series. Preserve historical season access according to RLS; joining a later season does not automatically grant every earlier season.
- Show champions/co-champions and the prior season's reigning champions where the web does. Resolve reigning champions by user identity, not the new season's team IDs.

**Native:** a Leagues root screen with searchable/list-style league selection as appropriate, a season menu within a league, and navigation restoration keyed by season ID. A pending invitation should remain actionable after returning from authentication.

**Accept:** a three-season series produces one league entry and three accessible season choices; an unrelated or inaccessible season never appears from a shared cache. Sources: [dashboard](../apps/frontend/app/components/DashboardClient.tsx), [league manager](../apps/frontend/app/components/LeagueManager.tsx), [trophies](../apps/frontend/app/components/TrophyCase.tsx), [season queries](../apps/frontend/utils/seasonQueries.ts).

### F-05 · Create, join, and invite — P

- Create a league and the owner's participant/team, including league name, optional team name, invite-only choice, participant limit, and the roster/counterpick options exposed by the current creation form. Subsequent configuration uses F-15.
- Join through an email invitation token or a six-character share code; allow optional team name. Direct `league_id` join is an API capability for open leagues, not evidence of an existing public matchmaking directory.
- Six-character codes exclude ambiguous characters and are case-insensitive. Normalize input like the web. A shared code can admit someone to an invite-only league; it is different from an email-bound invitation.
- Owner: search existing users by display name, invite a selected user or email address, list invitation state, resend eligible invitations, cancel, generate/regenerate a share link, copy/share code and link. Existing-user search must not expose the person's full email through a username invitation.
- Recipient: see pending invitations, join/accept, or decline. Show invalid, expired, cancelled, declined, wrong-account/email, full-league, already-member, and draft-started outcomes.
- Joining, inviting, and link generation are restricted to setup. Resending rotates the invitation token and expiry. Regenerating a code invalidates the old one. Membership is rechecked on the backend if draft start races a join.
- Creation/join can return success with a `warning` when participant/team setup is incomplete. Re-read state and expose a recovery path; never blindly create a second league to retry a partial success.

- `send-invite` and `resend-invitation` are rate-limited per owner (`consumeInvitationEmailAllowance`); a throttled request returns a rate-limit response. Show it as "try again later", not as a failed invitation or a generic error.

**Native:** ShareLink/system share sheet, paste-friendly code entry, confirmation identifying the signed-in account, and native invite forms. No Contacts permission is needed for manual email/name entry.

**Accept:** a link received in email works with the app installed and has a web fallback without it. A different-email account cannot use an email-bound token; an obsolete code fails; double taps do not create two requests. Sources: [join screen](<../apps/frontend/app/(authenticated)/join/JoinLeagueClient.tsx>), [invite UI](<../apps/frontend/app/(authenticated)/league/[id]/components/InviteModal.tsx>), [invitation list](<../apps/frontend/app/(authenticated)/league/[id]/components/InvitationsList.tsx>), [join endpoint](../supabase/functions/join-league/index.ts).

### F-06 · Movie research and detail — P

- Global Movies: title search, optional year filter, clear search/filter, paginated results, loading, no-results, provider failure, and movie detail. Current global search is not restricted to draft-eligible upcoming films.
- League movie discovery: tabs All Movies, Trending, Releasing Soon, and Wishlist; title search; genre filters; and release windows labelled Next 30 Days, Next 90 Days, This Year, and a default "Through {current year + 2}" range. Keep unsupported filter combinations explicit; title search does not magically support all browse filters. Wishlist title filtering is local.
- Supply the selected `season_year` for league discovery. Eligibility rejects unknown dates, releases before that season's year, past releases, cancelled/unavailable films, and already-held choices where relevant. Later-year films are not universally excluded by the current eligibility helper; do not assume an exact-year restriction.
- Use the current canonical metadata checks before drafting/bidding. Provider failure is an error/retry state, not proof that a movie is unavailable or a license to invent metadata.
- Movie detail includes poster/backdrop, title/year, release date, overview/tagline, genres, runtime, director, top cast, and IMDb link when present. League contexts add relevant score, ownership, wishlist, and gameplay action information.
- Franchise research includes collection name, installment position, prior-film RT history, average and latest RT context, and a points projection based on series average and the league's scoring rule. Prior history is capped to the most recent eight earlier released films; standalone/first entries can have no history. Mark projections as hypothetical, never actual points.
- Preserve wishlist actions from movie research and league previews. There is no implemented trailer player or streaming/watch-provider booking flow to port.
- Discovery preserves upstream page identity even if eligibility filtering empties a page. `has_more`/pagination, not the number of visible cards, determines whether more results are available. Upstream total matches are not an eligible-movie count. Do not restore removed TMDb star/vote/minimum-rating controls as fantasy scoring.

**Native:** system search field, filter sheet, lazy poster grid/list, and a pushed detail screen or deliberate detail sheet. Cache/downsample posters; provide missing-image placeholders. Render franchise charts with an equivalent accessible text/list representation.

**Accept:** search switching never shows old results as matches for the new filter; an empty upstream page can advance; next-30-days works across December/January; unknown release dates are explained; missing franchise data does not block research. Sources: [global search](<../apps/frontend/app/(authenticated)/movies/MovieSearchClient.tsx>), [league picker](<../apps/frontend/app/(authenticated)/league/[id]/components/MoviePicker.tsx>), [discovery hook](<../apps/frontend/app/(authenticated)/league/[id]/hooks/useDraftMovies.ts>), [detail](../apps/frontend/app/components/MovieDetailBody.tsx), [franchise panel](../apps/frontend/app/components/FranchiseHistoryPanel.tsx).

### F-07 · Wishlist and sharing — P

- A wishlist belongs to the user across leagues; it is persisted in `wishlisted_movies`, not a draft-local favorites list.
- Add/remove movies, display poster/title/date added, sort by date added or title, and retain wishlist state across research surfaces.
- Optional league context labels a movie Available, Yours, or held by another team. Use all active `team_holdings`, including pickups, not draft picks alone.
- Sharing is off by default. `profiles.wishlist_public = true` means visible to **active members of shared leagues**, not public on the internet. Allow selecting a league mate's shared wishlist, showing movie counts and overlaps with your own.
- Keep optimistic heart feedback reversible on failure and suppress duplicate toggles while saving. Do not expose private results from prior users or prior sharing settings through disk caches.

**Accept:** a private wishlist is unreadable by another league member; enabling sharing makes it visible only under the shared-league policy; switching leagues updates ownership badges; a failed remove restores the item. Sources: [wishlist provider](../apps/frontend/hooks/useWishlist.tsx), [wishlist screen](<../apps/frontend/app/(authenticated)/wishlist/WishlistClient.tsx>), [sharing policy](../supabase/migrations/20260217_fix_wishlist_participant_status.sql).

### F-08 · Draft setup and live draft — P + N

- Display participant/team order, draft rounds and picks, current turn, upcoming pick queue, progress, pick history, and owner start action. Draft rounds equal `draft_slots`; order is snake, alternating direction each round.
- Owner can randomize or manually reorder active participants before start. If no custom order is set, the start path can randomize it. Minimum participant and valid-team checks remain server-enforced.
- A player can research while waiting but can commit only their current turn. Already-picked movies and changed availability must be clear without shifting a card out from under a tap.
- Native draft submission must send `{ league_id, tmdb_id, expected_pick, request_id }`: `expected_pick` is the absolute one-based slot and `request_id` is a UUID for that logical attempt.
- A 30-second request deadline covers token lookup, transport, and response read. A timeout has an uncertain result. Refresh the draft and keep the same attempt UUID for an uncertain retry; a new UUID risks another mutation on a later turn. On stale-turn conflict, reconcile before enabling another pick.
- Refresh the coherent draft state after joining the subscription, reconnecting, foregrounding, auth refresh, network recovery, and mutation. Show connected/reconnecting/periodic-update/error state honestly. Current web uses 5-second reconciliation while connected and a 10-second polling fallback; see N-05 for native lifecycle handling.
- There is **no implemented per-pick timer, auto-pick, commissioner pick-on-behalf, undo pick, or automatic scheduled draft end**. A stored start/end date is not such a feature.

**Native:** a compact turn banner and clear Pick action, a movie-selection screen, a read-only draft-history list, and optional wider board on iPad. Announce turn changes accessibly; do not require horizontal spreadsheet navigation for the critical action.

**Accept:** web user A and iOS user B complete a snake draft; simultaneous/duplicate submissions save at most one pick for an attempt; lost responses reconcile without double-picking; a backgrounded device resumes on the correct turn. Sources: [draft client](<../apps/frontend/app/(authenticated)/league/[id]/draft/DraftClient.tsx>), [state recovery](../apps/frontend/hooks/useDraftState.ts), [draft endpoint](../supabase/functions/draft-pick/index.ts), [submission parsing](../supabase/functions/_shared/draft-submissions.ts).

### F-09 · Draft counterpick round — P

- After all draft picks exist, owner can start the configured counterpick round or skip it. Owner can end the remainder with confirmation when already counterpicking; saved picks remain.
- Counterpicks follow reverse snake order and configured draft counterpick slots. Show eligible opponent movies grouped by team, current turn, remaining picks, selections, and score implications.
- A counterpick is an independently owned asset that scores the inverse of the target movie's league points. It is not a second roster holding and does not consume a movie slot.
- Submit `{ league_id, movie_id, expected_pick, request_id }` to `make-counterpick`; apply the draft retry/reconciliation contract. The draft counterpick round is distinct from active-season budget bidding.
- Draft and draft-counterpick actions are not subject to the pre-release score lock that forbids bids/trades. Continue applying their own server eligibility rules.

**Accept:** order and counts match web, no team counterpicks its own movie, an empty eligible-options state lets the commissioner finish the round, and activation initializes the season once. Sources: [counterpick round](<../apps/frontend/app/(authenticated)/league/[id]/components/CounterpickRound.tsx>), [counterpick endpoint](../supabase/functions/make-counterpick/index.ts), [round start](../supabase/functions/start-counterpick-round/index.ts), [round skip](../supabase/functions/skip-counterpick-round/index.ts).

### F-10 · League overview and team identity — P

- Show selected league/season and phase, own team name/image, rank, counted points, available Fantasy Budget where applicable, own movie timeline, and league-wide upcoming releases with the holding team/player.
- Preserve state-specific guidance: setup/draft entry, carried-over season welcome, completed-season champion banner, and links into roster, standings, and appropriate actions.
- Edit own team name (trimmed, 1–100 characters), upload/replace/remove its avatar. `team-avatars` is a public bucket under the team ID, with the same 2 MiB/file-type constraints as profile images.
- Reflect both drafted movies and auction pickups in the overview; do not omit pickups from release timelines or ownership displays.
- Other overview states to carry over: a "Welcome to {league}" waiting card while setup is still in progress, a banner when league-mates have shared wishlists (links to the shared-wishlist view), and the "Around the league" upcoming-release board. The new-season welcome card is dismissed per league and remembered on the device.
- Tapping a movie in the overview opens league movie detail, which also offers Drop with a confirmation that states drops remaining (F-11).

**Accept:** a winning pickup appears in overview and roster on the other client; team edits update all league views; a completed season uses its frozen result. Sources: [overview queries](<../apps/frontend/app/(authenticated)/league/[id]/dashboard/page.tsx>), [overview presentation](<../apps/frontend/app/(authenticated)/league/[id]/dashboard/DashboardClient.tsx>), [team actions](<../apps/frontend/app/(authenticated)/league/[id]/dashboard/actions.ts>), [team editor](<../apps/frontend/app/(authenticated)/league/[id]/components/EditTeamModal.tsx>).

### F-11 · Roster and drops — P

- Show own active roster with drafted holdings, pickups, and counterpicks as distinct groups; metadata includes acquisition context, release date, RT/points, pending/pre-release state, and counterpick relationships. Keep capacity and drops remaining visible.
- Read active movie holdings from the flat `team_holdings` view. Use `holding_id` plus `source` to select the correct drop/trade asset; a TMDb ID or movie ID is not a holding ID.
- Drops are active-season actions, require ownership and remaining drop allowance, and show explicit confirmation and the affected movie. Dropped rows leave active rosters but remain in history/base tables. Drops do not refund acquisition spending.
- Explain blocked drops inline: inactive/completed season, release-date restriction, applicable awarded/pending counterpick restriction, or exhausted allowance. Do not let a disabled icon be the only explanation.
- Existing counterpicks survive a permitted drop and continue scoring; do not delete them along with the holding. The exact release-day and configurable counterpick behavior has documentation conflicts recorded in D-01/D-02.

**Accept:** dropping a drafted movie and dropping a pickup both free pooled capacity, increment the drop count once, disappear from all active roster views, and retain the expected counterpick history. A rejected drop leaves the roster intact. Sources: [roster](<../apps/frontend/app/(authenticated)/league/[id]/roster/RosterClient.tsx>), [drop explanations](<../apps/frontend/app/(authenticated)/league/[id]/roster/dropRules.ts>), [drop endpoint](../supabase/functions/drop-movie/index.ts), [holdings types](../apps/frontend/utils/holdings.ts).

### F-12 · Pickup and counterpick bidding — P

- Bidding is available in active seasons. Show remaining budget, pooled roster capacity, counterpick capacity, week/cutoff timing, your active bids, your outbid offers requiring attention, other active contests, and bid history.
- Pickup bids target available movies by `tmdb_id`; counterpick bids target another team's held movie by internal `movie_id`. Both use the same Fantasy Budget, but their slot pools differ.
- Place a bid, raise your own bid, counter a rival, and cancel while permitted. Current amount validation is a whole number from 0 to 100, within remaining budget, and strictly greater than an existing highest bid. Zero is valid for an uncontested movie.
- Opening a bid does not debit the budget. Outbid offers remain committed candidates until cancelled or resolved. Do not equate `outbid` with “safe to forget.”
- The weekly processing deadline is Saturday 20:00 UTC. New-bid cutoff defaults to 48 hours earlier; 0 disables it. After cutoff, only raises/counters on existing contests are allowed, and cancellations are locked. A bid past its own processing deadline also cannot be cancelled even after the week rolls over.
- An outbid team has its stored response deadline. A still-open response window can hold the whole contest beyond weekly processing; the extended worker checks hourly. Show waiting-for-counter-window vs awaiting-processing accurately.
- Support separate priority reordering for the team's pickup bids and counterpick bids. Priority controls which of its own possible wins fit, never whether it outranks a competing higher bid. Save through the priority endpoints.
- Pickup bids may attach at most one conditional drop, naming a draft holding or pickup. A free slot is used first; the drop is only executed if needed to accommodate a win. Losing bids do not drop a movie. A target that becomes ineligible degrades to a plain bid, which may still win if space is available.
- Pending bids may exceed capacity. Pickup placement does not require a free movie slot; counterpick placement still requires at least one unfilled **awarded** bidding-counterpick slot, although pending offers can exceed the remaining slots. At processing, recheck pooled holdings, shared budget, drop allowance, target ownership, and counterpick capacity after awards. An eligible runner-up can win at its own amount if a higher bidder cannot be honored. The server resolver remains authoritative.
- A scored movie is locked against both bid types even before release. An existing pending bid can be cancelled by processing, uncharged, with `movie_scored`. Released, dropped/missing, self-owned, capacity, and budget failures have distinct reasons.
- History shows settled pickup and counterpick contests grouped by processing round/date, winner and cost, unsuccessful competitors, and additional earlier rounds. The web history excludes cancelled bids; durable cancellation/rejection reasons still exist and must be handled when displayed. Do not manufacture an outcome for a still-pending processing failure.

- Screen structure on web: Active and History sub-tabs, a budget display, and a "Bidding week" timeline of the current week's cutoff and processing. Active groups bids into **Action Required** (you've been outbid), **My Active Bids**, and **Competing Bids**.
- The place-bid sheet has two modes. Before the new-bid cutoff it is a movie search with a wishlist source. After the cutoff it becomes a fixed list of contests already running, labelled "New bids closed {time}", because only raises and counters are legal.
- The conditional-drop choice defaults to "Nothing — keep my whole roster" and lists droppable holdings.
- **Fit forecast:** the bid sheet and the priority list show which bids would fit if they all won, using a "Roster runs out" cut line and marking whether each bid uses an open slot or its conditional drop (`bidFitForecast.ts` `forecastBidFits`, including remaining drop allowance and target eligibility). This is client-side logic that iOS must port to Swift. Keep it checked against the resolver with the same fixtures as `scripts/tests/bid-fit-forecast.test.cjs`, and label it a forecast; the server result is authoritative.

**Native:** bid sheets with integer entry/steppers, prominent budget and timing, confirmation of any conditional drop, and accessible reorder controls. Preserve current in-league visibility; comments calling bids “blind/sealed” do not match all web/API behavior (D-03).

**Accept:** run the same mixed pickup/counterpick contest with web and iOS bidders; exactly the same winners, spend, remaining slots, and loss reasons appear. Test cutoff boundaries, an extended contest, zero bids, over-capacity priorities, a reused drop target, and a scored movie. Sources: [bidding hook](<../apps/frontend/app/(authenticated)/league/[id]/hooks/useBidding.ts>), [bid window](../supabase/functions/_shared/bid-window.ts), [resolver](../supabase/functions/_shared/bid-resolution.ts), [place pickup](../supabase/functions/place-bid/index.ts), [place counterpick](../supabase/functions/place-counterpick-bid/index.ts), [history](<../apps/frontend/app/(authenticated)/league/[id]/hooks/useBidHistory.ts>).

### F-13 · Trading — P

- Show Pending, My Trades, All Active, and History views, action-needed counts, counterparties, offered/requested assets, messages, budget, current status, review/expiry times, and contested-item markers.
- Compose a trade with a league opponent. Each side can include drafted holdings, pickups, counterpicks, and whole Fantasy Budget amounts. At least one asset or positive budget amount must exist across the offer; do not invent a mandatory equal-size or both-sides-nonempty rule.
- Preserve item identity `{ movie_id, source, source_id }`, with `source` equal to `draft_pick`, `pickup`, or `counterpick`; `faab` remains the JSON key for budget.
- Propose, accept with a full give/receive confirmation, reject, counter, cancel as authorized, and extend an eligible unanswered offer. A counteroffer changes the sides and who can respond; derive controls from the latest offer, not the original initiator cached on screen.
- Distinguish three clocks: unanswered offer expiry; post-accept commissioner review; and the inclusive season trade-deadline date. Offer windows support no expiry, fixed instant/preset/custom date, or a selected unreleased movie's release date. Release anchors can move when provider dates move and are bounded by league rules.
- Default offer-window settings are 48 hours, minimum 1 hour, maximum 14 days unless the league overrides them. `null` league settings mean app defaults; a null offer expiry means an offer without its own expiry. Do not conflate these null semantics.
- Acceptance with review enabled enters `review`; owner can veto with a reason or approve and execute immediately. Without review it enters `accepted`, awaiting server processing. A successful acceptance is **not** proof that assets have moved. Current processing cadence is every five minutes.
- Permit competing open offers naming the same asset. Execution rechecks live ownership, budget, slots, scoring locks, and counterparties under database locks. A competing execution can invalidate an offer; contested markers must not be interpreted as a reservation.
- Trade eligibility locks a movie and its counterpick when `fantasy_points` is non-null, including zero and pre-release scores. The current item validator does not independently forbid an already-released **unscored** holding; offer-release anchors and league deadlines still apply. Do not reuse the draft/bid upcoming-movie filter for trades.
- A team must not end a trade owning a movie and its counterpick. Judge this after both sides move: a movie/counterpick swap can be valid. Counterpick phase capacity and pooled movie roster capacity are separate constraints.
- Display server validation messages and mark rows named in `invalid_source_ids`; preserve the draft composer for repair. Completed/rejected/cancelled/vetoed/expired states and expiry reasons must be understandable.

- The offer-expiry picker offers no expiry, a fixed time (preset or custom), or "until a movie's release"; the review-confirmation step for acceptance lists exactly what each side gives and receives.

**Native:** a full-screen or large-sheet composer with sequential team/asset selection and an unambiguous “You give / You receive” review. Avoid nested web-style modal stacks. Preserve unsent changes across child selectors and confirm discarding edits.

**Accept:** trade on iOS, respond on web, then see the same eventual transfer. Verify owner approval/veto, no-review pending execution, counteroffers, window extension, moving release anchor, competing offers, scored assets, over-capacity trades, and legal/illegal counterpick transfers. Sources: [trading hook](<../apps/frontend/app/(authenticated)/league/[id]/hooks/useTrading.ts>), [composer](<../apps/frontend/app/(authenticated)/league/[id]/components/ProposeTradeModal.tsx>), [validation](../supabase/functions/_shared/trade-validation.ts), [expiry](../supabase/functions/_shared/trade-expiry.ts), [trade read API](../supabase/functions/get-trades/index.ts).

### F-14 · Scores, standings, and team comparison — P

- Read authoritative team totals and rankings. Standings use competition ranks (`1, 2, 2, 4`), mark ties, highlight own team, show team/player identities and budgets, and let users inspect every permitted team's drafted movies, pickups, and counterpicks.
- Only Rotten Tomatoes Tomatometer drives fantasy points. `combined_score` is the RT percentage despite its legacy name. IMDb/Metacritic are supporting data, not scoring inputs. Missing RT means Pending/null, not zero. A 60% movie legitimately scores zero and is score-locked.
- Default examples: RT 96 → 36 points; 84 → 24; 60 → 0; 35 → −16.25. Below 50, the penalty slope halves per ten-point band. With the season's double-over-90 option, 96 → 42. Counterpicks invert the season's points.
- `movies.fantasy_points` stores the default curve. `team_holdings.fantasy_points`, `counterpicks.fantasy_points`, and team totals already apply the season rule. Do not apply the bonus twice.
- A pre-release score is visible, muted, and labeled “at release”; it contributes to totals only from release date in UTC. It already locks bids and trades. These are independent rules.
- Preserve server precision for calculations/comparisons and current display rounding. Do not sum rounded card values or use rounded points to decide ties. Swift negative-half rounding needs explicit parity tests against JavaScript display helpers.
- Completed-season ranking and winners come from `final_standings` and `winner_team_ids`; fall back to the live standings RPC only for older records without a snapshot. Historical results retain removed participants and owner names. Live movie metadata can evolve; do not recalculate a historical champion locally.

- The standings screen also shows a summary strip (Movies, Scored, Pending), a champion banner on completed seasons, and a crown on last season's champions. Selecting a team opens its detail with every movie, which opens league movie detail.

**Native:** readable ranked rows leading to team detail; an iPad detail column if supported. VoiceOver should read rank, tie, points, budget, and pending/pre-release state without relying on color. Sources: [standings](<../apps/frontend/app/(authenticated)/league/[id]/standings>), [score display/helpers](../apps/frontend/utils/scoring.ts), [season results](../apps/frontend/utils/seasons.ts), [scoring architecture](../supabase/SCORING.md).

**Accept:** fixtures include null, zero, negative, fractional, pre-release, double-over-90, tied first place, and a removed historical champion. All produce the same result on web and iOS.

### F-15 · Commissioner settings — P

Provide every existing settings section, its current value, validation, save progress, error, and explanation when locked. Server checks are authoritative even if the UI hid the control.

| Section / setting | Current editable window and constraints |
| --- | --- |
| League identity | Series name, trimmed/nonempty, update maximum 255 characters; rename applies across seasons. Invite-only is stored per season. |
| Participants | Maximum 2–20 and not below active count; setup-only. Remove another active participant in setup; cannot remove the owner. |
| Draft order | Randomize or reorder all active participants once each; setup-only. |
| Movie capacity | Total slots 1–20; draft slots 1 through total slots; setup-only. Defaults in schema: total 8, draft 5. |
| Drops | 0–10 per team/season; default 2; setup-only. |
| Bid response window | 1–72 hours; default 24; setup-only. |
| New-bid cutoff | Integer 0–144 hours before processing; default 48; 0 disables; setup-only. |
| Counterpicks | Draft slots default 1, bidding slots default 0; setup-only. Create permits draft 0–5 and bidding 0–3; update permits both 0–5. Resolve this inconsistency in D-04 before finalizing a unified form. |
| Counterpick drop blocking | Boolean; default true; setup-only. See D-02 for the actual award/pending behavior. |
| Scoring | Double points over RT 90%; default off for new seasons; editable in setup/drafting, locked afterward; persisted old seasons may be on. A change triggers server rescoring. |
| Trading | Enabled, optional deadline (`YYYY-MM-DD`, inclusive and no later than season end), review enabled, review hours 0–168; editable until completion. |
| Offer expiry bounds | Nullable overrides: default 1–2160 hours, minimum 1–168 hours, maximum 1–90 days; effective minimum ≤ default ≤ maximum. Null restores app defaults. |
| Season | Year is this or next UTC year, setup-only. Changing year alone resets end to December 31. End is a valid date today or later and must not precede an existing trade deadline; editable until completion. |
| Joining | Generate/regenerate code and link during setup; show locked state afterward. |
| Discord announcement | Owner enters 1–1500 characters and posts to linked channels; show actual channel-count/no-linked-channel result. |
| Finish/delete | End an active season through F-16; delete only a setup season with explicit confirmation. These are separate operations. |

Confirmation strength must match the web: deleting a setup season requires typing the league name, ending a season requires typing the season year, and removing a participant has its own confirmation. The Scoring section explains the double-points rule with a worked example, including the inverted counterpick result; keep that explanation.

The current schema includes `faab_budget` and defaults budgets to 100, but the current web settings do not expose a budget-amount editor. Read the stored value and balances; do not add an editor based only on a database column.

**Native:** grouped settings with focused edit screens, steppers/pickers and date-only editors. Put irreversible actions in a clearly labeled section, require the same deliberate confirmations, and identify the affected season by name/year.

**Accept:** a non-owner cannot invoke owner actions through direct requests; a race with phase transition returns a useful refusal; all saved values round-trip to the web and lock at the same phase. Sources: [settings composition](<../apps/frontend/app/(authenticated)/league/[id]/settings/SettingsClient.tsx>), [update dispatcher and validation](../supabase/functions/update-league/index.ts), [creation validation](../supabase/functions/create-league/index.ts).

### F-16 · Completion, history, and next season — P

- Owner can end an active season manually; the completion job also ends due active seasons. Show consequences before confirmation: final scoring/ranking, champions, frozen gameplay, cancellation of pending bids, and expiration of open trades.
- Save/display every co-champion, final standings, completion date, historical results, and season switcher. The history screen summarizes champions and leading finishers by season; trophy displays link back to the relevant result.
- Start Next Season is owner-initiated after completion. It creates the next year of the same series, copies settings and active participants/team names/images, and starts empty rosters. Left/kicked participants are not silently re-enrolled.
- Reset draft dates/order, trade deadline, join credentials, winners, and final standings for the new season. Budgets/scores initialize on activation rather than being available to spend during setup.
- Discord channel mappings move to the new season with preferences preserved. Season-start notifications target the new season ID.
- Handle an already-created next season/409 by navigating to the existing season, not duplicating it. There is no season-reopen or keeper-draft feature.

**Accept:** complete a tied season with pending bids and trades, roll over once from two devices, verify the old table remains frozen and the new season has new participant/team IDs and no holdings. Sources: [history page](<../apps/frontend/app/(authenticated)/league/[id]/history/page.tsx>), [completion](../supabase/functions/_shared/league-completion.ts), [rollover](../supabase/functions/start-next-season/index.ts), [transactional lifecycle](../supabase/migrations/20260911152923_harden_season_completion.sql).

### F-17 · In-app notifications, email, and Discord — P; push O

- Provide the existing notification inbox semantics: latest notifications, unread count, mark one read on opening, mark all loaded unread notifications read, title/body/time, and relevant destination. Current web fetches the latest 50 and does not implement a live subscription in `useNotifications`; do not claim an unlimited/realtime inbox already exists.
- The web bell shows an unread badge capped at "9+" and refetches when opened.
- Handle current event types: outbid, bid won/lost, newly available pickup, trade proposed/countered/accepted/rejected/cancelled/completed/vetoed, season completed/started. Decode future types without crashing and fall back to the league or inbox.
- Use notification payload IDs to route to a native bid, roster, trade, or season destination where available. Preserve compatibility with legacy `/league/{id}?tab=bidding` URLs. A notification can point at an asset or permission that has since changed.
- Native mutations must continue triggering existing server email and Discord behavior. Delivery failure after a successful game mutation must not make the client resubmit that mutation.
- Preserve commissioner announcements (F-15). Discord channel linking, notification toggles, and bot-administration roles are currently managed through Discord commands, not a web settings editor. Provide clear help/open-Discord access rather than pretending those are existing mobile REST endpoints.
- Ecosystem capabilities to preserve: `/league`, `/league-options`, `/standings`, `/roster`, `/my-team`, `/movie`, `/top-available`, `/upcoming`, `/current-bids`, `/bid-results`, `/set-league`, `/remove-league`, `/configure`, `/set-bid-alert-role`, `/set-bot-admin-role`. These remain in the Discord bot; iOS parity does not require reimplementing its command dispatcher.
- Server announcements include draft progress, bids/results/cutoff, trade activity/expiry reminders, scoring, release-day/weekly releases, season final results and rollover, according to configured channels and preferences. Do not promise every event goes to every channel.

**Accept:** the same notification becomes read across clients after refresh; tapping an old notification recovers gracefully; a native draft pick or bid produces the existing configured server-side side effects. Sources: [notification hook](../apps/frontend/hooks/useNotifications.ts), [bell/routes](../apps/frontend/components/NotificationBell.tsx), [event types](../apps/frontend/types/index.ts), [bot commands](../apps/discord-bot/src/commands), [cron configuration](../apps/frontend/vercel.json).

### F-18 · Restricted growth dashboard — P

- Full role parity includes the existing `/admin` surface for authorized application administrators, even though regular users do not see it.
- Display total/new users and leagues, active users over 7/30 days, roster totals split by draft/pickup, weekly cumulative growth, monthly signups/league creation, league/user funnels, gameplay counts (last 30 days/all time), newest leagues and users, and generated-at timestamp.
- Authorization must come from `admin_growth_stats()`/`app_admins`. Do not grant access because someone owns a league or has a client-side admin flag. This dashboard is read-only; it is not a user-management console.

**Native:** restricted destination under account/operations navigation, native charts with accessible summaries, and vertically readable rows instead of wide HTML tables. Omitting this surface requires an explicit scope decision and means the release has player/commissioner parity, not literal complete parity.

**Accept:** a permitted admin sees matching values and timestamps; an ordinary user cannot retrieve them. Sources: [admin route and UI](<../apps/frontend/app/(authenticated)/admin>), [authorized RPC](../supabase/migrations/20261004120000_admin_growth_stats.sql).

## 4. Native client foundation

### N-01 · Application structure and configuration

Recommended module boundaries: app/session and routing; shared design components; typed API/repositories; and feature areas matching F-01–F-18. Keep game calculations and eligibility adapters testable outside views. Start in a separate native directory such as `apps/ios/`; this is a proposed location, not an existing project.

- Use separate development, staging/TestFlight, and production configurations. Bundle only the intended public Supabase URL/key and public configuration. Never ship the service-role key, movie-provider keys, cron secret, email credentials, or Discord webhook URLs.
- Reuse the same Auth user IDs, season IDs, API contracts, and database. A second iOS-only database would break parity.
- Keep snake_case wire fields, `faab`, and backend enum values stable while exposing friendly Swift names and “Fantasy Budget” in UI. Generate/check database types from the chosen schema, then define explicit DTOs for function payloads and view projections. The current handwritten TypeScript types do not describe every persisted column.
- Validate deployed schema/functions against the chosen source baseline before integration. Existing `verify_jwt = false` function configuration relies on **internal authentication**; it does not authorize anonymous gameplay.

### N-02 · Sessions, OAuth, and incoming links

Use the official SDK's supported native OAuth flow with a system authentication session, persistent Keychain-backed credentials, serialized token refresh, and explicit signed-out/recovery states. Google/Discord provider setup and Supabase redirect allowlists must support the chosen native callback. Do not assume web cookies will sign the app in, or that an embedded browser shares the native session. [Supabase native linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), [Swift OAuth API](https://supabase.com/docs/reference/swift/auth-signinwithoauth).

Define one typed router for cold/warm launches, pending unauthenticated destinations, notifications, and shared links. Support invitation code/token links, league/season destinations, settings, movies, wishlist, and help; recognize the existing notification query-tab format. Validate host, path, IDs, and redirect destinations; authorize the destination again after login. An expired invite, deleted season, or revoked membership needs a recoverable screen.

Prefer Universal Links for shareable HTTPS links, with the site's `apple-app-site-association` file, associated-domain entitlement, and correct app/team identity. Plan web fallback and distinguish authentication callback routes from ordinary app navigation. Existing Next callback/confirm routes are web implementations, not native callbacks. Test real email-provider links on a physical device, including link-wrapping behavior. [Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains).

Reproduce profile initialization and duplicate-account recovery without depending on the web's linking cookie. Keep the original and new duplicate-session proofs separately and only as long as needed. Reuse `merge-accounts` with its server restrictions; do not weaken proof checks or silently merge by matching an email string. On sign-out/account switch, unsubscribe, cancel outstanding work, clear account-scoped caches and pending sensitive forms, and reset navigation.

### N-03 · CAPTCHA and authentication error handling

Production web auth uses Turnstile on signup, password sign-in/reauthentication, reset, and resend paths. Native must obtain valid single-use tokens and send them through supported Auth options; handle expiry, cancellation, replay rejection, and rate limits. Do not disable CAPTCHA to make iOS work.

Cloudflare documents a WebView approach for mobile apps. Implement a small first-party hosted challenge surface with a restricted bridge and navigation policy; limit it to obtaining the challenge token. Account login and the app itself remain native/system-auth surfaces. Confirm the current Supabase configuration and site-key host allowlist during implementation. [Cloudflare mobile implementation](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/).

### N-04 · API transport, errors, and mutations

Create the Swift equivalent of `callEdgeFunction`: attach the current session and a correlation `x-request-id`; bound token acquisition, network work, and decoding; parse non-2xx JSON; retain response `X-Request-Id`; and expose a useful error plus a support reference for unexpected failures. Preserve endpoint `warning`, conflict metadata, and `invalid_source_ids`, rather than flattening every result to success/failure.

Use one in-flight action guard per submission, matching `useAsyncAction` on web. Retry safe reads with bounded backoff. Never automatically retry a mutation merely because the connection failed: reconcile first, and use an endpoint's explicit idempotency contract where available. Draft mutation `request_id` is a durable logical-attempt UUID; it is distinct from the per-request tracing header. Other mutations do not all have that contract. Disable double submission while retaining a clear cancellation/uncertain-result state.

### N-05 · Realtime, foregrounding, and cache ownership

Treat Realtime messages as invalidation signals, not a complete replayable history. Draft recovery is especially important: subscribe to the appropriate base tables, establish the subscription, then refresh a coherent state; reconcile after reconnection, foregrounding, network recovery, token refresh, and mutation. Discard older reads that finish after a newer season/account request.

Realtime is used beyond the draft. Web subscriptions to match: draft (`draft_picks`, `league_participants`, `counterpicks`, `leagues`); bidding (`pickup_bids`, `counterpick_bids`, `counterpicks`, `team_budgets`); trading (`trade_offers`, `team_budgets`); overview (`leagues`); owner invitation list (`invitations`). The notification inbox is not live (F-17).

Use foreground reconciliation comparable to the existing draft's 5-second connected and 10-second fallback cadence, with bounded/coalesced reads. Stop gameplay polling when backgrounded and refresh on return. iOS may suspend sockets; no gameplay depends on an uninterrupted background connection. Read holdings through `team_holdings` but subscribe to changes in its underlying tables.

Cache keys include account, league/season, query/filter, and page. Invalidate all affected views after wins, drops, trades, team edits, scoring changes, or rollover. Do not flash another account's private data during navigation restoration. The same asset can change while its detail sheet is open; revalidate before enabling submission.

### N-06 · Dates, numbers, and model decoding

- Use a distinct date-only representation for `release_date`, `season_end`, and trade-deadline dates. Preserve `YYYY-MM-DD`; do not convert local midnight through UTC and shift the day.
- Use ISO-8601 instants for processing, response, offer-expiry, review, and notification timestamps. Display times in the user's locale with a discoverable timezone/absolute date; compare against server rules in UTC. Countdown text is advisory and must reconcile after resume.
- Preserve nullable scores and expiry fields. Zero is not missing. Budget amounts are integers; point calculations preserve server precision. Use explicit rounding tests, not Swift's default rounding as an assumed JavaScript equivalent.
- Distinguish user, participant, team, season, series, TMDb, movie, holding, counterpick, bid, and trade IDs in typed models. Handle unknown future notification/status values safely, without enabling unknown gameplay actions.

### N-07 · Offline and failure states

Provide loading, empty, error/retry, stale cached, forbidden, signed-out, and completed/read-only states for each feature. Optional disk caching may show previously authorized data with an explicit last-updated state. Gameplay, invitation, and account mutations require connectivity; do not queue bids, draft picks, trades, or destructive actions for unattended replay. A button tap is not proof of a committed action.

Retain recoverable form input after a server refusal; refresh affected state and explain what changed. Support missing/broken posters and avatars. Separate a successful mutation followed by a failed refresh or notification from a failed mutation.

### N-08 · Native design and accessibility

Use the translation matrix in §5 and native components that respect safe areas, keyboard avoidance, focus, back navigation, Dynamic Type, VoiceOver, Reduce Motion, and Increase Contrast. Provide at least 44×44-point interactive targets, accessible labels/values for scores and icon buttons, and non-color status indicators. A draft update must not repeatedly interrupt a screen reader or steal focus. [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility), [layout and touch targets](https://developer.apple.com/design/tips/).

### N-09 · Images and upload lifecycle

Use cancellable, size-appropriate image loading with memory/disk limits and placeholders. Do not repeatedly download full backdrops for thumbnail rows. Handle unsupported source photo formats, upload size/type validation, progress, replacement, and cleanup of obsolete/orphaned uploads. Preserve the two buckets and ownership paths in F-03/F-10. An upload succeeding before the database update fails must have a recovery strategy. Public image URLs must not contain credentials.

### N-10 · Diagnostics and product events

Use a native diagnostics adapter, optionally Sentry's native SDK after reviewing its configuration and privacy implications. Correlate client failures with Edge request IDs; distinguish cancelled requests and expected validation from unexpected failures. Log no tokens, emails, raw trade messages, or invitation secrets. Reuse canonical success-event semantics in `utils/analytics.ts` with IDs-only properties if a native analytics destination is selected; Vercel's browser analytics wrapper is not a Swift ingestion API. Do not invent an analytics endpoint or automatically enable session replay. New native telemetry requires the privacy work in L-03.

## 5. Translate web interaction into native iOS design

Suggested global structure: **Leagues, Movies, Wishlist, Account**, with notifications reachable from a consistent toolbar destination. A league opens a native navigation stack containing overview and entry points to Draft, Roster, Standings, Bidding, Trading, History, and commissioner Settings. Show phase-appropriate shortcuts within the league. This is a design recommendation for validation, not an existing product decision.

| Current web pattern | Native requirement / recommendation |
| --- | --- |
| Desktop sidebar, horizontal league tabs, mobile More menu | Stable global TabView and per-league NavigationStack; avoid two competing bottom tab bars. Use a split view for iPad only if in scope. Keep root tabs stable across league phases. |
| Wide draft grid, leaderboard, admin tables | Compact prioritized rows and detail navigation on iPhone; wider layouts where space permits. Preserve full information without making horizontal scrolling the only usable path. |
| Modal-on-modal trade/movie/invite editors | One sheet or full-screen flow with child navigation and explicit cancellation. Choose sheet size for the task, preserve composer state, and confirm discarding substantive edits. |
| Hover-only buttons/tooltips and cursor affordances | Visible primary actions, labeled info buttons/help text, and optional context menus for secondary actions. No operation may require hover. |
| Drag handles (`dnd-kit`) | Native reorder controls plus accessible Move Up/Down or equivalent actions. Save priorities/order explicitly and retain identity while rows move. |
| Toasts (`sonner`) and browser dialogs | Inline validation, native confirmations, and accessible success/status feedback. Persistent/actionable errors must not disappear in a short-lived toast. |
| CSS sticky bars and browser viewport workarounds | Native safe-area insets, scroll views, keyboard-aware forms, and bottom action placement that works with the home indicator. |
| Mouse selects, number/date inputs | Native pickers/steppers and validated numeric fields; date-only editors separate from time-window editors. Do not silently clamp invalid business settings. |
| Browser Back, URL query state, redirects | Typed navigation, standard swipe-back, selected-season restoration, and deep links. Avoid duplicate screens after OAuth or notification routing. |
| Web clipboard and links | System share sheet, copy confirmation, system browser/in-app browser for appropriate external information, and Universal Links for app content. |
| Web focus/revalidation, SWR caches | Scene lifecycle, connectivity/auth transitions, cancellable tasks, and repository invalidation. React hooks are behavior references, not code to embed. |
| Poster-heavy cards and animation | Native adaptive cards, sized/cached images, modest transitions, Reduce Motion support, and optional restrained haptics for confirmed actions. |

These recommendations follow Apple's [tab-bar](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [sheet](https://developer.apple.com/design/human-interface-guidelines/sheets), and [search](https://developer.apple.com/design/human-interface-guidelines/searching) guidance. Native navigation should feel standard while the content remains recognizably Fantasy Reel.

**Brand translation:** preserve approved marks and icon concepts from `apps/frontend/public/brand/v1/`. Build semantic native color tokens, including both palettes; starting values are dark background `#0F0F0F`, surface `#1C1C1C`, gold `#C9A227`, text `#E8E8E8`, secondary `#B8B0A4`; light background `#F5F5F4`, surface `#FFFFFF`, gold `#71570C`, text `#242424`, secondary `#55514B`. Validate native contrast and disabled/selected states rather than mechanically copying CSS opacity.

Bricolage Grotesque serves expressive headings and numeric roles; DM Sans serves body, controls, compact movie/team titles, and metadata. Use native font registration from the supplied TTF sources with their license notices, not browser WOFF2 files. Numeric Bricolage roles use optical size 12, width 100, and tabular/lining figures; bundled DM Sans does not provide tabular digits. Match semantic roles to Dynamic Type text styles; pixel-for-pixel web sizes would undermine accessibility. System typography for OS-owned chrome is appropriate. Avoid truncating functional metadata below the web's 12px baseline; choose a readable native style and test enlargement. Sources: [typography](brand/typography.md), [font sources/licenses](brand/source), [brand assets](brand/README.md), [CSS tokens](../apps/frontend/app/globals.css).

## 6. Backend and data contract map

This is a map to the existing implementation, not a replacement API specification. Before implementing an endpoint, inspect its request interface, response construction, shared validator, current migrations, and tests. Function paths below are relative to `supabase/functions/`; SDK invocation uses the function name. Optional fields and response projections evolve independently of the frontend's handwritten types.

### User-invoked Edge Functions

| Area | Functions and important request fields |
| --- | --- |
| League lifecycle | `get-leagues` (exists and is tested, but the web dashboard reads tables directly, so pick one source for iOS and keep it consistent with web grouping); `create-league` with name/creation settings; `join-league` with one of `league_id`, `invitation_token`, `join_code` and optional `team_name`; `update-league` with `league_id`, `action`, action fields; `start-next-season` with `league_id`. Manual completion is an `update-league` action. |
| Invitations | `search-users` with `league_id`, `query`, optional `limit`; `send-invite` with `league_id` and `email` or `user_id`; `generate-join-link` with `league_id`; `resend-invitation`, `cancel-invitation`, `decline-invitation` with `invitation_id`. |
| Movie research | `search-movies` with `query`, optional `page`, `year`, `upcoming_only`, `season_year`; `browse-movies` with optional `page`, `genres`, `release_window`, `sort_by`, `trending`, `season_year`; `get-movie-details` with `tmdb_id`; `get-franchise-history` with `tmdb_ids`. Preserve returned pagination/cache/error semantics. |
| Draft | `start-draft` with `league_id`; `draft-pick` with `league_id`, `tmdb_id`, `expected_pick`, `request_id`; `start-counterpick-round` / `skip-counterpick-round` with `league_id`; `make-counterpick` with `league_id`, `movie_id`, `expected_pick`, `request_id`. |
| Drops | `drop-movie` with exactly one `draft_pick_id` or `pickup_id`; endpoint derives and checks ownership/league. |
| Bids | `place-bid` with `league_id`, `tmdb_id`, `amount`, optional conditional-drop holding ID; `place-counterpick-bid` with `league_id`, `movie_id`, `amount`; `cancel-bid` / `cancel-counterpick-bid` with `bid_id`; `set-bid-priorities` / `set-counterpick-bid-priorities` with `league_id`, ordered `bid_ids`. |
| Read trades | `get-trades` with `league_id`, optional `team_id`, `status`, `limit`, `offset`. Supports GET query or POST body. Preserve enriched items and contested-source metadata. Current UI starts with up to 50 offers; do not infer an unlimited feed. |
| Propose/counter | `propose-trade`: `league_id`, `recipient_team_id`, `offered_items`, `requested_items`, optional `message` and expiry fields. `counter-trade`: `trade_offer_id`, `counter_offered_items`, `counter_requested_items`, optional message/expiry. Item collections contain assets and `faab`; inspect the shared types rather than flattening them to movie IDs. |
| Trade decisions | `respond-trade` with `trade_offer_id`, `response` (`accept`/`reject`), optional `message`; `cancel-trade` / `approve-trade` with `trade_offer_id`; `veto-trade` with `trade_offer_id`, optional `reason`; `extend-trade-offer` with `trade_offer_id`, `expires_at`. |
| Announcements | `send-announcement` with `league_id`, `message`; report `channels_notified`. |
| Account recovery | `merge-accounts` uses camelCase: `originalUserId`, `duplicateUserId`, `duplicateAccessToken`, `provider`. Preserve its proof and eligibility checks. |

Bid conditional-drop fields are `conditional_drop_draft_pick_id` and `conditional_drop_pickup_id`, mutually exclusive. Trade expiry fields are `expires_at`, `expiry_anchor`, and `expiry_anchor_movie_id`; omission, explicit null, fixed time, and movie-release anchoring have distinct meanings. Match the existing validators rather than inventing a universal payload normalizer.

### Direct SDK reads, writes, and RPCs

| Capability | Existing source / contract |
| --- | --- |
| Identity/league reads | `profiles`, `leagues`, `league_series`, `series_seasons`, `league_participants`, `teams`; use explicit projections and active-status checks. Resolve ambiguous joins with the actual FK constraint name. |
| Active rosters | `team_holdings`: flattened active draft/pickup holdings, `holding_id`, `source`, `movie_status`, season-specific points. Base `draft_picks`/`pickups` remain necessary for history, mutations, and Realtime. |
| Competition reads | `movies`, `reviews`, `counterpicks`, `pickup_bids`, `counterpick_bids`, `team_budgets`, `team_scores`, `team_drops`; access remains constrained by RLS/endpoint rules. Use `get-trades` where the web uses it, not an assumed equivalent direct-table projection. |
| Standings/lifecycle | `league_standings` plus persisted completed-season snapshots; `get_counterpick_options`, `get_next_counterpick_turn`, `get_team_drop_count`, `get_next_processing_deadline`, `get_new_bid_cutoff`. Inspect exact RPC signatures before creating Swift wrappers. |
| Invitations | `get_league_invitations` preserves masked information; don't replace it with a service-role table read. Recipient queries must use their own identity. |
| Wishlist | Own `wishlisted_movies` upsert/delete and `profiles.wishlist_public` update; shared reads depend on active shared membership. |
| Notifications | Own notification reads and `read_at` timestamp updates through RLS; latest-50 web behavior is documented in F-17. |
| Profile/team edits | Recreate validation and upload coordination currently in Next server actions, using user-authenticated SDK operations where existing RLS permits. If a shared endpoint is needed, add internal auth/validation rather than granting broader client privileges. |
| Images | Public `avatars` and `team-avatars` buckets, ownership-scoped write paths, known type/size limits. |
| Admin | `admin_growth_stats()`; server authorization via `app_admins`. |

Recent migrations revoke direct authenticated bid mutations in favor of the function contracts. Internal commit/execution RPCs, service-role helper queries, cron handlers, and account-admin APIs are **not** automatically available to the phone. For example, the transactional draft commit RPCs remain behind authenticated Edge Functions.

### Server-owned processing and timing

| Process | Checked-in UTC schedule | Client consequence |
| --- | --- | --- |
| Draft notification outbox | Every minute | Pick success and notification delivery are separate; delivery retries do not repeat picks. |
| Weekly bids | Saturday 20:00 | Countdown means eligible for processing, not guaranteed instant completion. |
| Extended bids | Hourly | Open response windows can delay awards. |
| Trades | Every five minutes | Accepted/review-ended offers may await execution. |
| Scores | Daily at 06:00 and 18:00 | Scores are not a continuous critic-feed stream. |
| Release-date sync | Daily at 08:00 | Dates and release-anchored trade windows can change. |
| Season completion | Daily at 09:00 | `season_end` is inclusive; due active seasons may await the next successful job. |
| Release-day / weekly-release announcements | Daily 13:00 / Monday 13:00 | Preserve existing backend side effects. |
| Bid-cutoff announcements | Hourly | Respect server notification deduplication/timing. |

Sources: [function directory](../supabase/functions), [function authentication configuration](../supabase/config.toml), [frontend invocation wrapper](../apps/frontend/utils/supabase/functions.ts), [Vercel Cron](../apps/frontend/vercel.json), [migrations](../supabase/migrations). Schedules describe repository configuration; deployment and job health must be verified independently.

## 7. Additional launch requirements and gaps

These items go beyond reproducing today's screens. They need implementation/product review before public distribution; this document does not change the current Privacy Policy or Terms.

### L-01 · Equivalent privacy-preserving sign-in

Retaining Google/Discord for primary account login requires assessing App Review guideline 4.8 and its exceptions. It calls for an equivalent login option with specified privacy properties; **Sign in with Apple is the recommended implementation**, not a claim that every third-party-login app universally must use Apple. [App Review guidelines, 4.8](https://developer.apple.com/app-store/review/guidelines/).

Add Apple provider configuration, native credential handling and nonce validation through Supabase's supported flow, first-authorization name capture, relay-email handling, account linking, cancellation, and revoked-credential recovery. Apple's relay address may differ from an existing account email; matching strings or the current Google/Discord duplicate-merge path is insufficient. Decide the safe linking UX before implementation. [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple).

### L-02 · In-app account deletion

The current support-email deletion instruction is not a complete native deletion flow. Apps supporting account creation must provide a way to initiate deletion in-app; implement confirmation, appropriate reauthentication, server-side execution/status, and clear outcomes. A support link alone does not satisfy the general requirement. [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

Define behavior for sole commissioners, active games, shared historical standings, sent invitations/trades/notifications, public image objects, provider tokens, and any legally retained records. Do not simply cascade-delete a user and assume league history remains correct. Offer a documented ownership-transfer or other supported resolution if needed; no transfer feature was found in the current web UI. `merge-accounts` is restricted duplicate recovery, not a general deletion endpoint. Test that another user's data and permissions survive deletion.

### L-03 · Privacy disclosures and SDK inventory

Inventory every native SDK, collected field, diagnostic/event, storage location, retention/deletion path, and recipient. Complete accurate App Store privacy disclosures and required privacy manifests/required-reason API declarations; review third-party SDK signature/manifest requirements for the chosen versions. Request ATT only if the implemented data use meets Apple's tracking definition, not merely because crash reporting exists. [Privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files), [SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/), [privacy and tracking](https://developer.apple.com/app-store/user-privacy-and-data-use/).

Update the published policy and effective date in the same change that adds native data collection, APNs tokens, providers, or deletion/retention behavior. The existing Terms already mention apps and Apple's standard EULA; assess accuracy instead of assuming a wholly new Terms page is missing. Owner approval is required for new legal wording under the repository agreement. Preserve the existing policy's accurately documented notification-record email visibility until its underlying RLS actually changes.

### L-04 · User-generated content and abuse handling

Names, uploaded images, trade messages, and announcements warrant a review of guideline 1.2. It calls for safeguards including objectionable-content filtering, reporting with timely response, user blocking, and published contact information. [App Review guidelines, 1.2](https://developer.apple.com/app-store/review/guidelines/).

No complete in-app report/block/moderation system was identified. Decide and implement controls appropriate to the actual sharing model, including who receives reports and how blocking interacts with shared leagues and existing offers. Email support and commissioner removal in setup are not evidence that all these controls already exist. Do not silently add public chat or wider profile visibility as part of this work.

### L-05 · Distribution, links, and review readiness

Create the Apple project/app identity, signing/provisioning, App Store Connect record, release configuration, native icon assets, launch appearance, screenshots, age/content declarations, support/privacy URLs, and review instructions. Provide usable review credentials/demo data and a working backend; guideline 2.1 requires a complete app reviewers can assess. [App Review guidelines, 2.1](https://developer.apple.com/app-store/review/guidelines/).

Verify real-device signup/recovery/OAuth/invitation links, offline recovery, small-screen layouts, accessible text sizes, and TestFlight upgrade behavior. Verify movie-data attribution and the rights/terms for the actual data and imagery used before submission. No new money/prize/payment capability is in this scope.

## 8. Optional enhancements and approved v1 additions

These are separate from full parity and must not consume time needed to finish the existing workflows without a scope decision.

- **O-01 Push:** APNs registration and device-token storage, authenticated per-user device ownership, token rotation/removal, sign-out/account-switch cleanup, server delivery credentials/queue/retries/deduplication, preferences, and deep-link routing. Define which existing events warrant push and whether email/Discord preferences are independent. Request permission in context, handle denial, avoid sensitive lock-screen content, and keep the inbox usable without permission. Existing notification rows/outboxes are useful inputs; there is no discovered APNs delivery system to merely enable. Apple says push must not be required for app operation. [App Review guidelines, 4.5.4](https://developer.apple.com/app-store/review/guidelines/).
- **O-02 Widgets/Live Activities:** possible turn/deadline/status surfaces, with explicit refresh/staleness limits. These require their own privacy, extension, and update design.
- **O-03 iPad/Mac expansion:** richer board/split-view layouts and keyboard support if those targets are approved; do not imply Catalyst/macOS is included by writing a SwiftUI app.
- **O-04 Local conveniences:** biometric unlock of an already-authenticated session, saved searches, or offline research improvements. None replaces backend authentication or allows offline gameplay commits.

### Approved v1 additions

These go beyond web parity but are in the iOS v1 scope by the owner's decision.

- **V-01 League Rules:** a read-only screen, reachable by every member from the league, showing the selected season's configuration: roster and draft slots, drops per season, Fantasy Budget, bid response window and new-bid cutoff, counterpick slots and drop blocking, the double-points rule with a worked example, trading on/off, trade deadline, review period, offer-window bounds, and season year and end date. Values come from the `leagues` row the member can already read; locked or not-applicable settings are shown as such, not hidden. **Accept:** a member and the owner see identical values, and an owner's change appears after refresh.

## 9. Build sequence and work packages

| Package | Requirements | Deliverable / exit condition |
| --- | --- | --- |
| 0 — Contract and launch decisions | §10–11, L-01–L-04 | Record rule/visibility choices, target/platform settings, callback plan, Apple linking and deletion/moderation contracts. Verify local/deployed schema assumptions. Resolve decisions before their dependent feature ships. |
| 1 — Native foundation | N-01–N-10, F-01–F-03 | Running app, design tokens/components, secure sessions, all current auth/recovery paths, routing, transport/errors, profile/theme; tests for DTOs, clocks, callbacks and logout isolation. |
| 2 — Membership and research | F-04–F-07, F-10 | Same account sees leagues/seasons; create/join/invite; movie/franchise research, wishlist/privacy; team identity; cross-client persistence verified. |
| 3 — Draft and score visibility | F-08–F-09, F-11, F-14 | Mixed web/iOS draft through activation, connection recovery, roster/standings/scoring parity. Implement server transaction contracts before polishing the board. |
| 4 — In-season economy | F-12–F-13 | Bids/priorities/conditional drops and complete trade lifecycle, server outcomes and mixed-client race coverage. |
| 5 — Full role/lifecycle parity | F-15–F-18, V-01 | Every commissioner setting, completion/history/rollover, inbox and communications, authorized admin charts. |
| 6 — Distribution readiness | L-01–L-05, §12 | Apple login where applicable, deletion/moderation/privacy work, real-device and accessibility verification, TestFlight, review materials and release checklist. |
| Optional track | O-01–O-04 | Explicitly approved additions; independent acceptance gates. |

For parallel agent work, establish shared DTOs, identifier/date types, repository interfaces, route names, and design tokens first. Assign bounded feature directories; give one owner responsibility for shared contracts and integration. Suitable independent later streams are movie/wishlist UI and league/commissioner UI. Draft, bidding, and trades share holdings/budget/state assumptions and require coordinated contracts. Backend changes must include migrations, RLS tests, and compatibility with the existing web client. Reuse the project's migration workflow; do not reset a database to fix fixtures.

## 10. Observed inconsistencies and gaps to resolve

The baseline behavior below is what an implementation agent should expect today. Changing it is separate product/backend work; an iOS-only rule would create divergence.

| ID | Evidence / present behavior | Required resolution |
| --- | --- | --- |
| D-01 — Release-day boundaries | `_shared/utils.ts` deliberately documents an inclusive release day: it rejects movie dates **before** today; `drop-movie` uses the same strict-before boundary. A film dated today can therefore be draft/bid/drop eligible under those date checks, while `hasReleased`/SQL scoring counts it today. Other checks, including scored-movie locks, still apply. Less precise wording elsewhere simply says “unreleased.” | Preserve and clearly explain the documented same-day behavior; test date-only UTC handling on both clients. Any proposal to tighten it requires shared rules/tests, not an iOS-only filter. A missing date is ineligible for movie discovery/placement but does not itself block the current drop path. |
| D-02 — Awarded counterpick drop blocking | Current `drop-movie` and roster rules gate both awarded counterpicks and pending active/outbid counterpick bids on `counterpicks_block_drops`. Some repository guidance says an awarded counterpick always blocks drops. | Confirm intended rule. Preserve executable behavior for parity unless a shared fix is approved. Counterpicks survive a permitted drop in either design. |
| D-03 — Bid and trade visibility | Web active-bid UI renders competing amounts; some comments/bot copy call bids sealed. `get-trades` authorizes active league membership and uses a service client to return league offers; direct trade-table RLS can be narrower. | Specify who can see amounts, messages, and offers, then align backend, web, iOS, bot/help, and privacy text. Do not advertise secrecy or participant-only offers based on comments. Native must not widen access beyond the chosen policy. |
| D-04 — Counterpick slot limits | `create-league` permits bidding counterpick slots 0–3; `update-league` permits 0–5. | Retain endpoint-specific validation until a shared limit is chosen; ensure existing seasons above the creation limit still render. |
| D-05 — Leave/ownership controls | Rollover confirmation says people can leave the new season, but no self-service leave handler/UI or ownership-transfer workflow was found. Owner can kick another participant during setup. | Correct the promise or implement a shared, authorized leave policy. Do not invent a working leave/transfer API in the native client. Deletion planning must address ownership. |
| D-06 — Mobile auth orchestration | Profile initialization, duplicate detection/linking cookies, recovery redirects, and several edits live in Next routes/server actions. | Implement native orchestration or narrowly shared APIs; verify linking against existing accounts. Do not scrape HTML or call unstable server-action internals. |
| D-07 — Bounded feeds | Notification unread counts cover the latest 50 loaded rows. Bid history fetches at most 500 won/lost records per bid table, excluding cancellations. Trade UI initially loads 50; the API's total count needs review when filters are supplied. | Match current minimum behavior and label it honestly. If adding complete pagination/unread totals, specify and test shared query contracts rather than trusting a misleading total. |
| D-09 — Member-visible league rules | League Settings is owner-only, and no read-only rules view exists for members. Roster shows capacity and drops remaining, but a member has nowhere to see the double-points rule, counterpick slots, bid response window, trade deadline, or review period, even though these decide their moves. | **Decided (October 4, 2026): League Rules ships in iOS v1.** A read-only screen for every member, built from the same `leagues` row (no backend change). Adding the same view to web is recommended so the clients don't diverge. Tracked as V-01. |
| D-10 — Notification preferences | There are no user-level email preferences and no unsubscribe link; Discord preferences are per-channel and set only through the bot. | Required before O-01 push ships: decide per-user, per-event preferences and whether they also govern email. Do not add a preference screen that controls nothing. |
| D-11 — Support-only account actions | Email change, data export, and (today) deletion are by email to support, per the privacy policy and settings copy. | Settings/About must link to support for each of these until self-service exists. L-02 replaces deletion only. |
| D-08 — Production and external setup | Source audit cannot establish active migrations, configured CAPTCHA/providers/redirects, deployed function versions, cron health, real notification delivery, or Apple app identity. | Verify these in the intended environment during implementation and before TestFlight; do not mark production parity from repository inspection alone. |

Useful conflict entry points: [eligibility helper](../supabase/functions/_shared/utils.ts), [drop handler](../supabase/functions/drop-movie/index.ts), [active bids](<../apps/frontend/app/(authenticated)/league/[id]/components/ActiveBidsPanel.tsx>), [trade reads](../supabase/functions/get-trades/index.ts), [rollover wording](<../apps/frontend/app/(authenticated)/league/[id]/components/ConfirmStartSeasonModal.tsx>).

## 11. Product decisions before dependent implementation

| Decision | Recommended starting position | Why it matters |
| --- | --- | --- |
| Deployment target and devices | iPhone-first; choose a minimum iOS version from intended users and selected SDK support. Decide iPad separately. | Navigation/API availability, layout, test matrix and store assets. |
| Apple identity and environments | Owner selects team, bundle ID, associated domain(s), staging strategy and distribution ownership. | Entitlements, OAuth callbacks, signing and release continuity. |
| Auth providers and Apple linking | Preserve email, Google and Discord; assess/add Apple under L-01 with an explicit existing-account linking flow. | Avoid duplicate accounts and loss of historical identity. |
| Deletion and moderation | Define shared backend policies before implementing L-02/L-04 screens. | Data integrity, operator responsibilities and launch readiness. |
| Rules and visibility | Resolve D-01–D-05 explicitly with shared tests. | Complete parity is impossible if clients intentionally interpret different rules. |
| Native information architecture | Validate the four-root-tab proposal against actual league tasks. | Keeps navigation usable without copying web chrome. |
| Full role scope | Include F-18 for literal parity; a deliberate admin omission must be labeled as a scope reduction. | Prevents hidden missing functionality at handoff. |
| Push at launch | Treat as optional unless the owner adds it to release scope. | APNs/backend/preferences/privacy work is substantial and not existing functionality. |
| Telemetry | Select crash/error monitoring and whether/how canonical product events are sent. | Native SDK choice, policy disclosures, observability continuity. |
| Release operations | Name owners for store submissions, backend compatibility, support, deletion and moderation. | Determines whether the app is maintainable after launch. |

These decisions do not prevent starting native scaffolding, contract tests, and design components. Do not infer approval for backend rule changes, production deployment, or legal wording from this requirements document.

## 12. Verification and definition of complete parity

### Acceptance matrix

| Test ID | Required scenario / result | Coverage |
| --- | --- | --- |
| T-01 | Email/provider sign-in, signup/confirmation, CAPTCHA error/retry, recovery after termination, link/unlink and duplicate recovery preserve the intended user and records; only-signin-method guard works. | F-02, N-02–N-03, L-01 |
| T-02 | Invitation received while signed out survives onboarding; wrong-email/expired/revoked/full/started cases fail correctly; accepted membership appears on both clients. | F-04–F-05 |
| T-03 | Same series switches among setup, active and completed seasons without leaking IDs/caches; a later-season member cannot read an unauthorized older season. | F-04, F-16, N-05 |
| T-04 | Missing posters/dates/scores and first/standalone franchises render correctly; empty filtered pages still advance; failed provider reads do not create invented eligible films. | F-06 |
| T-05 | Private/shared wishlist RLS, overlaps and ownership including pickups; failed optimistic update rolls back; account switching clears private cache. | F-07 |
| T-06 | Alternate web/iOS participants through snake and reverse-snake draft; simultaneous taps, stale turn, lost response, duplicate UUID, reconnect and background resume produce one correct state. | F-08–F-09, N-04–N-05 |
| T-07 | Draft/pickup drop paths, exhausted allowance, same-day date, missing date, scored pre-release movie, block flag on/off, and surviving counterpick match shared rules. | F-11, D-01–D-02 |
| T-08 | Zero/highest bids, raises, cancellation before/after cutoff, rollover of deadlines, extended windows and forecast/priority edits match server outcomes. | F-12 |
| T-09 | Mixed bid types share budget; over-capacity bids, runner-up awards, conditional drop reused twice, invalid drop target, and scored/dropped target yield correct spend and reasons. | F-12 |
| T-10 | Propose/respond/counter/cancel/extend/review/veto/approve; release-anchor movement; accepted-but-not-executed state; competing trades; score locks; budget/roster/counterpick capacities; legal movie/counterpick swap. | F-13 |
| T-11 | RT null/0/60/negative/fractional/double-over-90 cases, pre-release score exclusion, release-day UTC inclusion, ties, and removed historical champions match canonical snapshots. | F-14 |
| T-12 | Every F-15 setting saves at allowed phases and refuses direct unauthorized requests; owner/member/app-admin differences are enforced server-side. | F-15, F-18 |
| T-13 | Complete with tied leaders and open offers/bids; freeze snapshots; race two rollover requests; correct new identities/settings/Discord mapping with empty holdings. | F-16 |
| T-14 | Notification read state syncs after refresh, old links recover safely, native mutations retain configured email/Discord effects, delivery failure does not repeat gameplay. | F-17 |
| T-15 | Upload each supported image type, convert HEIC, reject oversized files, replace/remove, recover from upload/database partial failure; name edits reflect cross-client. | F-03, F-10, N-09 |
| T-16 | Small/large iPhones, largest supported text sizes, VoiceOver, Reduce Motion, light/dark/system, keyboard, safe areas, and accessible reorder flows remain usable. Add iPad/orientation matrix if supported. | N-08, §5 |
| T-17 | Airplane mode, flaky network, expired/revoked session, suspended app, process termination, malformed response and server 5xx show truthful states; no offline mutation replay or cross-account disclosure. | N-02, N-04–N-07 |
| T-18 | Account deletion, abuse controls, Apple linking/relay case, production Universal Links, privacy configuration and review account operate on physical devices/TestFlight. | L-01–L-05 |

### Test layers and environment

- **Swift unit/contract tests:** DTO fixtures from real contracts; nullable/unknown values; date-only vs timestamp handling; score/display rounding; route parsing; action-state transitions; stable draft mutation IDs. Keep authoritative outcome computation on the server.
- **Local integration:** Docker/local Supabase, current migrations, Auth/RLS/Storage/Edge/Realtime, multiple seeded users/roles. Use service credentials only in controlled fixture setup, never in the app. A physical device cannot use the development Mac's `127.0.0.1`; configure a reachable development endpoint without hardcoding a broad production transport-security exception.
- **Mixed-client E2E:** run a full lifecycle with web and iOS users against the same database, including concurrent actions and real server processing. Mocked Swift screens alone do not demonstrate parity. Provider stubs/caches establish deterministic game tests; separate smoke tests verify actual OAuth/email/CAPTCHA services.
- **Native UI/accessibility tests:** validate user journeys and recovery, not implementation-shaped snapshots alone. Real devices are required for final OAuth/linking and lifecycle validation, and for push if selected.

Existing reference suites live in [frontend E2E](../apps/frontend/e2e), [Edge tests](../supabase/functions/tests), and [SQL tests](../supabase/tests). Read [function testing setup](../supabase/functions/TESTING.md), [E2E guidance](E2E_TESTING_STRATEGY.md), the current [root package scripts](../package.json), and [CI E2E workflow](../.github/workflows/e2e-tests.yml) before selecting commands. Some testing documents are plans; actual scripts and checked-in tests determine what runs.

For backend changes, run affected Deno/SQL integration coverage; run SQL tests before API/browser work when they share database locks. Use `npx supabase migration up` for pending migrations; never reset a shared database for test convenience. For web changes required by shared contracts, run appropriate frontend static/browser checks. The root generic `test` script is not evidence of a configured frontend unit suite. Typical scoped entry points include `npm run test:draft:state`, `npm run test:functions`, `npm run test:e2e`, and `npm run test:bot`; inspect their current scope/prerequisites rather than running them blindly. This documentation-only audit does not require app builds or those suites.

**Parity release gate:** every F-01–F-18 requirement is implemented or explicitly documented as a scope reduction; relevant N/L requirements are complete; D decisions are resolved for shipped behavior; applicable T scenarios pass; web/iOS agree on identities, permissions and final results; legal/support/review materials are accurate; and no client relies on service credentials, uninterrupted background execution, or unverified production configuration. Record evidence and remaining limitations in the release checklist.

## 13. Source map and agent handoff

| Web route / source area | Requirements to implement |
| --- | --- |
| `/`, `/how-to-play`, `/privacy`, `/terms`; authenticated `/help` | F-01, L-03, L-05 |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`; `/auth/*` | F-02, N-02–N-03, L-01–L-02 |
| `/settings` | F-03, connected identities/passwords in F-02 |
| `/dashboard`, `/join` | F-04–F-05, invitations, trophies, season entry |
| `/movies`, `/wishlist` | F-06–F-07 |
| `/league/[id]` and `/league/[id]/dashboard` | F-10 and state-specific entry points |
| `/league/[id]/draft` and counterpick components | F-08–F-09 |
| `/league/[id]/roster`, `/standings` | F-11, F-14, opponent team detail |
| `/league/[id]/bidding`, `/bidding/history` | F-12 |
| `/league/[id]/trading` | F-13 |
| `/league/[id]/settings`, `/history` | F-15–F-16 |
| Shared NotificationBell, notification hook, bot commands | F-17 |
| `/admin` | F-18 |
| Error boundaries, theme/async hooks, Supabase wrappers and shared utilities | N requirements and all feature error/recovery states |

Additional canonical entry points: [agent agreement](../AGENTS.md), [detailed domain reference](../CLAUDE.md), [scoring](../supabase/SCORING.md), [Supabase setup](../supabase/README.md), [OAuth](OAUTH.md), [types](../apps/frontend/types/index.ts), [holdings contract](../apps/frontend/utils/holdings.ts), [backend holdings](../supabase/functions/_shared/roster-holdings.ts), [trade validation](../supabase/functions/_shared/trade-validation.ts), [bid resolution](../supabase/functions/_shared/bid-resolution.ts), [product event names](../apps/frontend/utils/analytics.ts), [observability audit](OBSERVABILITY-AUDIT.md).

**Handoff instruction for an implementation agent:** read this document and current repository instructions; compare the current commit/schema with the audit baseline; record changes to affected F/N/L/D IDs; resolve only the decisions blocking the assigned package; inspect source/tests for its contracts; implement native UI and backend gaps within the approved scope; simplify; run applicable unit, integration, native accessibility, and mixed-client acceptance checks; and commit with evidence. Do not mark parity from a screen inventory alone or silently replace ambiguous server rules with client assumptions.

## 14. Completeness review summary

A review compared this document against a fresh inventory of every web route, league component, Edge Function, Realtime subscription, notification type, and browser-stored preference at `b576a5a`. The F-01–F-18 feature set is complete: no user-facing web capability was missing from it. The review added the details a designer or implementer would otherwise rediscover:

- the per-phase league section matrix (§2);
- the bidding screen's structure, post-cutoff mode, and client-side fit forecast (F-12), which is logic iOS must port rather than a server contract;
- invitation-email rate limits (F-05), overview states (F-10), standings and trade-screen details (F-13, F-14), confirmation strength for destructive owner actions (F-15), and the notification badge (F-17);
- the full list of Realtime subscriptions (N-05), and corrected draft-picker tab and release-window labels (F-06);
- three gaps the web itself has, which an iOS app makes more visible: no member-facing league rules (D-09, now V-01 in v1), no notification preferences (D-10, a prerequisite for push), and support-only email change and data export (D-11).

Web-only surfaces that are intentionally not parity targets: the marketing landing page's demo scenes, the PWA manifest, the collapsible desktop side navigation, `/api/health`, the cron proxies, and the operator-only `sync-movies` function.

## 15. Screen inventory for native design

This is the list a mockup pass should cover. It follows the four-tab proposal in §5 (Leagues, Movies, Wishlist, Account, plus a toolbar notification inbox); names are proposals, not decisions. Every screen also needs the loading, empty, error, forbidden/signed-out, and read-only states from N-07, in light and dark appearance.

| Area | Screen or sheet | States and content that must appear | Source |
| --- | --- | --- | --- |
| Signed out | Welcome / how to play | Game explanation, Sign up, Log in, legal and support links, movie-data attribution | F-01 |
| Signed out | Sign up | Display name, email, password + confirm, Google/Discord/Apple buttons, legal notice under every create-account action, CAPTCHA, "check your email" + resend | F-02, L-01 |
| Signed out | Log in | Email/password, providers, CAPTCHA, unconfirmed-email resend, callback error | F-02 |
| Signed out | Forgot / reset password | Request sent (non-enumerating), invalid or expired link, new password + confirm | F-02 |
| Signed out | Link duplicate account | Existing-password proof + CAPTCHA, or keep accounts separate | F-02, N-02 |
| Leagues tab | League list | Series cards with current season, status badge, champion; past-season expander; pending invitations (accept/decline); trophy case; empty state with Create and Join | F-04, F-05 |
| Leagues tab | Create league | Basic (name, team name, max players, private) and advanced (slots, draft slots, drops, counter window, bid cutoff, counterpick slots, block drops) | F-05 |
| Leagues tab | Join league | Code or link entry, invitation token, optional team name, "Joining as {name}", every failure outcome | F-05 |
| League | League header | League and season switchers, phase badge, sections reachable per the §2 matrix, outbid badge | F-04, §2 |
| League | Overview | Team header + edit team (name, avatar), my movies, around-the-league releases, waiting/welcome cards, champion banner + Start next season (owner), shared-wishlist banner | F-10, F-16 |
| League | League movie detail | Poster, metadata, RT score/points or Pending/"at release", ownership, franchise history, wishlist, Drop / Bid / Trade entry points with reasons when blocked | F-06, F-11 |
| League · setup | Draft room (setup) | Participants, invitations list (resend/cancel/copy), invite sheet (user search or email), join code/link share, draft order, Start draft (owner) | F-05, F-08 |
| League · drafting | Draft room (live) | Turn banner, pick queue, progress, board/history, connection state, movie picker (All, Trending, Releasing Soon, Wishlist; search; genre and window filters), quick preview, Pick confirmation | F-08 |
| League · counterpicking | Counterpick round | Reverse-snake turn, eligible opponent movies by team, remaining picks, owner Start/Skip/End controls with confirmation | F-09 |
| League | Roster | Draft picks, pickups, counterpicks; capacity; drops remaining; drop confirmation; inline blocked-drop reasons | F-11 |
| League · active | Standings | Ranked rows with ties, summary strip, own-team highlight, champion banner/crown, team detail | F-14 |
| League · active | Bidding | Budget, week timeline, Action Required / My Active / Competing groups, History tab grouped by round | F-12 |
| League · active | Place bid sheet | Search or wishlist source, post-cutoff contest list, amount stepper, conditional drop, fit forecast; counterpick variant | F-12 |
| League · active | Bid priorities | Separate pickup and counterpick lists, reorder controls, "Roster runs out" cut line | F-12 |
| League · active | Trading | Pending, My Trades, All Active, History; action-needed count; offer cards with contested markers, clocks, and actions (accept/reject/counter/cancel/extend; owner veto/approve) | F-13 |
| League · active | Trade composer | Counterparty, give/receive assets (movies, pickups, counterpicks, budget), message, expiry picker, review step, server validation with invalid rows marked | F-13 |
| League | History | Every season with champions and runners-up, links to frozen standings | F-16 |
| League | League rules | Read-only season configuration for every member | V-01 |
| League · owner | Settings | Every section in the F-15 table, locked-state explanations, Discord announcement, end season (type year), start next season, delete (type name), remove participant | F-15, F-16 |
| Movies tab | Search | Search field, year filter, results grid, detail | F-06 |
| Wishlist tab | My wishlist / League wishlists | Sort, remove, league status labels, share toggle, league-mate picker with overlaps | F-07 |
| Inbox | Notifications | Latest 50, unread badge, mark one/all read, routing to the right league screen, stale-destination fallback | F-17 |
| Account tab | Settings | Profile photo, display name, email (read-only, support link), appearance, connected accounts, change password, help, legal, support for email change/data export, delete account | F-03, F-02, L-02, D-11 |
| Account tab | Growth dashboard | App administrators only | F-18 |
