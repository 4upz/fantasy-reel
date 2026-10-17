import AuthenticationServices
import CryptoKit
import FantasyReelAPI
import SwiftUI

/// "Continue with Apple / Google / Discord" (V2LogIn, V2SignUp). Each one signs
/// in or, on first use, creates an account, so a legal notice goes with them.
/// They share the screen's `AsyncAction`, so one sign-in runs at a time and its
/// error shows where the screen shows errors.
struct AuthProviderButtons: View {
    let action: AsyncAction

    @Environment(SessionStore.self) private var session

    var body: some View {
        VStack(spacing: 12) {
            AppleSignInButton(action: action)
            providerButton(.google)
            providerButton(.discord)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Continue with a provider")
    }

    private func providerButton(_ provider: AuthService.OAuthProvider) -> some View {
        ProviderSignInButton(provider: provider.signInButtonProvider) {
            action.run { try await session.signIn(with: provider) }
        }
        .disabled(action.isRunning)
    }
}

/// Sign in with Apple (L-01), with Apple's own button so it meets Apple's
/// design rules: white on the dark theme, black on the light one, the same
/// 50pt capsule as the other providers.
///
/// The request carries the SHA-256 of a fresh random nonce; Supabase receives
/// the raw nonce and checks the two match, so a stolen token can't be replayed.
struct AppleSignInButton: View {
    let action: AsyncAction

    @Environment(SessionStore.self) private var session
    @Environment(\.colorScheme) private var colorScheme
    /// A reference, not state: Apple calls `onRequest` and `onCompletion`
    /// back to back, and the completion must see the nonce the request used.
    @State private var nonce = NonceBox()

    var body: some View {
        SignInWithAppleButton(.continue) { request in
            let raw = AppleNonce.make()
            nonce.value = raw
            request.requestedScopes = [.fullName, .email]
            request.nonce = AppleNonce.sha256(raw)
        } onCompletion: { result in
            complete(result)
        }
        .signInWithAppleButtonStyle(colorScheme == .light ? .black : .white)
        // Restyling (the color scheme) rebuilds the button; this keeps the
        // nonce box and the button in step.
        .id(colorScheme)
        .frame(height: 50)
        .clipShape(Capsule())
        .disabled(action.isRunning)
        .opacity(action.isRunning ? 0.5 : 1)
    }

    private func complete(_ result: Result<ASAuthorization, any Error>) {
        let rawNonce = nonce.value
        nonce.value = nil
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8),
                  let rawNonce
            else {
                action.run { throw AppleSignInError.incomplete }
                return
            }
            // Apple shares the name only the first time someone authorizes the app.
            let fullName = credential.fullName.map {
                PersonNameComponentsFormatter.localizedString(from: $0, style: .default)
            }
            action.run {
                try await session.signInWithApple(idToken: idToken, nonce: rawNonce, fullName: fullName)
            }
        case .failure(let error):
            // Closing Apple's sheet is not an error; any session stays as it was.
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            action.run { throw AppleSignInError.failed }
        }
    }
}

private final class NonceBox {
    var value: String?
}

private enum AppleSignInError: LocalizedError {
    case incomplete, failed

    var errorDescription: String? {
        "Sign in with Apple didn't finish. Please try again."
    }
}

/// The Sign in with Apple nonce: random, URL-safe, and sent to Apple hashed.
enum AppleNonce {
    static func make(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var generator = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in charset.randomElement(using: &generator)! })
    }

    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension AuthService.OAuthProvider {
    var signInButtonProvider: ProviderSignInButton.Provider {
        switch self {
        case .apple: .apple
        case .google: .google
        case .discord: .discord
        }
    }
}

/// The agreement statement beside every way to create an account, which is how
/// people accept the Terms (F-01, web `LegalNotice`). The wording is the web's:
/// it is a legal commitment, so change both together.
struct AuthLegalNotice: View {
    /// Completes "By …, you agree", e.g. "creating an account".
    let action: String

    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        Text(text)
            .frFont(.caption)
            .foregroundStyle(Color.frTextSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
    }

    private var text: AttributedString {
        let site = environment.configuration.siteURL
        var result = AttributedString("By \(action), you agree to the ")
        var terms = AttributedString("Terms of Service")
        terms.link = LegalLinks.terms(site: site)
        var privacy = AttributedString("Privacy Policy")
        privacy.link = LegalLinks.privacy(site: site)
        result.append(terms)
        result.append(AttributedString(" and acknowledge the "))
        result.append(privacy)
        result.append(AttributedString("."))
        return result
    }
}

extension View {
    /// Reads a new error aloud once (errors stay inline; ARCHITECTURE "UI state").
    func announcesError(_ message: String?) -> some View {
        onChange(of: message) { _, new in
            if let new { Announcer.announce(new) }
        }
    }
}
