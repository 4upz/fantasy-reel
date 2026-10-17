import AuthenticationServices
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
    /// Sign-ins that decide more than "signed in" (Apple's relay notice, a
    /// reset link) run with the listener's sign-in events held, so the app
    /// isn't built and torn down again before the right screen is known.
    private var heldSignIns = 0
    private let defaults: UserDefaults

    init(auth: AuthService, defaults: UserDefaults = .standard) {
        self.auth = auth
        self.defaults = defaults
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
                if let restored {
                    // A reset link that signed in before the app was closed
                    // still needs its new password.
                    self.isRecoveringPassword = self.recoveryPendingUserID == restored.id.rawValue
                    self.state = .signedIn(restored)
                } else {
                    self.state = .signedOut
                }
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
            guard heldSignIns == 0 else { return }
            setSignedIn(account)
        case .passwordRecovery(let account):
            beginRecovery(for: account)
            setSignedIn(account)
        case .signedOut:
            clearSignedInState()
            state = .signedOut
        }
    }

    private func setSignedIn(_ account: AuthService.Account) {
        if authLinkNotice != nil { authLinkNotice = nil }
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
        endRecovery()
    }

    /// Provider sign-in. Cancelling the system sheet is not an error and leaves
    /// any existing session untouched.
    func signIn(with provider: AuthService.OAuthProvider) async throws(APIError) {
        if let account = try await auth.signIn(with: provider) {
            setSignedIn(account)
        }
    }

    /// Sign in with Apple, from a native authorization (L-01). The relay
    /// notice is decided before the app is shown, so a link held for after
    /// sign-in survives until the person continues.
    func signInWithApple(idToken: String, nonce: String, appleUserID: String, fullName: String?) async throws(APIError) {
        heldSignIns += 1
        defer { heldSignIns -= 1 }
        // Apple sends the name once; keep it until a sign-in uses it.
        if let fullName { AppleCredentialStore.setPendingName(fullName, for: appleUserID) }
        let name = fullName ?? AppleCredentialStore.pendingName(for: appleUserID)
        let result = try await auth.signInWithApple(idToken: idToken, nonce: nonce, fullName: name)
        AppleCredentialStore.setPendingName(nil, for: appleUserID)
        AppleCredentialStore.signedInAppleUserID = appleUserID
        showsAppleRelayNotice = result.isNewRelayAccount
        setSignedIn(result.account)
    }

    /// Signs out when the person has stopped using Apple with Fantasy Reel
    /// (Settings → Apple ID), as Apple asks. Checked at launch and foreground.
    func checkAppleCredential() async {
        guard account != nil, let appleUserID = AppleCredentialStore.signedInAppleUserID else { return }
        guard let credentialState = try? await ASAuthorizationAppleIDProvider().credentialState(forUserID: appleUserID) else { return }
        switch credentialState {
        case .revoked, .notFound:
            await signOut()
            authLinkNotice = AuthLinkNotice(
                message: "Sign in with Apple was turned off for Fantasy Reel. Sign in again to continue.",
                isRecovery: false
            )
        default:
            break
        }
    }

    func signOut() async {
        await auth.signOut()
        clearSignedInState()
        state = .signedOut
    }

    private func clearSignedInState() {
        pendingDeepLink = nil
        endRecovery()
        showsAppleRelayNotice = false
        AppleCredentialStore.signedInAppleUserID = nil
    }

    // MARK: Password recovery, remembered until a new password is saved

    private static let recoveryKey = "fr.recoveryPendingUserID"

    private var recoveryPendingUserID: String? {
        defaults.string(forKey: Self.recoveryKey)
    }

    private func beginRecovery(for account: AuthService.Account) {
        isRecoveringPassword = true
        defaults.set(account.id.rawValue, forKey: Self.recoveryKey)
    }

    private func endRecovery() {
        isRecoveringPassword = false
        defaults.removeObject(forKey: Self.recoveryKey)
    }

    /// Handles `fantasyreel://auth/callback?...` from an email link or OAuth.
    func handleAuthCallback(_ url: URL) async {
        let isRecovery = AppConfiguration.isRecoveryCallback(url)
        heldSignIns += 1
        defer { heldSignIns -= 1 }
        do {
            let account = try await auth.completeSignIn(from: url)
            if isRecovery {
                beginRecovery(for: account)
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
