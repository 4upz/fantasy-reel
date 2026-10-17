import FantasyReelAPI
import SwiftUI

/// Request a reset link (mockup v2 "Reset password", F-02). The answer never
/// says whether an account exists; only a failed security check, a rate limit
/// or no connection is reported, since then nothing was sent.
struct ResetPasswordView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppEnvironment.self) private var environment
    @State private var email: String
    @State private var send = AsyncAction()
    @State private var securityCheck = SecurityCheck()
    @State private var localError: String?
    @State private var sent = false

    init(initialEmail: String = "") {
        _email = State(initialValue: initialEmail)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Reset Password")
                        .frFont(.largeTitle)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                    Text("Enter the email you signed up with. We'll send a link to choose a new password.")
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                }

                if let notice = session.authLinkNotice, notice.isRecovery {
                    InlineBanner(tone: .info, title: notice.message)
                }

                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Email", labelWidth: 64) {
                        TextField("you@example.com", text: $email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.send)
                            .onSubmit(submit)
                    }
                }
                .disabled(send.isRunning)
                .padding(.top, 8)

                if sent {
                    InlineBanner(
                        tone: .success,
                        title: "Check your email",
                        message: "If an account exists for that address, a reset link is on its way. It opens Fantasy Reel on this iPhone.",
                        systemImage: "checkmark",
                        iconStyle: .badge
                    )
                }

                SecurityCheckView(check: securityCheck)

                if let message = localError ?? send.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }

                Button(action: submit) {
                    Text(send.isRunning ? "Sending…" : (sent ? "Send Again" : "Send Reset Link"))
                }
                .buttonStyle(.fr(sent ? .secondary : .primary, isLoading: send.isRunning))
                .disabled(trimmedEmail.isEmpty || send.isRunning)

                SectionHeader("Link Expired?")
                Text("Reset links work once. If you asked for more than one, use the newest email, or send a fresh link above.")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 4)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Reset Password")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
        }
        .announcesError(localError ?? send.errorMessage)
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func submit() {
        guard !trimmedEmail.isEmpty, !send.isRunning else { return }
        localError = nil
        sent = false
        guard AuthMessages.looksLikeEmail(trimmedEmail) else {
            localError = AuthMessages.invalidEmail
            return
        }
        guard securityCheck.isReady(environment.configuration) else {
            localError = AuthMessages.captchaPending
            return
        }
        let email = trimmedEmail
        let token = securityCheck.take()
        send.run {
            try await session.sendPasswordReset(email: email, captchaToken: token)
            sent = true
            // The new link supersedes whatever the failed one was about.
            session.authLinkNotice = nil
            Announcer.announce("Check your email for a reset link.")
        }
    }
}

/// "Choose a new password" after a reset link signs the person in (F-02).
/// `RootView` shows it in place of the app until a password is saved, so the
/// recovery can't be skipped by accident; Sign Out is the way to leave.
struct ChooseNewPasswordView: View {
    @Environment(SessionStore.self) private var session
    @State private var password = ""
    @State private var confirmation = ""
    @State private var save = AsyncAction()
    @State private var localError: String?
    @FocusState private var focusedField: Field?

    private enum Field { case password, confirmation }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Choose a New Password")
                        .frFont(.largeTitle)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                    Text(subtitle)
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                }

                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Password", labelWidth: 92) {
                        SecureField("Required", text: $password)
                            .textContentType(.newPassword)
                            .submitLabel(.next)
                            .focused($focusedField, equals: .password)
                            .onSubmit { focusedField = .confirmation }
                            .accessibilityHint(hint)
                    }
                    FormFieldRow(label: "Confirm", labelWidth: 92) {
                        SecureField("Re-enter password", text: $confirmation)
                            .textContentType(.newPassword)
                            .submitLabel(.done)
                            .focused($focusedField, equals: .confirmation)
                            .onSubmit(submit)
                    }
                }
                .disabled(save.isRunning)
                .padding(.top, 8)

                Text(hint)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 16)
                    .padding(.top, -4)
                    .accessibilityHidden(true)

                if let message = localError ?? save.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }

                Button(action: submit) {
                    Text(save.isRunning ? "Saving…" : "Save Password")
                }
                .buttonStyle(.fr(.primary, isLoading: save.isRunning))
                .disabled(password.isEmpty || confirmation.isEmpty || save.isRunning)

                Button("Sign Out") {
                    Task { await session.signOut() }
                }
                .buttonStyle(.frNeutral)
                .disabled(save.isRunning)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.vertical, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .announcesError(localError ?? save.errorMessage)
        .onAppear { focusedField = .password }
    }

    private var hint: String {
        "Must be at least \(AuthMessages.minimumPasswordLength) characters."
    }

    private var subtitle: String {
        if let email = session.account?.email {
            return "Your reset link signed you in as \(email). Pick a new password to finish."
        }
        return "Your reset link signed you in. Pick a new password to finish."
    }

    private func submit() {
        guard !password.isEmpty, !confirmation.isEmpty, !save.isRunning else { return }
        localError = nil
        save.clearError()
        if let problem = AuthMessages.newPasswordProblem(password, confirmation: confirmation) {
            localError = problem
            focusedField = problem == AuthMessages.passwordsDoNotMatch ? .confirmation : .password
            return
        }
        let password = password
        save.run {
            try await session.updatePassword(password)
            Announcer.announce("Password updated.")
        }
    }
}

#if DEBUG
#Preview("Reset password") {
    let environment = AppEnvironment.preview()
    NavigationStack { ResetPasswordView(initialEmail: "alice@fantasyreel.test") }
        .environment(environment)
        .environment(environment.session)
        .environment(AuthNavigation())
}

#Preview("Choose a new password") {
    let environment = AppEnvironment.preview()
    ChooseNewPasswordView()
        .environment(environment)
        .environment(environment.session)
}
#endif
