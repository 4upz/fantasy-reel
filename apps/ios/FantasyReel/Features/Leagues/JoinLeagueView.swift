import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Join with a code, a pasted link, or an email invitation token (F-05,
/// mockup V2JoinLeague, web `JoinLeagueClient`).
///
/// A link only pre-fills this sheet: nothing is sent until the person taps
/// Join. A pasted invitation link switches to invitation mode. Errors stay
/// inline in an "Unable to join" banner, including the code-attempt rate limit.
struct JoinLeagueView: View {
    @Environment(ShellRouter.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(\.currentProfile) private var profile

    @State private var model: JoinLeagueModel
    @State private var confirmsDiscard = false
    @FocusState private var focusedField: Field?

    private enum Field { case code, team }

    init(input: JoinInput, lifecycle: any LeagueLifecycleRepository, directory: LeagueDirectoryStore) {
        _model = State(initialValue: JoinLeagueModel(input: input, lifecycle: lifecycle, directory: directory))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let result = model.completed, let warning = result.warning {
                    InlineBanner(tone: .warning, title: "You joined \(result.leagueName)", message: warning)
                }
                if model.isCodeMode {
                    codeEntry
                } else {
                    invitationHeader
                }

                if let message = model.errorMessage {
                    InlineBanner(tone: .error, title: "Unable to join", message: message)
                }

                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Team name", labelWidth: 100) {
                        TextField("Optional", text: $model.form.teamName)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.join)
                            .focused($focusedField, equals: .team)
                            .onSubmit(submit)
                            .accessibilityLabel("Team name")
                            .accessibilityHint(teamHint)
                    }
                    FormFieldRow(label: "Joining as", labelWidth: 100) {
                        joiningAs
                    }
                }
                .padding(.top, 4)

                FRFootnote(footnote)
            }
            .disabled(model.isRunning || model.completed != nil)
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Join a League")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.completed != nil {
                // Joined with a warning: the league is open behind the sheet.
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { router.dismissSheet() }
                        .buttonStyle(.glassProminent)
                        .tint(Color.frGold)
                }
            } else {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") {
                        if model.hasUnsavedInput {
                            confirmsDiscard = true
                        } else {
                            router.dismissSheet()
                        }
                    }
                    .disabled(model.isRunning)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Join", systemImage: "checkmark", action: submit)
                        .buttonStyle(.glassProminent)
                        .tint(Color.frGold)
                        .disabled(!model.form.canSubmit || model.isRunning)
                        .accessibilityValue(model.isRunning ? "Joining league" : "")
                }
            }
        }
        .confirmationDialog("Discard what you entered?", isPresented: $confirmsDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { router.dismissSheet() }
            Button("Keep Editing", role: .cancel) {}
        } message: {
            Text("You haven't joined yet.")
        }
        .interactiveDismissDisabled(model.hasUnsavedInput || model.isRunning)
        .onChange(of: model.hasUnsavedInput, initial: true) { _, unsaved in
            router.sheetHasUnsavedInput = unsaved
        }
        .onChange(of: model.form.code) { _, newValue in
            model.codeDidChange(newValue)
        }
        .onChange(of: model.form.teamName) {
            model.teamNameDidChange()
        }
        .announcesError(model.errorMessage)
    }

    // MARK: Code mode

    private var codeEntry: some View {
        VStack(spacing: 12) {
            Text("Enter the code shared by your league commissioner")
                .frFont(.label)
                .foregroundStyle(Color.frTextSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)

            TextField("K7MPQ2XW", text: $model.form.code)
                .font(.system(.title, design: .monospaced, weight: .semibold))
                .tracking(4)
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.join)
                .focused($focusedField, equals: .code)
                .onSubmit(submit)
                .foregroundStyle(Color.frText)
                .tint(Color.frGold)
                .padding(.horizontal, 16)
                .frame(minHeight: 64)
                .background(Color.frSurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(model.localError == nil ? Color.frBorder : Color.frError, lineWidth: 1)
                }
                .accessibilityLabel("Join code")
                .accessibilityHint("Enter the code shared by your league commissioner, or paste a join link.")

            PasteButton(payloadType: String.self) { [model] strings in
                // The paste callback isn't main-actor isolated; hop before touching the model.
                guard let pasted = strings.first else { return }
                Task { @MainActor in model.applyPasted(pasted) }
            }
            .labelStyle(.titleAndIcon)
            .buttonBorderShape(.capsule)
            .tint(Color.frGold)
            .frame(minHeight: FRMetrics.minTapTarget)
            .accessibilityHint("Pastes a code, a join link or an invitation link.")
        }
        .padding(.top, 8)
    }

    // MARK: Invitation mode

    private var invitationHeader: some View {
        VStack(spacing: 8) {
            Image(systemName: "envelope.open")
                .font(.system(size: 36, weight: .regular))
                .foregroundStyle(Color.frGold)
                .accessibilityHidden(true)
            Text("You've been invited")
                .frFont(.panelTitle)
                .foregroundStyle(Color.frText)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text("Join this fantasy movie league with the account below. The invitation works only for the email address it was sent to.")
                .frFont(.body)
                .foregroundStyle(Color.frTextSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Use a Code Instead") {
                model.useCodeInstead()
                focusedField = .code
            }
            .buttonStyle(.fr(.secondary, size: .compact))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 12)
    }

    // MARK: Shared rows

    private var joiningAs: some View {
        HStack(spacing: 8) {
            Avatar(name: displayName, imageURL: profile?.avatarURL, size: .small)
            VStack(alignment: .leading, spacing: 0) {
                Text(displayName)
                    .lineLimit(1)
                if let email = session.account?.email, profile?.displayName != nil {
                    Text(email)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Joining as \(displayName)\(accountEmailSuffix)")
    }

    private var displayName: String {
        if let name = profile?.displayName, !name.isEmpty { return name }
        return session.account?.email ?? "You"
    }

    private var accountEmailSuffix: String {
        guard profile?.displayName != nil, let email = session.account?.email else { return "" }
        return ", \(email)"
    }

    private var teamHint: String {
        "Leave the name blank to use one based on yours; you can rename it later."
    }

    private var footnote: String {
        model.isCodeMode ? "\(teamHint) Invited by email? Open the link in that email instead." : teamHint
    }

    // MARK: Submit

    private func submit() {
        guard !model.isRunning else { return }
        guard model.validate() else {
            if model.isCodeMode { focusedField = .code }
            return
        }
        focusedField = nil
        Task {
            // With a warning the sheet stays open to show it, with Done.
            if let result = await model.submit(), result.warning == nil {
                router.dismissSheet()
            }
        }
    }
}

#if DEBUG
#Preview("Join with code") {
    let environment = AppEnvironment.preview()
    let directory = LeagueDirectoryStore(userID: "preview-user", repository: environment.leagues)
    NavigationStack {
        JoinLeagueView(input: .code("k7mp-q2xw"), lifecycle: environment.leagueLifecycle, directory: directory)
    }
    .environment(environment)
    .environment(environment.session)
    .environment(ShellRouter())
    .environment(directory)
}

#Preview("Join by invitation") {
    let environment = AppEnvironment.preview()
    let directory = LeagueDirectoryStore(userID: "preview-user", repository: environment.leagues)
    NavigationStack {
        JoinLeagueView(input: .invitation(token: "preview-token"), lifecycle: environment.leagueLifecycle, directory: directory)
    }
    .environment(environment)
    .environment(environment.session)
    .environment(ShellRouter())
    .environment(directory)
    .preferredColorScheme(.light)
}
#endif
