import FantasyReelAPI
import SwiftUI

/// Log in (mockup v2 "Log in", F-02): Apple, Google and Discord with their
/// legal notice, then email and password behind the security check. A failed
/// sign-in keeps both fields. An unconfirmed account gets the "Confirm your
/// email first" card with Resend; a link that couldn't sign in explains why.
struct LogInView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppEnvironment.self) private var environment
    @Environment(AuthNavigation.self) private var navigation
    @State private var email = ""
    @State private var password = ""
    @State private var signIn = AsyncAction()
    @State private var resend = AsyncAction()
    @State private var securityCheck = SecurityCheck()
    /// Set when the last sign-in failed because the email isn't confirmed.
    @State private var unconfirmedEmail: String?
    @State private var resent = false
    /// Shown before the round trip (security check not done yet).
    @State private var localError: String?
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                Text("Log In")
                    .frFont(.largeTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.bottom, 8)

                notices

                VStack(spacing: 8) {
                    AuthProviderButtons(action: signIn)
                    AuthLegalNotice(action: "continuing with Apple, Google or Discord")
                }

                FROrDivider()

                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Email") {
                        TextField(AuthPlaceholders.email, text: $email)
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
                .disabled(signIn.isRunning)

                HStack {
                    Spacer()
                    NavigationLink("Forgot Password?", value: AuthRoute.resetPassword(email: trimmedEmail))
                        .frFont(.label)
                        .frame(minHeight: FRMetrics.minTapTarget)
                }
                // Sits close under the fields, as in the mockup.
                .padding(.vertical, -8)

                SecurityCheckView(check: securityCheck)

                if let message = errorMessage {
                    InlineBanner(tone: .error, title: message)
                }

                Button(action: submit) {
                    Text(signIn.isRunning ? "Logging In…" : "Log In")
                }
                .buttonStyle(.fr(.primary, isLoading: signIn.isRunning))
                .disabled(!canSubmit || signIn.isRunning)
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
                Button("Sign Up") { navigation.switchTo(.signUp) }
            }
        }
        .announcesError(errorMessage)
        .onChange(of: signIn.lastError) { _, error in
            if error?.serverCode == AuthMessages.Code.emailNotConfirmed {
                Announcer.announce("Confirm your email first.")
            }
        }
    }

    @ViewBuilder
    private var notices: some View {
        if let notice = session.authLinkNotice, !notice.isRecovery {
            InlineBanner(tone: .info, title: notice.title, message: notice.message)
        }
        if resent {
            InlineBanner(tone: .success, title: "Confirmation email sent! Check your inbox.")
        } else if let unconfirmedEmail {
            InlineBanner(
                tone: .info,
                title: "Confirm your email first",
                message: "We sent a link to \(unconfirmedEmail)",
                systemImage: "envelope.fill",
                actionTitle: resend.isRunning ? "Sending…" : "Resend Email",
                iconStyle: .badge,
                actionPlacement: .below,
                action: resendConfirmation
            )
            .disabled(resend.isRunning)
        }
    }

    /// One error at a time: the unconfirmed card replaces the sign-in error.
    private var errorMessage: String? {
        if let localError { return localError }
        if let message = resend.errorMessage { return message }
        if signIn.lastError?.serverCode == AuthMessages.Code.emailNotConfirmed { return nil }
        return signIn.errorMessage
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSubmit: Bool {
        !trimmedEmail.isEmpty && !password.isEmpty
    }

    private func submit() {
        guard canSubmit, !signIn.isRunning else { return }
        localError = nil
        guard securityCheck.isReady(environment.configuration) else {
            localError = AuthMessages.captchaPending
            return
        }
        let email = trimmedEmail
        let password = password
        let token = securityCheck.take()
        resent = false
        resend.clearError()
        signIn.run {
            do {
                try await session.signIn(email: email, password: password, captchaToken: token)
            } catch let error as APIError where error.serverCode == AuthMessages.Code.emailNotConfirmed {
                unconfirmedEmail = email
                throw error
            }
            unconfirmedEmail = nil
        }
    }

    private func resendConfirmation() {
        guard let unconfirmedEmail, !resend.isRunning else { return }
        localError = nil
        guard securityCheck.isReady(environment.configuration) else {
            localError = AuthMessages.captchaPending
            return
        }
        let token = securityCheck.take()
        resent = false
        resend.run {
            try await session.resendConfirmation(email: unconfirmedEmail, captchaToken: token)
            resent = true
            session.authLinkNotice = nil
            Announcer.announce("Confirmation email sent.")
        }
    }
}

#if DEBUG
#Preview("Log in") {
    let environment = AppEnvironment.preview()
    NavigationStack { LogInView() }
        .environment(environment)
        .environment(environment.session)
        .environment(AuthNavigation())
}
#endif
