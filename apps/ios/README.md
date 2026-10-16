# Fantasy Reel for iOS

The native iPhone app. It talks to the same Supabase backend as the web app, so
the same accounts, leagues and seasons show up in both.

New to iOS? Read this page top to bottom once. [ARCHITECTURE.md](ARCHITECTURE.md)
is the reference for how the code is organized and the rules feature work follows.

## What you need

- A Mac with **Xcode 26** or newer (free from the Mac App Store). The app uses
  iOS 26 features (Liquid Glass), so older Xcode versions can't build it.
- **Docker Desktop**, to run the local Supabase stack the Debug build talks to.
- Node, already needed for the web app (`npm install` at the repo root).

You do **not** need a paid Apple Developer account to run in the Simulator.

## First run

1. From the repo root, start the backend and seed test users:
   ```bash
   npx supabase start
   npx supabase db reset   # only the first time: wipes local data and seeds test users
   ```
2. Open `apps/ios/FantasyReel.xcodeproj` in Xcode.
3. Wait for "Resolving Package Graph" to finish (top of the window). Xcode
   downloads `supabase-swift` the first time.
4. Pick a simulator in the toolbar (for example **iPhone 17**) and press **⌘R**.
5. Tap **Log In** and use a seeded account, e.g. `alice@fantasyreel.test` /
   `testpass123!` (all four are listed in the repo's `CLAUDE.md`).

Run the unit tests by picking the **FantasyReelKit-Package** scheme in the
toolbar (next to the simulator menu) and pressing **⌘U**. They live in the
`FantasyReelKit` package. CI runs the same build and tests on every push that
touches `apps/ios/` (`.github/workflows/ios.yml`).

## Running on your own iPhone

1. Copy `Config/Local.example.xcconfig` to `Config/Local.xcconfig`.
2. Set `DEVELOPMENT_TEAM` to your team ID (Xcode → Settings → Accounts shows it;
   a free personal team works for your own device).
3. A phone can't reach your Mac's `127.0.0.1`. Set `SUPABASE_URL` in
   `Local.xcconfig` to your Mac's address on the same Wi-Fi, e.g.
   `http:/$()/192.168.1.20:54321` (the odd `$()` keeps xcconfig from reading
   `//` as a comment).

`Local.xcconfig` is gitignored, so these stay on your machine.

## How the pieces fit (short version)

| Folder | What lives there |
| --- | --- |
| `FantasyReel/App` | App entry point and the dependency container (`AppEnvironment`). |
| `FantasyReel/Session` | `SessionStore`: who is signed in, sign-in/out, auth links. |
| `FantasyReel/Navigation` | The shell: league tab bar, top bar, menu sheet, routing. |
| `FantasyReel/DesignSystem` | Colors, fonts and shared components from the v2 mockups. |
| `FantasyReel/Features/*` | One folder per feature. Most are placeholders today. |
| `Packages/FantasyReelKit` | Models, scoring, networking. No UI, fully unit-tested. |
| `Config` | Build settings: backend URL/key, bundle ID, URL scheme. |

The Xcode project uses a **synchronized folder**: any `.swift` file you add under
`FantasyReel/` is compiled automatically. You never need to edit the project file
to add a screen.

## Decisions made in this foundation

- **iOS 26 minimum, iPhone only.** The approved v2 designs are Liquid Glass,
  which is iOS 26. iPad can come later.
- **SwiftUI + Observation**, no third-party UI libraries. The only dependency is
  the official Supabase client.
- **Bundle ID `com.fantasyreel.ios`** and URL scheme `fantasyreel` are
  placeholders until the Apple Developer account is set up (requirements §11).
  Change them in `Config/Base.xcconfig`.
- Sign-in links come back to `fantasyreel://auth/callback`, and password-reset
  links to `fantasyreel://auth/callback?flow=recovery`. Local Supabase allows both
  (`supabase/config.toml`); the production Supabase dashboard needs the same two
  URLs added under Authentication → URL Configuration before release.

## Not yet done (tracked for feature work)

- Every feature screen beyond sign-in and the shell (see the folder table in
  ARCHITECTURE.md for which thread owns which).
- Sign in with Apple (L-01), CAPTCHA for production sign-in (N-03), Universal
  Links (needs the Apple team ID and an `apple-app-site-association` file on the
  website), push notifications (optional, O-01).
