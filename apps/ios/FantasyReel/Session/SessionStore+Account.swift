import FantasyReelAPI
import FantasyReelCore
import Foundation

/// Account-level auth for the Account screens (F-02, F-03, L-01, L-02):
/// connected accounts, password change, and what deletion does to the session.
/// Each throws `APIError` for the screen to show inline.
extension SessionStore {
    func signInMethods() async throws(APIError) -> SignInMethods {
        #if DEBUG
        if let previewSignInMethods { return previewSignInMethods }
        #endif
        return try await auth.signInMethods()
    }

    func identityLinkURL(for provider: AuthService.OAuthProvider) async throws(APIError) -> URL {
        try await auth.identityLinkURL(for: provider)
    }

    func completeIdentityLink(from url: URL) async throws(APIError) {
        try await auth.completeIdentityLink(from: url)
    }

    /// Connects Apple to the signed-in account, so the person can sign in with
    /// Apple from now on and keep their leagues (L-01).
    func linkApple(idToken: String, nonce: String) async throws(APIError) {
        try await auth.linkApple(idToken: idToken, nonce: nonce)
    }

    func unlink(_ identity: LinkedIdentity) async throws(APIError) {
        try await auth.unlink(identity)
        // Disconnecting Apple ends what the launch check watches.
        if identity.provider == AuthService.OAuthProvider.apple.rawValue,
           AppleCredentialStore.signedInAppleUserID == identity.providerUserID {
            AppleCredentialStore.signedInAppleUserID = nil
        }
    }

    func changePassword(current: String, new: String, captchaToken: String?) async throws(APIError) {
        try await auth.changePassword(current: current, new: new, captchaToken: captchaToken)
    }

    func syncDisplayName(_ name: String) async {
        await auth.syncDisplayName(name)
    }

    /// "Sign In Again" from Delete Account: deletion needs a sign-in from the
    /// last 15 minutes. Signs out, says why on Log In, and opens Account after
    /// the next sign-in so the person can finish.
    func signInAgainToDeleteAccount() async {
        let returning = account?.id
        await signOut()
        opensAccountAfterSignIn = returning
        authLinkNotice = AuthLinkNotice(
            title: "Sign in to continue",
            message: "Sign in again, then come back to Account to finish deleting your account. Nothing has been deleted.",
            isRecovery: false
        )
    }

    /// After the server deleted the account: the session can't be used any
    /// more, so only the local copy is cleared (Keychain session and Apple
    /// user ID), and the app returns to Welcome.
    func finishAccountDeletion() async {
        opensAccountAfterSignIn = nil
        await signOut()
    }

    /// After a delete whose answer was lost (a timeout, a dropped connection):
    /// true when the server no longer knows this account, so the delete went
    /// through. Any other answer, including no answer, is false.
    func accountNoLongerExists() async -> Bool {
        do {
            _ = try await auth.signInMethods()
            return false
        } catch {
            return ["user_not_found", "bad_jwt", "session_not_found"].contains(error.serverCode ?? "")
        }
    }
}
