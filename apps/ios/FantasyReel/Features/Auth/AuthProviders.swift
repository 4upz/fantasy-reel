import AuthenticationServices
import CryptoKit
import FantasyReelAPI
import SwiftUI
import UIKit

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

/// Sign in with Apple (L-01). A custom button in the same style as Google and
/// Discord, which Apple's design rules allow: "Continue with Apple" with the
/// Apple logo on a white button. Apple's own `SignInWithAppleButton` centers
/// its logo and uses the system font, so it couldn't line up with the others.
///
/// The request carries the SHA-256 of a fresh random nonce; Supabase receives
/// the raw nonce and checks the two match, so a stolen token can't be replayed.
struct AppleSignInButton: View {
    let action: AsyncAction

    @Environment(SessionStore.self) private var session
    @State private var authorizer = AppleAuthorizer()

    var body: some View {
        ProviderSignInButton(provider: .apple) {
            action.run { try await signIn() }
        }
        .disabled(action.isRunning)
    }

    private func signIn() async throws {
        let rawNonce = AppleNonce.make()
        let authorization: ASAuthorization
        do {
            authorization = try await authorizer.authorize(hashedNonce: AppleNonce.sha256(rawNonce))
        } catch let error as ASAuthorizationError where error.code == .canceled {
            // Closing Apple's sheet is not an error; any session stays as it was.
            return
        } catch is CancellationError {
            return
        } catch {
            throw AppleSignInError.failed
        }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8)
        else { throw AppleSignInError.incomplete }
        // Apple shares the name only the first time someone authorizes the app.
        let fullName = credential.fullName
            .map { PersonNameComponentsFormatter.localizedString(from: $0, style: .default) }
            .flatMap { $0.isEmpty ? nil : $0 }
        try await session.signInWithApple(idToken: idToken, nonce: rawNonce, appleUserID: credential.user, fullName: fullName)
    }
}

/// Runs one Apple ID request and hands back its result. Apple reports through
/// a delegate, so the controller and the waiting continuation are kept here
/// until it answers.
@MainActor
private final class AppleAuthorizer: NSObject {
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<ASAuthorization, any Error>?

    func authorize(hashedNonce: String) async throws -> ASAuthorization {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = hashedNonce
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        // Only one request at a time; settle any earlier one first.
        finish(.failure(CancellationError()))
        self.controller = controller
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                controller.performRequests()
            }
        } onCancel: {
            Task { @MainActor in self.cancel() }
        }
    }

    /// Closes Apple's sheet if it is still up and ends the wait.
    func cancel() {
        controller?.cancel()
        finish(.failure(CancellationError()))
    }

    private func finish(_ result: Result<ASAuthorization, any Error>) {
        controller = nil
        continuation?.resume(with: result)
        continuation = nil
    }
}

extension AppleAuthorizer: @preconcurrency ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        finish(.success(authorization))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
        finish(.failure(error))
    }
}

extension AppleAuthorizer: @preconcurrency ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        if let window = windows.first(where: \.isKeyWindow) ?? windows.first { return window }
        // Not expected while a button on screen started the request.
        preconditionFailure("Sign in with Apple needs a window to present from.")
    }
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
            .accessibilityHint("Links open in Safari.")
    }

    private var text: AttributedString {
        let site = environment.configuration.siteURL
        var result = AttributedString("By \(action), you agree to the ")
        // Underlined, so the links don't rely on color alone.
        var terms = AttributedString("Terms of Service")
        terms.link = LegalLinks.terms(site: site)
        terms.underlineStyle = .single
        var privacy = AttributedString("Privacy Policy")
        privacy.link = LegalLinks.privacy(site: site)
        privacy.underlineStyle = .single
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
