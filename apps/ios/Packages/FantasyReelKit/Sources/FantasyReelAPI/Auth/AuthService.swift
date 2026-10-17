import FantasyReelCore
import Foundation
import Supabase

/// Every authentication call the app makes, in one place (requirements F-02, N-02, N-03).
///
/// Screens never touch `client.auth` directly; they go through `SessionStore` in
/// the app, which calls this. Errors come back as `APIError` with the Auth error
/// code preserved (`weak_password`, `email_not_confirmed`, …) so the auth screens
/// can map them to the web's wording.
///
/// CAPTCHA: production Supabase requires a Turnstile token on sign-up, password
/// sign-in, reset and resend (N-03). Every call that needs one takes
/// `captchaToken`; local Supabase has CAPTCHA off, so nil works there.
public struct AuthService: Sendable {
    public enum OAuthProvider: String, Sendable, CaseIterable {
        case apple, google, discord

        var supabaseProvider: Provider {
            switch self {
            case .apple: return .apple
            case .google: return .google
            case .discord: return .discord
            }
        }
    }

    /// The account behind a session, as the app needs it.
    public struct Account: Sendable, Equatable {
        public let id: UserID
        public let email: String?

        public init(id: UserID, email: String?) {
            self.id = id
            self.email = email
        }
    }

    /// What changed, reduced to what the app acts on.
    public enum Change: Sendable, Equatable {
        case signedIn(Account)
        case signedOut
        /// The user opened a password-recovery link; show "choose a new password".
        case passwordRecovery(Account)
        /// Token refreshed or profile attributes changed; same account.
        case updated(Account)
    }

    private let provider: SupabaseProvider
    private var auth: AuthClient { provider.client.auth }

    public init(provider: SupabaseProvider) {
        self.provider = provider
    }

    /// The session stored in the Keychain. Nil when signed out.
    public func restoreSession() async -> Account? {
        // Read the stored session without a network refresh, so launching
        // offline (or with an expired access token) still opens signed in.
        // The SDK refreshes the token on the first request and emits
        // `signedOut` if the refresh token is no longer valid.
        guard let session = auth.currentSession else { return nil }
        return Self.account(session.user)
    }

    /// Auth changes for as long as the caller iterates.
    public func changes() -> AsyncStream<Change> {
        let auth = self.auth
        return AsyncStream { continuation in
            let task = Task {
                for await (event, session) in auth.authStateChanges {
                    switch event {
                    case .signedOut, .userDeleted:
                        continuation.yield(.signedOut)
                    case .passwordRecovery:
                        if let user = session?.user { continuation.yield(.passwordRecovery(Self.account(user))) }
                    case .signedIn:
                        if let user = session?.user { continuation.yield(.signedIn(Self.account(user))) }
                    case .tokenRefreshed, .userUpdated, .mfaChallengeVerified:
                        if let user = session?.user { continuation.yield(.updated(Self.account(user))) }
                    case .initialSession:
                        // Launch state is read through restoreSession().
                        break
                    @unknown default:
                        break
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Email and password

    @discardableResult
    public func signIn(email: String, password: String, captchaToken: String? = nil) async throws(APIError) -> Account {
        do {
            let session = try await auth.signIn(email: email, password: password, captchaToken: captchaToken)
            return Self.account(session.user)
        } catch {
            throw Self.authError(error, context: .signIn)
        }
    }

    /// Creates an account. Returns the account when the project signs people in
    /// immediately, nil when an email confirmation is required first.
    public func signUp(email: String, password: String, displayName: String, captchaToken: String? = nil) async throws(APIError) -> Account? {
        do {
            let response = try await auth.signUp(
                email: email,
                password: password,
                data: ["display_name": .string(displayName)],
                redirectTo: provider.configuration.authCallbackURL,
                captchaToken: captchaToken
            )
            return response.session.map { Self.account($0.user) }
        } catch {
            throw Self.authError(error, context: .signUp)
        }
    }

    /// Re-sends the sign-up confirmation email. Non-enumerating: it succeeds
    /// whether or not the address has an account, and fails only when nothing
    /// could have been sent (security check, rate limit, no connection).
    public func resendConfirmation(email: String, captchaToken: String? = nil) async throws(APIError) {
        do {
            try await auth.resend(
                email: Self.normalizedEmail(email),
                type: .signup,
                emailRedirectTo: provider.configuration.authCallbackURL,
                captchaToken: captchaToken
            )
        } catch {
            try Self.rethrowUnlessEnumerating(error)
        }
    }

    /// Sends a password-reset link that opens this app (PKCE-bound to this
    /// device). Non-enumerating, like `resendConfirmation`.
    public func sendPasswordReset(email: String, captchaToken: String? = nil) async throws(APIError) {
        do {
            try await auth.resetPasswordForEmail(
                Self.normalizedEmail(email),
                redirectTo: provider.configuration.recoveryCallbackURL,
                captchaToken: captchaToken
            )
        } catch {
            try Self.rethrowUnlessEnumerating(error)
        }
    }

    /// Sets a new password for the signed-in user (after recovery, or after the
    /// caller has re-verified the old one, as the web does).
    public func updatePassword(_ newPassword: String) async throws(APIError) {
        do {
            _ = try await auth.update(user: UserAttributes(password: newPassword))
        } catch {
            throw Self.authError(error, context: .setPassword)
        }
    }

    // MARK: Providers and links

    /// Runs the provider sign-in in the system authentication sheet. A user who
    /// cancels gets `nil` and keeps whatever session they had.
    public func signIn(with oauthProvider: OAuthProvider) async throws(APIError) -> Account? {
        do {
            let session = try await auth.signInWithOAuth(
                provider: oauthProvider.supabaseProvider,
                redirectTo: provider.configuration.authCallbackURL
            )
            return Self.account(session.user)
        } catch {
            if Self.isUserCancellation(error) { return nil }
            throw Self.authError(error, context: .signIn)
        }
    }

    /// The result of Sign in with Apple.
    public struct AppleSignIn: Sendable, Equatable {
        public let account: Account
        /// Apple created a brand-new account behind a private relay address
        /// (Hide My Email). It can't have matched an existing account's email,
        /// so the person may already play under another sign-in method (L-01).
        public let isNewRelayAccount: Bool
    }

    /// Signs in with the identity token from a native Sign in with Apple
    /// authorization (L-01). `nonce` is the raw value whose SHA-256 went into
    /// the Apple request; Supabase checks it against the token. Apple shares the
    /// person's name only on their first authorization, so pass it when present:
    /// it replaces a profile name that was only the email prefix. That write
    /// finishes before this returns, so the app never loads the old name.
    public func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws(APIError) -> AppleSignIn {
        let session: Session
        do {
            session = try await auth.signInWithIdToken(
                credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce)
            )
        } catch {
            throw Self.authError(error, context: .signIn)
        }
        let user = session.user
        if let fullName, !fullName.isEmpty {
            await adoptAppleName(fullName, for: user)
        }
        return AppleSignIn(account: Self.account(user), isNewRelayAccount: Self.isNewRelayAccount(user, now: Date()))
    }

    /// Best effort: the sign-in already succeeded, and a missing name only means
    /// the profile keeps the email-prefix name `handle_new_user` gave it. Only
    /// that fallback is replaced, never a name the person chose (an existing
    /// account Apple auto-linked by email).
    private func adoptAppleName(_ fullName: String, for user: User) async {
        guard let prefix = user.email?.split(separator: "@").first.map(String.init) else { return }
        _ = try? await provider.client
            .from("profiles")
            .update(["display_name": fullName])
            .eq("user_id", value: user.id.uuidString.lowercased())
            .eq("display_name", value: prefix)
            .execute()
    }

    /// Completes a sign-in from an incoming `fantasyreel://auth/callback` URL
    /// (email confirmation, password recovery, OAuth). The SDK exchanges the PKCE
    /// code using the verifier stored on this device; a link opened on another
    /// device has no verifier and fails here, which is expected (F-02).
    public func completeSignIn(from url: URL) async throws(APIError) -> Account {
        do {
            let session = try await auth.session(from: url)
            return Self.account(session.user)
        } catch {
            throw Self.authError(error, context: .signIn)
        }
    }

    /// Signs out on this device. The local session is cleared even if the
    /// network call fails, so the user is never stuck signed in.
    public func signOut() async {
        do {
            try await auth.signOut(scope: .local)
        } catch {
            // The SDK still removes the local session when the revoke call fails.
        }
    }

    // MARK: Helpers

    /// Wraps an SDK error with the web's wording for auth failures. The Auth
    /// error code stays in `serverCode` for screens that branch on it
    /// (`email_not_confirmed`, `captcha_failed`).
    static func authError(_ error: any Error, context: AuthMessages.Context) -> APIError {
        guard let authError = error as? AuthError else { return APIError.wrap(error) }
        var reasons: [String] = []
        var status: Int?
        switch authError {
        case .weakPassword(_, let weakReasons):
            reasons = weakReasons
        case .api(_, _, _, let response):
            status = response.statusCode
        default:
            break
        }
        let code = authError.errorCode.rawValue
        let message = AuthMessages.message(code: code, serverMessage: authError.message, reasons: reasons, context: context)
        return .server(APIError.ServerError(status: status, message: message ?? authError.message, code: code))
    }

    /// Reset and resend answer the same way whether or not an account exists,
    /// so only failures that mean nothing was sent reach the screen.
    static func rethrowUnlessEnumerating(_ error: any Error) throws(APIError) {
        let wrapped = authError(error, context: .emailRequest)
        guard case .server(let server) = wrapped else { throw wrapped }
        // A server failure or a rejected address says nothing about whether an
        // account exists, and in both cases nothing was sent.
        if server.message == AuthMessages.captchaFailed
            || server.message == AuthMessages.emailRateLimited
            || server.code == "email_address_invalid"
            || (server.status ?? 0) >= 500 {
            throw wrapped
        }
    }

    static func normalizedEmail(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    static func isNewRelayAccount(_ user: User, now: Date) -> Bool {
        isNewRelayAccount(
            email: user.email,
            providers: Set((user.identities ?? []).map(\.provider)),
            createdAt: user.createdAt,
            now: now
        )
    }

    /// An Apple-only account behind a private relay address, created moments
    /// ago by this sign-in (an older one is someone returning to it).
    static func isNewRelayAccount(email: String?, providers: Set<String>, createdAt: Date, now: Date) -> Bool {
        guard let email = email?.lowercased(), email.hasSuffix("@privaterelay.appleid.com") else { return false }
        return providers == ["apple"] && now.timeIntervalSince(createdAt) < 120
    }

    static func account(_ user: User) -> Account {
        Account(id: UserID(rawValue: user.id.uuidString.lowercased()), email: user.email)
    }

    static func isUserCancellation(_ error: any Error) -> Bool {
        if error is CancellationError { return true }
        let nsError = error as NSError
        // ASWebAuthenticationSessionError.canceledLogin == 1
        return nsError.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && nsError.code == 1
    }
}
