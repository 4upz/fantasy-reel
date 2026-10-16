import FantasyReelAPI
import SwiftUI

/// Log in (mockup v2 "Log in", F-02). The foundation ships working email and
/// password sign-in plus the Google and Discord buttons the web has. The Auth
/// feature adds Apple (L-01), CAPTCHA (N-03), the unconfirmed-email resend card,
/// and the web's exact error wording (`utils/password.ts`).
struct LogInView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppEnvironment.self) private var environment
    @State private var email = ""
    @State private var password = ""
    @State private var action = AsyncAction()
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                Text("Log In")
                    .frFont(.largeTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityAddTraits(.isHeader)

                if let notice = session.authLinkError {
                    InlineBanner(tone: .info, title: notice)
                }

                VStack(spacing: 8) {
                    VStack(spacing: 12) {
                        providerButton(.google)
                        providerButton(.discord)
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Continue with a provider")
                    Text(legalNotice)
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 16)
                }

                FROrDivider()

                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Email") {
                        TextField("you@example.com", text: $email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.next)
                            .focused($focusedField, equals: .email)
                            .onSubmit { focusedField = .password }
                    }
                    FormFieldRow(label: "Password") {
                        SecureField("Required", text: $password)
                            .textContentType(.password)
                            .submitLabel(.go)
                            .focused($focusedField, equals: .password)
                            .onSubmit(submit)
                    }
                }

                HStack {
                    Spacer()
                    NavigationLink("Forgot Password?", value: AuthRoute.resetPassword)
                        .frFont(.label)
                        .frame(minHeight: FRMetrics.minTapTarget)
                }

                if let message = action.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }

                Button(action: submit) {
                    Text("Log In")
                }
                .buttonStyle(.fr(.primary, isLoading: action.isRunning))
                .disabled(!canSubmit || action.isRunning)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Log In")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink("Sign Up", value: AuthRoute.signUp)
            }
        }
    }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    private var legalNotice: AttributedString {
        let site = environment.configuration.siteURL
        var text = AttributedString("New accounts made with Google or Discord agree to the ")
        var terms = AttributedString("Terms")
        terms.link = LegalLinks.terms(site: site)
        var privacy = AttributedString("Privacy Policy")
        privacy.link = LegalLinks.privacy(site: site)
        text.append(terms)
        text.append(AttributedString(" and "))
        text.append(privacy)
        text.append(AttributedString("."))
        return text
    }

    private func submit() {
        guard canSubmit else { return }
        let email = email.trimmingCharacters(in: .whitespaces)
        let password = password
        action.run {
            try await session.signIn(email: email, password: password)
        }
    }

    private func providerButton(_ provider: AuthService.OAuthProvider) -> some View {
        ProviderSignInButton(provider: provider.signInButtonProvider) {
            action.run { try await session.signIn(with: provider) }
        }
        .disabled(action.isRunning)
    }
}

private extension AuthService.OAuthProvider {
    var signInButtonProvider: ProviderSignInButton.Provider {
        switch self {
        case .apple: .apple
        case .google: .google
        case .discord: .discord
        }
    }
}
