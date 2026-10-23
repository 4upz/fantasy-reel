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

## Sign-in setup

Email and password, Google and Discord work against local Supabase as they
are. Two pieces need settings from outside the repo:

- **Sign in with Apple** needs the Apple Developer account. Until then the
  Apple button shows "Sign in with Apple didn't finish" in the Simulator. Once
  the bundle ID is registered with the Sign in with Apple capability, turn on
  the Apple provider in Supabase (Authentication → Providers → Apple) and add
  the bundle ID to its Client IDs; the app's native flow needs no secret. To
  try it locally, set `enabled = true` and `client_id = "com.fantasyreel.ios"`
  under `[auth.external.apple]` in `supabase/config.toml`.
  A free personal team can't sign this capability for a phone. If Xcode
  reports a signing error about it, add `CODE_SIGN_ENTITLEMENTS =` to
  `Config/Local.xcconfig`; everything except the Apple button keeps working.
- **The security check (CAPTCHA)** only appears when `TURNSTILE_SITE_KEY` is
  set. Local Supabase has CAPTCHA off, so Debug leaves it empty. Production
  requires it (see the release checklist).

## Screenshots for pull requests

CI captures fixed screens (`FantasyReel/App/ScreenshotScenes.swift`) in light
and dark mode on every iOS run and uploads them as the `ios-screenshots`
artifact. To show them in a PR description, add the `ios-screenshots` label:
the next run commits smaller copies to `apps/ios/docs/screenshots/` on the PR
branch, which the description can link. Remove the label once they're in, since
GitHub won't start CI on that bot commit by itself; your next push runs it. A
capture that comes out blank is retried, and if it stays blank nothing is
committed and the step fails, so check the run's warnings. To add a
screen, add a case to `ScreenshotScene`; signed-in scenes run the real shell
over in-memory repositories seeded in `ScreenshotData` (League of Culture,
the four seeded test accounts). Locally, set the `FR_SCREENSHOT`
environment variable to a case name in the scheme's Run options.

## Not yet done (tracked for feature work)

- Every feature screen beyond sign-in and the shell (see the folder table in
  ARCHITECTURE.md for which thread owns which).
- TMDb attribution ("This product uses the TMDb API but is not endorsed or
  certified by TMDb.", with TMDb's logo) goes on the screens that show movie
  data, as the web does; the sign-in screens show none.
- Universal Links (needs the Apple team ID and an `apple-app-site-association`
  file on the website).

## Release checklist (before the first TestFlight build)

- **Privacy policy.** Add this approved sentence (Arik, 2026-10-16) to the
  "Cookies, analytics, and session replay" section of
  `apps/frontend/app/privacy/page.tsx`, after the cookies sentence, and update
  its `effectiveDate`: *"In our iPhone app, your sign-in session is kept in the
  iPhone's Keychain and your preferences in the app's storage on your device;
  deleting the app removes the preferences."* If the app adds analytics, crash
  reporting or push by then, the policy needs more than this sentence.
- **Push notifications (O-01).** In the Apple Developer account, turn on Push
  Notifications and Time Sensitive Notifications for the bundle ID, create an
  APNs auth key (.p8), and set three Supabase Edge Function secrets: `APNS_KEY_P8`
  (the whole file), `APNS_KEY_ID` and `APNS_TEAM_ID`. Until they are set,
  `send-push-notifications` sends nothing and reports `apns_not_configured`.
  Test on a real iPhone: the simulator can't receive a remote push from APNs.
- **Supabase redirect URLs.** Add `fantasyreel://auth/callback` and
  `fantasyreel://auth/callback?flow=recovery` in the production dashboard under
  Authentication → URL Configuration. The **Reset password** email template must
  pass `{{ .RedirectTo }}` on (`supabase/templates/recovery.html` does), or a reset
  asked for in the app opens the website; see "Auth emails" in `docs/DEPLOYMENT.md`.
- **Sign in with Apple.** Register the bundle ID with the capability, enable
  the Apple provider in production Supabase with the bundle ID as a Client ID,
  and test it on a real iPhone, including Hide My Email (the app warns that a
  new account was made) and a first sign-in that shares the person's name.
  The custom Apple button draws the system `apple.logo` symbol; Apple's design
  rules ask custom buttons to use the logo-only artwork from Apple Design
  Resources, so swap that PDF into the asset catalog (vector data preserved)
  in `ProviderSignInButton.Provider.logo`.
- **Apple token revocation on account deletion** (App Review 5.1.1(v)). Set
  the `delete-account` Edge Function secrets `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
  `APPLE_PRIVATE_KEY` (a Sign in with Apple key from the developer portal, the
  `.p8` contents) and `APPLE_CLIENT_ID` (the bundle ID). Without them deletion
  still works and logs a warning, but Apple keeps the app listed under the
  person's Apple ID.
- **Discord bot install link.** Put the bot's public application ID (the web's
  `NEXT_PUBLIC_DISCORD_CLIENT_ID`) in `FR_DISCORD_CLIENT_ID`; empty hides the
  "Add to Discord" button in the guide.
- **Security check.** Put the web's public Turnstile site key
  (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) in `TURNSTILE_SITE_KEY` for Release, and
  make sure the key's allowed hostnames include `fantasyreel.com` (the app's
  challenge page uses the website's origin). Release refuses to launch while
  the placeholder is there.
- **Privacy policy for Apple sign-in and the security check.** Approved
  wording (Arik, 2026-10-17): in "Information we collect", *"Google, Discord
  or Apple sign-in shares basic profile information with us, but not your
  password. If you use Apple's Hide My Email, we receive a private address
  that forwards to you."*; in "Service providers", *"Google, Discord and Apple
  process information when you use their sign-in or connected features, under
  their own policies."* and *"Cloudflare Turnstile runs a security check when
  you sign up, log in or reset your password, to block automated abuse.
  Cloudflare processes technical information from your browser or device to
  do this, under its own policy."*
