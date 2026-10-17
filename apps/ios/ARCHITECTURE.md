# Fantasy Reel iOS architecture

This is the contract every iOS feature thread builds on. The product requirements
live in `docs/IOS-REQUIREMENTS.md` (branch `codex/ios-parity-requirements`, PR #148);
the screen designs are the **v2** page of the "Native iOS mockups" design canvas.
Where this file and those disagree, raise it rather than silently picking one.

## Platform and toolchain

- **Xcode 26, Swift 6.2, iOS 26.0 minimum, iPhone only.** iOS 26 is what gives us
  Liquid Glass (`.glassEffect`, glass toolbars, the separated search tab) without
  hand-rolled blur. iPad is a later decision (O-03).
- Swift 6 language mode everywhere (strict concurrency). The app target sets
  `SWIFT_DEFAULT_ACTOR_ISOLATION = nonisolated` and
  `SWIFT_APPROACHABLE_CONCURRENCY = NO` on purpose, to match the package: nothing
  is main-actor by default, so mark every view model, store and UI helper
  `@MainActor` explicitly. Don't change these per feature.
- One third-party dependency: `supabase-swift` (2.x), pinned in
  `Packages/FantasyReelKit/Package.swift`. Add another only with a reason in the PR.

## Layout

```
apps/ios/
├── FantasyReel.xcodeproj         One app target. Its source folder is a *synchronized*
│                                 group: drop a .swift file into FantasyReel/ and it is
│                                 compiled. Feature work never needs to edit the project.
├── Config/                       xcconfigs (Supabase URL/key per build) and Info.plist.
│                                 FantasyReel.entitlements (Sign in with Apple; Universal
│                                 Links will join it). Local overrides go in
│                                 Config/Local.xcconfig (gitignored).
├── FantasyReel/                  The app target: everything SwiftUI
│   ├── App/                      @main, AppEnvironment (dependency container), RootView
│   ├── Session/                  SessionStore (auth state + every auth action)
│   ├── Navigation/               Shell: league tabs, top bar, menu sheet, routing
│   ├── Infrastructure/           AsyncAction, announcements, foreground refresh
│   ├── DesignSystem/             Tokens (color, type, spacing) and shared components
│   ├── Features/<Area>/          One folder per feature area (see below)
│   └── Resources/                Asset catalog, fonts
└── Packages/FantasyReelKit/      Swift package, no SwiftUI
    ├── FantasyReelCore           Models, IDs, DateOnly, JSON coding, scoring, tab
    │                             rules, deep links, league grouping. Pure + tested.
    └── FantasyReelAPI            AppConfiguration, SupabaseProvider, EdgeFunctionClient,
                                  APIError, repositories, ChangeFeed (Realtime).
```

### Feature folders and owners

Each feature thread owns its folder under `FantasyReel/Features/` and, if it needs
pure logic or a repository, a matching file group in the package
(`FantasyReelCore/<Area>/`, `FantasyReelAPI/<Area>/`). Shared files (DesignSystem,
Navigation, Session, Core models listed below) change only with a note in the PR
saying why, so parallel threads don't collide.

| Folder | Screens (mockup v2) | Requirements |
| --- | --- | --- |
| `Auth` | Welcome, Log in, Sign up, Reset password | F-01, F-02, N-02, N-03, L-01 |
| `Leagues` | No leagues, Create league, Join league, invitations in the menu sheet | F-04, F-05 |
| `LeagueHome` | Home (overview) tab, edit team, completed season | F-10, F-16 |
| `Draft` | Draft setup, live draft, movie picker, counterpick round | F-08, F-09 |
| `Roster` | Roster tab, drops, team projection sheet | F-11, F-19 |
| `Bids` | Bids tab, place bid sheet, bid priorities | F-12 |
| `Trades` | Trades tab, trade composer | F-13 |
| `Standings` | Standings tab, team detail, projected standings | F-14, F-19 |
| `Movies` | Search tab, league movie detail | F-06, F-19 |
| `Wishlist` | Wishlist | F-07 |
| `Inbox` | Notifications | F-17 |
| `Account` | Account, delete account, admin dashboard | F-03, L-02, F-18 |
| `LeagueRules` | League rules (read-only) | V-01 |
| `LeagueSettings` | Owner settings, history | F-15, F-16 |

Today each folder holds a placeholder root view that the shell already routes to.
A feature thread replaces the placeholder's body; it keeps the type name and
initializer so the shell keeps compiling.

## Navigation (mockup v2)

- **Signed out:** `Auth` flow. **Signed in, no leagues:** `NoLeaguesView` with glass
  buttons at the top (avatar opens the menu sheet; search; notifications).
- **Signed in with a league:** `LeagueShellView` is a native `TabView`.
  - Before the season (setup, drafting, counterpicking): **Home, Draft, Roster**; opens on Draft.
  - Active: **Home, Roster, Bids, Trades, Standings**; opens on Home.
  - Completed: **Home, Standings, Roster, Draft** (mockup "Season complete").
  - A `Tab(role: .search)` gives the round search button beside the tab bar.
  - Rules live in `FantasyReelCore/Navigation/LeagueNavigation.swift` with tests.
- **Top bar:** a glass league pill (leading) opens the **menu sheet** (other leagues,
  invitations, create/join, Wishlist, Notifications, Account, How to Play, Support).
  Trailing: notifications bell with unread badge, and a league `⋯` menu with Rules,
  Draft results (active), History (2+ seasons), Settings (owner), and Share
  invite (owner, setup). `⋯` destinations push onto the current tab's stack.
- **One sheet per task, never a sheet on a sheet.** The menu sheet has its own
  `NavigationStack`; the bell opens that same sheet already showing Notifications.
  A flow that needs several steps (bid, trade, pick) is one sheet with pushes inside.
- **Every sheet goes through `ShellSheet`.** Never attach a local `.sheet` or
  `.fullScreenCover`. Add a case carrying the sheet's input (`case placeBid(MovieID)`)
  and map it in `ShellSheetView` (`SignedInRootView.swift`); present with
  `router.present(_:)`. While a sheet's form holds unsaved input, set
  `router.sheetHasUnsavedInput = true`; a link or the bell then asks before
  replacing it. Confirmation dialogs and alerts are fine locally.
- **Links only pre-fill.** Any app or website can open `fantasyreel://` links, so a
  sheet opened from a link (join code, invitation) fills in its form and waits for
  the user to tap the action. Nothing mutates on open.
- **Screen state is per season.** `LeagueShellView` is rebuilt when the league
  changes (`.id(season.id)`), so a tab root's `@State` model never outlives its
  season. Read the league from `\.leagueSelection`; don't cache the ID elsewhere.
- **"+" in the top bar:** a tab root that creates something adds the glass "+" with
  the `leagueTopBar` primary-action API in `LeagueTopBar.swift`, not a floating button.
- **Tab badges** (Bids: outbid count; Trades: offers waiting on you) are not wired
  yet. The Bids and Trades threads add `.badge(_:)` to their `Tab` in
  `LeagueShellView` from a small shell-level store; iOS draws both badges red.
- Routing: `ShellRouter` (`Navigation/ShellRouter.swift`) owns the selected tab, one
  `NavigationPath`-like array per tab, and the active sheet. Use
  `router.push(_:)`, `router.select(_:)`, `router.presentMenu(_:)`. Destinations are
  the `LeagueRoute` and `MenuRoute` enums; add a case for a new screen.
- Deep links (`DeepLink.parse`) arrive through `onOpenURL`; signed-out links are held
  by `SessionStore.pendingDeepLink` and replayed after sign-in.
- **Password recovery:** while `SessionStore.isRecoveringPassword` is true (a reset
  link signed the user in), `RootView` shows `ChooseNewPasswordView` in place of the
  app; saving a password or signing out ends it. `showsAppleRelayNotice` works the
  same way for a new Hide My Email account (L-01).
- **Auth wording and CAPTCHA:** `AuthService` returns the web's sentences
  (`AuthMessages`) with the Auth error code kept in `serverCode`. Any form that
  calls a CAPTCHA-protected endpoint (password sign-in, sign-up, reset, resend,
  reauthentication) owns a `SecurityCheck`, shows `SecurityCheckView`, checks
  `isReady` on submit and sends `take()` as the token.

## Layout rules from the design review

16pt page margin · 22pt card radius, no card inside a card · 64pt movie rows with
36×54 posters, one-line titles and a fixed 64pt trailing points column · one filled
primary action per card · a glass "+" in the top bar instead of floating create
buttons · whole-number points ("+28", "−4") · one sheet per multi-step task.
`DesignSystem/` implements these; prefer its components over new one-offs.

## Data and networking

- **Reads** use the Supabase client directly under RLS, as the web does:
  `env.supabase.client.from("leagues").select()...` inside a repository.
  Active rosters come only from the `team_holdings` view.
- **Mutations and anything complex** go through Edge Functions with
  `EdgeFunctionClient.invoke(_:body:timeout:)`. It attaches the session token, a
  per-request `x-request-id`, a deadline that covers token lookup + transport + decode,
  and turns failures into `APIError` (server message, status, code, raw body,
  `invalid_source_ids`, rate limit with retry time, timeout = *uncertain result*).
  Never auto-retry a mutation; reconcile instead (N-04).
- Draft mutations carry a durable `request_id` UUID per logical attempt — distinct
  from the tracing header — and keep it across an uncertain retry (F-08).
- **Wire format:** snake_case keys with explicit `CodingKeys` in every model (no key
  strategy, it would mangle JSON dictionaries). `FRJSON.decoder` handles Postgres
  timestamps with or without fractional seconds. Date-only columns are `DateOnly`,
  never `Date`. Unknown enum values decode to `.unknown(String)` and enable nothing.
- IDs are typed (`LeagueID`, `TeamID`, `HoldingID`, …) so a TMDb ID can't be passed
  where a holding ID belongs.
- **Realtime** is an invalidation signal only (`ChangeFeed`); after a change,
  re-read a coherent state. Pair it with `.refreshOnForeground` (N-05).
- Account switch / sign-out rebuilds the whole signed-in tree (`RootView` keys it by
  user ID), which drops every in-memory cache. Disk caches must be keyed by user ID.

## UI state conventions

- View models are `@Observable @MainActor final class`es owned by the screen
  (`@State var model = ...`). A view model takes the specific repositories it uses
  (`init(holdings: any HoldingsRepository, ...)`), never the whole `AppEnvironment`;
  the view reads `@Environment(AppEnvironment.self)` and passes them in.
- **Repositories are protocols** with a live `Supabase…Repository` and an in-memory
  fake (`FantasyReelAPI/Repositories/`). Add your feature's pair the same way, so
  previews (`AppEnvironment.preview(...)`) and tests never touch the network.
- Async loads expose `LoadState<Value>` and render with `LoadStateView`: loading,
  loaded, empty, failed(retry). Every screen has loading/empty/error states (N-07).
- Buttons that call the server use `AsyncAction` (the `useAsyncAction` equivalent):
  a second tap while running is ignored, and the error stays visible inline.
- Errors are inline, never transient toasts. Announce status changes with
  `Announcer.announce(_:)`.
- Accessibility is part of done: Dynamic Type (all fonts scale), VoiceOver labels for
  scores ("plus 28 points", "pending"), 44pt targets, nothing by color alone.

## Configuration

`Config/Debug.xcconfig` points at local Supabase (`http://127.0.0.1:54321`); a
simulator reaches the Mac's localhost directly. Put a different URL/key (a phone
on your network, staging, production) in `Config/Local.xcconfig`, which is
gitignored and included last. Only the public anon key ever ships in the app.

## Testing

- Pure logic goes in `FantasyReelCore` with Swift Testing (`@Test`) — run with
  ⌘U on the `FantasyReelKit-Package` scheme in Xcode; CI runs it on every push.
- Port web fixtures where the web has them (scoring, rounding, bid-fit forecast).
- SwiftUI previews use the sample data in `DesignSystem/Previews/SampleData.swift`.
