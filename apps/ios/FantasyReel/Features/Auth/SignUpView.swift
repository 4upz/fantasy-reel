import FantasyReelAPI
import SwiftUI

/// Create an account (mockup v2 "Sign up", F-02): the providers, then display
/// name, email, password (8+) and confirmation behind the security check, with
/// the legal notice under the button. When Supabase asks for email
/// confirmation first, the form becomes "Check your email" with Resend. That
/// screen, not the form, explains the confirmation link (Arik's call: the note
/// read as out of place before anyone had signed up).
struct SignUpView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppEnvironment.self) private var environment
    @Environment(AuthNavigation.self) private var navigation
    @State private var displayName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var create = AsyncAction()
    @State private var securityCheck = SecurityCheck()
    @State private var localError: String?
    /// The address a confirmation link went to; switches to "Check your email".
    @State private var confirmationSentTo: String?
    @FocusState private var focusedField: Field?

    private enum Field { case displayName, email, password, confirmation }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let confirmationSentTo {
                    CheckEmailView(email: confirmationSentTo)
                } else {
                    form
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Create Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Log In") { navigation.switchTo(.logIn) }
            }
        }
        .announcesError(errorMessage)
    }

    @ViewBuilder
    private var form: some View {
        Text("Create Account")
            .frFont(.largeTitle)
            .foregroundStyle(Color.frText)
            .accessibilityAddTraits(.isHeader)
            .padding(.bottom, 8)

        AuthProviderButtons(action: create)

        FROrDivider()

        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            FormFieldRow(label: "Display name", labelWidth: 108) {
                TextField("Required", text: $displayName)
                    .textContentType(.nickname)
                    .submitLabel(.next)
                    .focused($focusedField, equals: .displayName)
                    .onSubmit { focusedField = .email }
            }
            FormFieldRow(label: "Email", labelWidth: 108) {
                TextField(AuthPlaceholders.email, text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focusedField, equals: .email)
                    .onSubmit { focusedField = .password }
            }
            FormFieldRow(label: "Password", labelWidth: 108) {
                SecureField("Required", text: $password)
                    .textContentType(.newPassword)
                    .submitLabel(.next)
                    .focused($focusedField, equals: .password)
                    .onSubmit { focusedField = .confirmation }
                    .accessibilityHint(passwordHint)
            }
            FormFieldRow(label: "Confirm", labelWidth: 108) {
                SecureField("Re-enter password", text: $confirmation)
                    .textContentType(.newPassword)
                    .submitLabel(.go)
                    .focused($focusedField, equals: .confirmation)
                    .onSubmit(submit)
            }
        }
        .disabled(create.isRunning)

        Text(passwordHint)
            .frFont(.meta)
            .foregroundStyle(Color.frTextSecondary)
            .padding(.horizontal, 16)
            .padding(.top, -4)
            .accessibilityHidden(true)

        SecurityCheckView(check: securityCheck)

        if let message = errorMessage {
            InlineBanner(tone: .error, title: message)
        }

        VStack(spacing: 8) {
            Button(action: submit) {
                Text(create.isRunning ? "Creating Account…" : "Create Account")
            }
            .buttonStyle(.fr(.primary, isLoading: create.isRunning))
            .disabled(!canSubmit || create.isRunning)
            AuthLegalNotice(action: "continuing with Apple, Google, Discord or email")
        }
        .padding(.top, 4)
    }

    private var passwordHint: String {
        "Must be at least \(AuthMessages.minimumPasswordLength) characters."
    }

    private var errorMessage: String? {
        localError ?? create.errorMessage
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSubmit: Bool {
        !displayName.trimmingCharacters(in: .whitespaces).isEmpty
            && !trimmedEmail.isEmpty && !password.isEmpty && !confirmation.isEmpty
    }

    private func submit() {
        guard canSubmit, !create.isRunning else { return }
        localError = nil
        create.clearError()
        if let problem = AuthMessages.newPasswordProblem(password, confirmation: confirmation) {
            localError = problem
            focusedField = problem == AuthMessages.passwordsDoNotMatch ? .confirmation : .password
            return
        }
        guard AuthMessages.looksLikeEmail(trimmedEmail) else {
            localError = AuthMessages.invalidEmail
            focusedField = .email
            return
        }
        guard securityCheck.isReady(environment.configuration) else {
            localError = AuthMessages.captchaPending
            return
        }
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let email = trimmedEmail
        let password = password
        let token = securityCheck.take()
        create.run {
            let signedIn = try await session.signUp(email: email, password: password, displayName: name, captchaToken: token)
            // Signed in straight away: the session swaps this whole flow out.
            if !signedIn {
                confirmationSentTo = email
                Announcer.announce("Account created. Check your email to confirm.")
            }
        }
    }
}

/// "Check your email" after sign-up, with Resend (web signup success state).
private struct CheckEmailView: View {
    let email: String

    @Environment(SessionStore.self) private var session
    @Environment(AppEnvironment.self) private var environment
    @Environment(AuthNavigation.self) private var navigation
    @State private var resend = AsyncAction()
    @State private var securityCheck = SecurityCheck()
    @State private var localError: String?
    @State private var resent = false

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            Text("Check Your Email")
                .frFont(.largeTitle)
                .foregroundStyle(Color.frText)
                .accessibilityAddTraits(.isHeader)

            InlineBanner(
                tone: .success,
                title: resent ? "Confirmation email sent!" : "Confirmation link sent",
                message: resent
                    ? "We sent another link to \(email). Use the newest one, on this iPhone."
                    : "We sent it to \(email). Open it on this iPhone to finish signing up.",
                systemImage: "checkmark",
                iconStyle: .badge
            )

            SecurityCheckView(check: securityCheck)

            if let message = localError ?? resend.errorMessage {
                InlineBanner(tone: .error, title: message)
            }

            Button(action: resendConfirmation) {
                Text(resend.isRunning ? "Sending…" : "Resend Email")
            }
            .buttonStyle(.fr(.secondary, isLoading: resend.isRunning))
            .disabled(resend.isRunning)

            Button("Back to Log In") { navigation.switchTo(.logIn) }
                .frFont(.label)
                .frame(maxWidth: .infinity, minHeight: FRMetrics.minTapTarget)

            #if DEBUG
            AuthNote(systemImage: "server.rack", text: "Using local Supabase? Emails arrive in Mailpit at http://localhost:54324.")
            #endif
        }
    }

    private func resendConfirmation() {
        guard !resend.isRunning else { return }
        localError = nil
        guard securityCheck.isReady(environment.configuration) else {
            localError = AuthMessages.captchaPending
            return
        }
        let token = securityCheck.take()
        resent = false
        resend.run {
            try await session.resendConfirmation(email: email, captchaToken: token)
            resent = true
            Announcer.announce("Confirmation email sent.")
        }
    }
}

/// A small icon + secondary-text note (`.note` in the auth mockups).
struct AuthNote: View {
    let systemImage: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(Color.frTextSecondary)
                .accessibilityHidden(true)
            Text(text)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
#Preview("Sign up") {
    let environment = AppEnvironment.preview()
    NavigationStack { SignUpView() }
        .environment(environment)
        .environment(environment.session)
        .environment(AuthNavigation())
}
#endif
