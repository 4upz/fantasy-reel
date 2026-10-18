import FantasyReelCore
import Foundation
import Supabase

/// The ways one account can sign in, as the Account screen shows them (F-02, F-03).
public struct SignInMethods: Sendable, Equatable {
    public var email: String?
    /// The account has an email-and-password identity.
    public var hasPassword: Bool
    /// Every linked identity, the `email` one included.
    public var identities: [LinkedIdentity]

    public init(email: String?, hasPassword: Bool, identities: [LinkedIdentity]) {
        self.email = email
        self.hasPassword = hasPassword
        self.identities = identities
    }

    public func identity(for provider: AuthService.OAuthProvider) -> LinkedIdentity? {
        identities.first { $0.provider == provider.rawValue }
    }

    /// The web's rule: never disconnect the only way left to sign in. An
    /// account with a password can always disconnect a provider.
    public var canDisconnectProvider: Bool {
        hasPassword || identities.count > 1
    }
}

/// One linked sign-in method.
public struct LinkedIdentity: Sendable, Equatable, Identifiable {
    /// Supabase's identity record ID, which unlinking takes.
    public let id: String
    /// `email`, `apple`, `google` or `discord`.
    public let provider: String
    /// The provider's own ID for the person (Apple's user identifier, the
    /// Google or Discord user ID).
    public let providerUserID: String
    /// What to show beside the provider: the Discord name, the Google or Apple
    /// email. Nil when the provider shared nothing displayable.
    public let detail: String?

    public init(id: String, provider: String, providerUserID: String = "", detail: String?) {
        self.id = id
        self.provider = provider
        self.providerUserID = providerUserID
        self.detail = detail
    }
}

extension AuthService {
    /// Shown when a provider account already belongs to another Fantasy Reel account.
    public static let identityInUseMessage = "That account is already connected to a different Fantasy Reel account."
    public static let currentPasswordIncorrect = "Current password is incorrect"
    public static let onlySignInMethod = "You can't disconnect your only way to sign in."

    /// The scopes the web asks for when linking (`ConnectedAccounts.tsx`).
    static func linkScopes(_ provider: OAuthProvider) -> String? {
        switch provider {
        case .google: "openid email profile"
        case .discord: "identify email"
        case .apple: nil
        }
    }

    /// The signed-in account's sign-in methods, read fresh from the server.
    public func signInMethods() async throws(APIError) -> SignInMethods {
        do {
            let user = try await auth.user()
            let identities = (user.identities ?? []).map(Self.linkedIdentity)
            return SignInMethods(
                email: user.email,
                hasPassword: identities.contains { $0.provider == "email" },
                identities: identities
            )
        } catch {
            throw APIError.wrap(error)
        }
    }

    static func linkedIdentity(_ identity: UserIdentity) -> LinkedIdentity {
        let data = identity.identityData ?? [:]
        func string(_ key: String) -> String? {
            data[key]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        }
        let detail: String? = switch identity.provider {
        case "discord":
            string("full_name") ?? string("name") ?? data["custom_claims"]?.objectValue?["global_name"]?.stringValue
        case "google", "apple", "email":
            string("email")
        default:
            nil
        }
        return LinkedIdentity(
            id: identity.identityId.uuidString.lowercased(),
            provider: identity.provider,
            providerUserID: identity.id,
            detail: detail
        )
    }

    // MARK: Linking

    /// The provider page that connects Google or Discord to this account. Open
    /// it in a web authentication session and pass the callback it returns to
    /// `completeIdentityLink(from:)`. The PKCE verifier stays on this device.
    public func identityLinkURL(for oauthProvider: OAuthProvider) async throws(APIError) -> URL {
        do {
            return try await auth.getLinkIdentityURL(
                provider: oauthProvider.supabaseProvider,
                scopes: Self.linkScopes(oauthProvider),
                redirectTo: provider.configuration.authCallbackURL
            ).url
        } catch {
            throw Self.linkError(error)
        }
    }

    /// Finishes a Google or Discord link from the provider's callback URL.
    /// The account stays the same; only its identities change.
    public func completeIdentityLink(from url: URL) async throws(APIError) {
        if let failureCode = AuthLinkFailure.callbackParameters(url)["error_code"] {
            throw Self.linkError(code: failureCode, message: AuthLinkFailure.callbackParameters(url)["error_description"] ?? "")
        }
        do {
            _ = try await auth.session(from: url)
        } catch {
            throw Self.linkError(error)
        }
    }

    /// Connects Sign in with Apple to this account from a native Apple
    /// authorization (L-01). This is how someone who signs in with Google,
    /// Discord or email adds Apple without making a second account.
    public func linkApple(idToken: String, nonce: String) async throws(APIError) {
        do {
            _ = try await auth.linkIdentityWithIdToken(
                credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce)
            )
        } catch {
            throw Self.linkError(error)
        }
    }

    /// Disconnects a provider. The server refuses to remove the last identity;
    /// this also refuses, with the web's wording, before the round trip.
    public func unlink(_ identity: LinkedIdentity) async throws(APIError) {
        do {
            let user = try await auth.user()
            let identities = user.identities ?? []
            let hasPassword = identities.contains { $0.provider == "email" }
            guard hasPassword || identities.count > 1 else {
                throw APIError.server(APIError.ServerError(status: nil, message: Self.onlySignInMethod, code: "single_identity_not_deletable"))
            }
            guard let match = identities.first(where: { $0.identityId.uuidString.lowercased() == identity.id }) else {
                // Already gone (disconnected elsewhere): nothing left to do.
                return
            }
            try await auth.unlinkIdentity(match)
            // Refresh so the stored user (and its identities) match the server.
            _ = try? await auth.refreshSession()
        } catch {
            throw Self.linkError(error)
        }
    }

    static func linkError(_ error: any Error) -> APIError {
        if let apiError = error as? APIError { return apiError }
        if let authError = error as? AuthError {
            return linkError(code: authError.errorCode.rawValue, message: authError.message)
        }
        return APIError.wrap(error)
    }

    static func linkError(code: String, message: String) -> APIError {
        let text: String = switch code {
        case "identity_already_exists": identityInUseMessage
        case "single_identity_not_deletable": onlySignInMethod
        case "manual_linking_disabled": "Connecting accounts is turned off right now. Please try again later."
        default: AuthMessages.message(code: code, serverMessage: message, context: .signIn) ?? message
        }
        return .server(APIError.ServerError(status: nil, message: text, code: code))
    }

    // MARK: Profile and password

    /// Copies the display name into the user's metadata, as the web does, so
    /// anything reading the session sees the new name. Best effort: the profile
    /// row is the source of truth.
    public func syncDisplayName(_ name: String) async {
        _ = try? await auth.update(user: UserAttributes(data: ["display_name": .string(name)]))
    }

    /// Changes the password after checking the current one, as the web does
    /// (`settings/actions.ts`). Signing in again with the current password is
    /// the check, so it needs a security-check token in production.
    public func changePassword(current: String, new: String, captchaToken: String?) async throws(APIError) {
        guard let email = auth.currentUser?.email else { throw .notSignedIn }
        do {
            _ = try await auth.signIn(email: email, password: current, captchaToken: captchaToken)
        } catch {
            let wrapped = Self.authError(error, context: .signIn)
            if case .server(let server) = wrapped, server.message == AuthMessages.invalidCredentials {
                throw .server(APIError.ServerError(status: server.status, message: Self.currentPasswordIncorrect, code: server.code))
            }
            throw wrapped
        }
        try await updatePassword(new)
    }
}
