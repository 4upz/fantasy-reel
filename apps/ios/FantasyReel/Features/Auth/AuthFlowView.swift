import SwiftUI

/// Signed-out screens pushed from Welcome.
enum AuthRoute: Hashable {
    case logIn
    case signUp
    /// Pre-filled with whatever the person typed on Log In.
    case resetPassword(email: String = "")
}

/// The signed-out experience (F-01, F-02): Welcome, then Log in / Sign up.
struct AuthFlowView: View {
    @Environment(SessionStore.self) private var session
    @State private var path: [AuthRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView()
                .navigationDestination(for: AuthRoute.self) { route in
                    switch route {
                    case .logIn: LogInView()
                    case .signUp: SignUpView()
                    case .resetPassword(let email): ResetPasswordView(initialEmail: email)
                    }
                }
        }
        // A link that couldn't sign in lands where the person can act on it:
        // Log In, or Reset Password to send a fresh reset link.
        .task(id: session.authLinkNotice?.id) {
            guard let notice = session.authLinkNotice else { return }
            path = [notice.isRecovery ? .resetPassword() : .logIn]
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
