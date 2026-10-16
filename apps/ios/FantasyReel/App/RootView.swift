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
                SignedInRootView(account: account, environment: environment)
                    // A new account gets a brand-new tree: no cache, stack or
                    // selection from the previous account survives (N-02, N-05).
                    .id(account.id)
                    .transition(.opacity)
            }
        }
        .animation(.default, value: session.state)
        .task { session.start() }
        .onOpenURL { url in handle(url) }
    }

    private func handle(_ url: URL) {
        guard let link = environment.deepLink(from: url) else { return }
        if case .authCallback(let callbackURL) = link {
            Task { await session.handleAuthCallback(callbackURL) }
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
