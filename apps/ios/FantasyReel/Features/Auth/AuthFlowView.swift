import SwiftUI

/// Signed-out screens pushed from Welcome.
enum AuthRoute: Hashable {
    case logIn
    case signUp
    /// Pre-filled with whatever the person typed on Log In.
    case resetPassword(email: String = "")
    /// The full rules guide, before signing up (F-01).
    case howToPlay
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
                    case .howToPlay: HowToPlayView(isPublic: true)
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
        // How to Play is public (the web's /how-to-play), so its link opens
        // here without signing in, on top of any form in progress. Every
        // other link waits for sign-in.
        .task(id: session.publicHelpRequest) {
            // A link held while the session was restoring arrives as pending.
            if session.pendingDeepLink == .help {
                _ = session.consumePendingDeepLink()
            } else {
                guard session.publicHelpRequest != nil else { return }
            }
            session.publicHelpRequest = nil
            if navigation.path.last != .howToPlay { navigation.path.append(.howToPlay) }
        }
    }
}

/// Field prompts kept as plain `String`s: a string literal would be read as
/// Markdown, which turns an email address into a blue link.
enum AuthPlaceholders {
    static let email = "you@example.com"
}

/// Public legal pages. The app links to the published web pages so the text
/// stays a single legal source (F-01).
enum LegalLinks {
    static func privacy(site: URL) -> URL { site.appending(path: "privacy") }
    static func terms(site: URL) -> URL { site.appending(path: "terms") }
}
