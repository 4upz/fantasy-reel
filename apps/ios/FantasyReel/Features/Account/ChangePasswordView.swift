import FantasyReelAPI
import SwiftUI

/// Change Password (F-02, F-03). The current password is checked by signing in
/// with it, so it sits behind the security check like Log In. An account that
/// signs in only with Apple, Google or Discord has no password to change; it
/// can set one with a reset link instead, as on the web.
struct ChangePasswordView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var methods: LoadState<SignInMethods> = .idle
    @State private var current = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var save = AsyncAction()
    @State private var sendLink = AsyncAction()
    @State private var securityCheck = SecurityCheck()
    @State private var localError: String?
    @State private var linkSent = false
    @FocusState private var focusedField: Field?

    private enum Field { case current, password, confirmation }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Change Password")
                    .padding(.bottom, 4)
                LoadStateView(methods, emptyTitle: "No account found", retry: { Task { await load() } }) { methods in
                    if methods.hasPassword {
                        changeForm
                    } else {
                        noPassword(email: methods.email)
                    }
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Change Password")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
        }
        .task { await load() }
        .announcesError(localError ?? save.errorMessage ?? sendLink.errorMessage)
        .reportsUnsavedInput(!(current.isEmpty && password.isEmpty && confirmation.isEmpty) && !save.isRunning)
    }

    private func load() async {
        if methods.value == nil { methods = .loading }
        do {
            methods = .loaded(try await session.signInMethods())
        } catch {
            if methods.value == nil { methods = .failed(message: error.userMessage) }
        }
    }

    // MARK: Change

    private var changeForm: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            VStack(alignment: .leading, spacing: 8) {
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Current", labelWidth: 84) {
                        SecureField("Required", text: $current)
                            .textContentType(.password)
                            .submitLabel(.next)
                            .focused($focusedField, equals: .current)
                            .onSubmit { focusedField = .password }
                    }
                    FormFieldRow(label: "New", labelWidth: 84) {
                        SecureField("Required", text: $password)
                            .textContentType(.newPassword)
                            .submitLabel(.next)
                            .focused($focusedField, equals: .password)
                            .onSubmit { focusedField = .confirmation }
                            .accessibilityHint(passwordHint)
                    }
                    FormFieldRow(label: "Confirm", labelWidth: 84) {
                        SecureField("Re-enter new password", text: $confirmation)
                            .textContentType(.newPassword)
                            .submitLabel(.go)
                            .focused($focusedField, equals: .confirmation)
                            .onSubmit(submit)
                    }
                }
                .disabled(save.isRunning)
                GroupFootnote(passwordHint)
            }

            SecurityCheckView(check: securityCheck)

            if let message = localError ?? save.errorMessage {
                InlineBanner(tone: .error, title: message)
            }

            Button(action: submit) {
                Text(save.isRunning ? "Saving…" : "Change Password")
            }
            .buttonStyle(.fr(.primary, isLoading: save.isRunning))
            .disabled(current.isEmpty || password.isEmpty || confirmation.isEmpty || save.isRunning)
        }
    }

    private var passwordHint: String {
        "Must be at least \(AuthMessages.minimumPasswordLength) characters."
    }

    private func submit() {
        guard !current.isEmpty, !save.isRunning else { return }
        localError = nil
        if let problem = AuthMessages.newPasswordProblem(password, confirmation: confirmation) {
            localError = problem
            focusedField = problem == AuthMessages.passwordsDoNotMatch ? .confirmation : .password
            return
        }
        guard securityCheck.isReady(environment.configuration) else {
            localError = AuthMessages.captchaPending
            return
        }
        let token = securityCheck.take()
        let (current, new) = (current, password)
        save.run {
            try await session.changePassword(current: current, new: new, captchaToken: token)
            Announcer.announce("Password changed.")
            dismiss()
        }
    }

    // MARK: No password

    private func noPassword(email: String?) -> some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            InlineBanner(
                tone: .info,
                title: "No password set",
                message: "You sign in with Apple, Google or Discord. Use forgot password to set one: we'll email a link to choose a password, and you can then sign in with your email too."
            )
            if linkSent {
                InlineBanner(tone: .success, title: "Check your email", message: "A link to choose a password is on its way.", systemImage: "checkmark", iconStyle: .badge)
            }
            if let email {
                SecurityCheckView(check: securityCheck)
                if let message = localError ?? sendLink.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
                Button {
                    sendResetLink(to: email)
                } label: {
                    Text(sendLink.isRunning ? "Sending…" : (linkSent ? "Send Again" : "Email Me a Link"))
                }
                .buttonStyle(.fr(linkSent ? .secondary : .primary, isLoading: sendLink.isRunning))
                .disabled(sendLink.isRunning)
            }
        }
    }

    private func sendResetLink(to email: String) {
        localError = nil
        guard securityCheck.isReady(environment.configuration) else {
            localError = AuthMessages.captchaPending
            return
        }
        let token = securityCheck.take()
        sendLink.run {
            try await session.sendPasswordReset(email: email, captchaToken: token)
            linkSent = true
            Announcer.announce("Check your email for a link to choose a password.")
        }
    }
}
