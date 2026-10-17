import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Chooses between launch, signed-out and signed-in, and is the single entry
/// point for incoming URLs (auth callbacks, shared links).
struct RootView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session

    var body: some View {
        ZStack {
            Color.frBackground.ignoresSafeArea()
            switch session.state {
            case .restoring:
                LaunchView()
            case .signedOut:
                AuthFlowView()
                    .transition(.opacity)
            case .signedIn(let account):
                if session.isRecoveringPassword {
                    // A reset link signed in: choosing the new password comes
                    // first and can't be swiped away (F-02).
                    ChooseNewPasswordView()
                        .transition(.opacity)
                } else if session.showsAppleRelayNotice {
                    AppleRelayNoticeView()
                        .transition(.opacity)
                } else {
                    SignedInRootView(account: account, environment: environment)
                        // A new account gets a brand-new tree: no cache, stack or
                        // selection from the previous account survives (N-02, N-05).
                        .id(account.id)
                        .transition(.opacity)
                }
            }
        }
        .animation(.default, value: session.state)
        .animation(.default, value: session.isRecoveringPassword)
        .animation(.default, value: session.showsAppleRelayNotice)
        .task { session.start() }
        // Someone who stops using Apple with Fantasy Reel (Settings → Apple ID)
        // is signed out at launch, after sign-in, and on return to the app.
        .task(id: session.account?.id) { await session.checkAppleCredential() }
        .refreshOnForeground { await session.checkAppleCredential() }
        .onOpenURL { url in handle(url) }
    }

    private func handle(_ url: URL) {
        guard let link = environment.deepLink(from: url) else { return }
        if case .authCallback(let callbackURL) = link {
            Task { await session.handleAuthCallback(callbackURL) }
            return
        }
        // How to Play is public, so signed out it opens now, without
        // replacing a link held for after sign-in (an invitation).
        if link == .help, session.state == .signedOut {
            session.publicHelpRequest = UUID()
            return
        }
        // Signed-in routing happens in SignedInRootView, which observes this.
        session.pendingDeepLink = link
    }
}

/// The brand mark on the app background while the stored session is restored.
struct LaunchView: View {
    var body: some View {
        Image("BrandMark")
            .resizable()
            .scaledToFit()
            .frame(width: 72, height: 72)
            .accessibilityLabel("Fantasy Reel")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
