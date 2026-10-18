import AuthenticationServices
import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Delete Account (mockups v2 "Delete account", "…blocked", "…draft"; L-02).
/// Pushed inside the menu sheet. Typing DELETE enables the toolbar's Delete.
///
/// - The server wants a sign-in from the last 15 minutes; when it's older the
///   screen offers Sign In Again, which signs out and brings the person back to
///   Account after they sign in.
/// - A league that is drafting blocks deletion; the screen names it.
/// - An account with Apple connected asks Apple for a fresh authorization
///   first, so the server can revoke the app's access to the Apple ID
///   (App Review 5.1.1(v)). Closing Apple's sheet cancels the deletion.
struct DeleteAccountView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session
    @State private var confirmation = ""
    @State private var delete = AsyncAction()
    @State private var signInAgain = AsyncAction()
    @State private var blocker: Blocker?
    @State private var appleAuthorizer = AppleAuthorizer()
    @FocusState private var isFocused: Bool

    enum Blocker: Equatable {
        case reauth
        case liveDraft(leagues: [String])
    }

    /// Screenshot and preview entry: start in a blocked state.
    init(blocker: Blocker? = nil) {
        _blocker = State(initialValue: blocker)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Delete Account")
                    .padding(.bottom, 4)
                if blocker == .reauth {
                    reauth
                } else {
                    form
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Delete Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
            if blocker != .reauth {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(delete.isRunning ? "Deleting…" : "Delete", role: .destructive, action: submit)
                        .fontWeight(.semibold)
                        .buttonStyle(.glassProminent)
                        .tint(Color.frCrimson)
                        .disabled(!isConfirmed || delete.isRunning)
                        .accessibilityHint(isConfirmed ? "Permanently deletes your account." : "Type DELETE to enable.")
                }
            }
        }
        .announcesError(delete.errorMessage ?? signInAgain.errorMessage)
        .reportsUnsavedInput(!confirmation.isEmpty)
        .interactiveDismissDisabled(delete.isRunning)
        .navigationBarBackButtonHidden(delete.isRunning)
    }

    private var isConfirmed: Bool {
        confirmation == AccountDeletion.confirmationWord
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("This permanently deletes your account, profile and photo. It can't be undone.")
                .frFont(.body)
                .foregroundStyle(Color.frText)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(Self.consequences.enumerated()), id: \.offset) { index, item in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: item.systemImage)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.frTextSecondary)
                                .frame(width: 24)
                                .accessibilityHidden(true)
                            Text(item.text)
                                .frFont(.bodySmall)
                                .foregroundStyle(Color.frText)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, FRMetrics.rowPadding)
                        .padding(.vertical, 12)
                        .overlay(alignment: .top) {
                            if index > 0 {
                                Rectangle()
                                    .fill(Color.frSeparator)
                                    .frame(height: 0.5)
                                    .padding(.leading, 52)
                            }
                        }
                    }
                }
                .background(Color.frNeutralFill, in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
                .accessibilityElement(children: .combine)
                GroupFootnote("If you're in a draft that's underway, finish it first.")
            }
            if case .liveDraft(let leagues) = blocker {
                InlineBanner(tone: .error, title: Self.liveDraftTitle(leagues))
            }
            if let message = delete.errorMessage {
                InlineBanner(tone: .error, title: message)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Type DELETE to confirm")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, FRMetrics.rowPadding)
                    .accessibilityHidden(true)
                TextField("DELETE", text: $confirmation)
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .tracking(2)
                    .foregroundStyle(Color.frText)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($isFocused)
                    .onSubmit(submit)
                    .padding(.horizontal, FRMetrics.rowPadding)
                    .frame(minHeight: 50)
                    .background(Color.frNeutralFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(isFocused ? Color.frGold : .clear, lineWidth: 2)
                    }
                    .disabled(delete.isRunning)
                    .accessibilityLabel("Type DELETE to confirm")
                GroupFootnote("The Delete button stays unavailable until you type DELETE exactly.")
            }
        }
    }

    struct Consequence: Hashable {
        let systemImage: String
        let text: String
    }

    static let consequences = [
        Consequence(systemImage: "crown", text: "Leagues you run pass to their longest-standing member. A league nobody else has joined is deleted."),
        Consequence(systemImage: "person.badge.minus", text: "You're removed from leagues that haven't drafted yet."),
        Consequence(systemImage: "person.2", text: "In active and finished seasons your team and roster stay, shown as “Former member”, so trades and counterpicks involving it still hold. A season in progress stops ranking your team; finished seasons keep their results."),
        Consequence(systemImage: "xmark.circle", text: "Your pending bids and trade offers are cancelled."),
    ]

    static func liveDraftTitle(_ leagues: [String]) -> String {
        guard !leagues.isEmpty else { return "Finish your draft before deleting your account" }
        return "Finish the draft in \(leagues.formatted(.list(type: .and))) before deleting your account"
    }

    // MARK: Sign in again

    private var reauth: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            InlineBanner(
                tone: .warning,
                title: "Sign in again to delete your account",
                message: "For your security, deleting your account needs a recent sign-in. Sign in again, then come back to Account to finish.",
                iconStyle: .badge
            )
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    signInAgain.run { await session.signInAgainToDeleteAccount() }
                } label: {
                    Text("Sign In Again")
                }
                .buttonStyle(.fr(.primary, isLoading: signInAgain.isRunning))
                .disabled(signInAgain.isRunning)
                GroupFootnote("You'll be signed out first. Nothing has been deleted.")
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: Delete

    private func submit() {
        guard isConfirmed, !delete.isRunning else { return }
        isFocused = false
        if case .liveDraft = blocker { blocker = nil }
        delete.run {
            let appleCode: String?
            switch try await appleAuthorizationCode() {
            case .cancelled: return
            case .code(let code): appleCode = code
            }
            let outcome: AccountDeletionOutcome
            do throws(APIError) {
                outcome = try await environment.account.deleteAccount(appleAuthorizationCode: appleCode)
            } catch {
                // The server may have deleted the account before the answer
                // was lost; a retry would then fail as signed out.
                if error.isUncertainOutcome || error.status == 401, await session.accountNoLongerExists() {
                    outcome = .deleted
                } else {
                    throw error
                }
            }
            switch outcome {
            case .deleted:
                Announcer.announce("Your account has been deleted.")
                await session.finishAccountDeletion()
            case .reauthRequired:
                blocker = .reauth
                Announcer.announce("Sign in again to delete your account.")
            case .liveDraft(let leagues, _):
                blocker = .liveDraft(leagues: leagues)
                Announcer.announce(Self.liveDraftTitle(leagues))
            }
        }
    }

    private enum AppleCode {
        case cancelled
        /// Nil when Apple isn't connected or didn't give one; deletion goes ahead.
        case code(String?)
    }

    /// Asks Apple for a fresh authorization when the account has Apple
    /// connected. The code goes only to the server, which exchanges it once to
    /// revoke the token. A different Apple ID than the connected one sends none.
    private func appleAuthorizationCode() async throws -> AppleCode {
        let methods = try await session.signInMethods()
        guard let apple = methods.identity(for: .apple) else { return .code(nil) }
        do {
            let authorization = try await appleAuthorizer.authorize(hashedNonce: AppleNonce.sha256(AppleNonce.make()), scopes: [])
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  credential.user == apple.providerUserID,
                  let data = credential.authorizationCode
            else { return .code(nil) }
            return .code(String(data: data, encoding: .utf8))
        } catch let error as ASAuthorizationError where error.code == .canceled {
            return .cancelled
        } catch is CancellationError {
            return .cancelled
        } catch {
            // Apple unavailable: delete anyway. The person can still remove the
            // app in Settings › Apple ID › Sign in with Apple.
            return .code(nil)
        }
    }
}
