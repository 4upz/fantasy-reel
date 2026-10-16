import SwiftUI

/// Signed-out screens pushed from Welcome.
enum AuthRoute: Hashable {
    case logIn
    case signUp
    case resetPassword
}

/// The signed-out experience (F-01, F-02): Welcome, then Log in / Sign up.
struct AuthFlowView: View {
    @State private var path: [AuthRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView()
                .navigationDestination(for: AuthRoute.self) { route in
                    switch route {
                    case .logIn: LogInView()
                    case .signUp: SignUpView()
                    case .resetPassword: ResetPasswordView()
                    }
                }
        }
    }
}

/// Create an account (F-02): display name, email, password ≥ 8 + confirm,
/// providers, legal notice, CAPTCHA, check-your-email state.
struct SignUpView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Sign Up", requirements: "F-02, N-03", systemImage: "person.badge.plus", showsHeader: false)
    }
}

/// Request a reset link (non-enumerating), and choose a new password from it (F-02).
struct ResetPasswordView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Reset Password", requirements: "F-02", systemImage: "key", showsHeader: false)
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
