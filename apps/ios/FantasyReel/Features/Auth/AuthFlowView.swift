import SwiftUI

/// Signed-out screens pushed from Welcome.
enum AuthRoute: Hashable {
    case logIn
    case signUp
    /// Pre-filled with whatever the person typed on Log In.
    case resetPassword(email: String = "")
}

/// The signed-out stack. Log In and Sign Up link to each other by swapping
/// the screen rather than pushing, so going back and forth never piles up.
@Observable
@MainActor
final class AuthNavigation {
    var path: [AuthRoute] = []

    /// Replaces the current auth screen (Welcome stays underneath).
    func switchTo(_ route: AuthRoute) {
        path = [route]
    }
}

/// The signed-out experience (F-01, F-02): Welcome, then Log in / Sign up.
struct AuthFlowView: View {
    @Environment(SessionStore.self) private var session
    @State private var navigation = AuthNavigation()

    var body: some View {
        NavigationStack(path: $navigation.path) {
            WelcomeView()
                .navigationDestination(for: AuthRoute.self) { route in
                    switch route {
                    case .logIn: LogInView()
                    case .signUp: SignUpView()
                    case .resetPassword(let email): ResetPasswordView(initialEmail: email)
                    }
                }
        }
        .environment(navigation)
        // A link that couldn't sign in lands where the person can act on it:
        // Log In, or Reset Password (over Log In) to send a fresh reset link.
        .task(id: session.authLinkNotice?.id) {
            guard let notice = session.authLinkNotice else { return }
            navigation.path = notice.isRecovery ? [.logIn, .resetPassword()] : [.logIn]
        }
    }
}

/// The full how-to-play guide, signed in or out (F-01).
struct HowToPlayView: View {
    var body: some View {
        FeaturePlaceholderView(title: "How to Play", requirements: "F-01", systemImage: "questionmark.circle", showsHeader: false)
    }
}

/// Public legal pages. The app links to the published web pages so the text
/// stays a single legal source (F-01).
enum LegalLinks {
    static func privacy(site: URL) -> URL { site.appending(path: "privacy") }
    static func terms(site: URL) -> URL { site.appending(path: "terms") }
}
