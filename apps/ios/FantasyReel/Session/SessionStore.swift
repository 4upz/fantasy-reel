import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// Who is signed in, and every auth action the screens can take (F-02, N-02).
///
/// `RootView` switches on `state`. The signed-in tree is rebuilt per account
/// (keyed by user ID), so signing out or switching accounts drops every
/// in-memory cache and navigation stack with it.
@Observable
@MainActor
final class SessionStore {
    enum State: Equatable {
        /// Restoring the Keychain session at launch.
        case restoring
        case signedOut
        case signedIn(AuthService.Account)
    }

    private(set) var state: State = .restoring
    /// Set when a password-recovery link signs the user in: show "choose a new password".
    var isRecoveringPassword = false
    /// A link that arrived while signed out (an invitation, a league). Replayed
    /// once the user signs in, then cleared (N-02).
    var pendingDeepLink: DeepLink?
    /// Why the latest incoming auth link didn't sign in, for the signed-out
    /// screens to show. Cleared by the next successful sign-in.
    var authLinkNotice: AuthLinkNotice?
    /// Sign in with Apple just created a new account behind Hide My Email; the
    /// person may already play under another sign-in method (L-01).
    var showsAppleRelayNotice = false

    private let auth: AuthService
    private var listener: Task<Void, Never>?

    init(auth: AuthService) {
        self.auth = auth
    }

    var account: AuthService.Account? {
        if case .signedIn(let account) = state { return account }
        return nil
    }

    /// Follows auth changes for the app's lifetime and restores the stored
    /// session. Listening starts first, so a sign-in link opened at cold launch
    /// can't be overwritten by the restore result.
    func start() {
        guard listener == nil else { return }
        listener = Task { [weak self, auth] in
            let changes = auth.changes()
            let restored = await auth.restoreSession()
            if let self, case .restoring = self.state {
                self.state = restored.map(State.signedIn) ?? .signedOut
            }
            for await change in changes {
                guard let self else { return }
                self.apply(change)
            }
        }
    }

    private func apply(_ change: AuthService.Change) {
        switch change {
        case .signedIn(let account), .updated(let account):
            setSignedIn(account)
        case .passwordRecovery(let account):
            isRecoveringPassword = true
            setSignedIn(account)
        case .signedOut:
            state = .signedOut
            isRecoveringPassword = false
            showsAppleRelayNotice = false
        }
    }

    private func setSignedIn(_ account: AuthService.Account) {
        authLinkNotice = nil
        // Avoid rebuilding the signed-in tree on a token refresh for the same user.
        if self.account != account {
            state = .signedIn(account)
        }
    }

    // MARK: Actions. Each throws APIError for the screen to show inline.

    func signIn(email: String, password: String, captchaToken: String? = nil) async throws(APIError) {
        let account = try await auth.signIn(email: email, password: password, captchaToken: captchaToken)
        setSignedIn(account)
    }

    /// Returns true when the account is signed in immediately, false when the
    /// user must confirm their email first.
    func signUp(email: String, password: String, displayName: String, captchaToken: String? = nil) async throws(APIError) -> Bool {
        guard let account = try await auth.signUp(email: email, password: password, displayName: displayName, captchaToken: captchaToken) else {
            return false
        }
        setSignedIn(account)
        return true
    }

    func resendConfirmation(email: String, captchaToken: String? = nil) async throws(APIError) {
        try await auth.resendConfirmation(email: email, captchaToken: captchaToken)
    }

    func sendPasswordReset(email: String, captchaToken: String? = nil) async throws(APIError) {
        try await auth.sendPasswordReset(email: email, captchaToken: captchaToken)
    }

    func updatePassword(_ password: String) async throws(APIError) {
        try await auth.updatePassword(password)
        isRecoveringPassword = false
    }

    /// Provider sign-in. Cancelling the system sheet is not an error and leaves
    /// any existing session untouched.
    func signIn(with provider: AuthService.OAuthProvider) async throws(APIError) {
        if let account = try await auth.signIn(with: provider) {
            setSignedIn(account)
        }
    }

    /// Sign in with Apple, from a native authorization (L-01).
    func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws(APIError) {
        let result = try await auth.signInWithApple(idToken: idToken, nonce: nonce, fullName: fullName)
        showsAppleRelayNotice = result.isNewRelayAccount
        setSignedIn(result.account)
    }

    func signOut() async {
        await auth.signOut()
        pendingDeepLink = nil
        isRecoveringPassword = false
        showsAppleRelayNotice = false
        state = .signedOut
    }

    /// Handles `fantasyreel://auth/callback?...` from an email link or OAuth.
    func handleAuthCallback(_ url: URL) async {
        let isRecovery = AppConfiguration.isRecoveryCallback(url)
        do {
            let account = try await auth.completeSignIn(from: url)
            if isRecovery {
                isRecoveringPassword = true
            }
            setSignedIn(account)
        } catch {
            // Already signed in (a stale or duplicate link): nothing to report.
            guard account == nil else { return }
            // A link requested on another device has no PKCE verifier here, but
            // a confirmation link still confirmed the email server-side. Say
            // that instead of reporting a bare failure (F-02).
            let failure = AuthLinkFailure.classify(url, exchangeErrorCode: error.serverCode)
            authLinkNotice = AuthLinkNotice(message: failure.message(isRecovery: isRecovery), isRecovery: isRecovery)
        }
    }

    /// Takes the pending link exactly once.
    func consumePendingDeepLink() -> DeepLink? {
        defer { pendingDeepLink = nil }
        return pendingDeepLink
    }
}

/// A signed-out notice about an auth link. Recovery notices open on the reset
/// screen, where the person can send a fresh link; the rest on Log In.
struct AuthLinkNotice: Equatable, Identifiable {
    let id = UUID()
    let message: String
    let isRecovery: Bool
}
