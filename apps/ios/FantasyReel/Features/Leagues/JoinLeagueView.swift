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
    let input: JoinInput

    @Environment(AppEnvironment.self) private var environment
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(SessionStore.self) private var session
    @Environment(\.currentProfile) private var profile

    @State private var mode: Mode
    @State private var code: String
    @State private var teamName = ""
    @State private var join = AsyncAction()
    @State private var localError: String?
    @State private var outcomeUncertain = false
    @FocusState private var focusedField: Field?

    private let initialCode: String

    private enum Mode: Equatable {
        case code
        case invitation(token: String)
    }

    private enum Field { case code, team }

    init(input: JoinInput) {
        self.input = input
        switch input {
        case .manual:
            _mode = State(initialValue: .code)
            _code = State(initialValue: "")
            initialCode = ""
        case .code(let value):
            let normalized = JoinCode.normalize(value)
            _mode = State(initialValue: .code)
            _code = State(initialValue: normalized)
            initialCode = normalized
        case .invitation(let token):
            _mode = State(initialValue: .invitation(token: token))
            _code = State(initialValue: "")
            initialCode = ""
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                switch mode {
                case .code:
                    codeEntry
                case .invitation:
                    invitationHeader
                }

                if let message = errorMessage {
                    InlineBanner(tone: .error, title: "Unable to join", message: message)
                }

                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    FormFieldRow(label: "Team name", labelWidth: 100) {
                        TextField("Optional", text: $teamName)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.join)
                            .focused($focusedField, equals: .team)
                            .onSubmit(submit)
                            .accessibilityHint(teamHint)
                    }
                    FormFieldRow(label: "Joining as", labelWidth: 100) {
                        joiningAs
                    }
                }
                .padding(.top, 4)

                Text(footnote)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
            }
            .disabled(join.isRunning)
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Join a League")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { router.dismissSheet() }
                    .disabled(join.isRunning)
            }
            ToolbarItem(placement: .confirmationAction) {
                if join.isRunning {
                    ProgressView()
                        .accessibilityLabel("Joining league")
                } else {
                    Button("Join", action: submit)
                        .disabled(!canSubmit)
                }
            }
        }
        .interactiveDismissDisabled(join.isRunning)
        .onChange(of: hasUnsavedInput, initial: true) { _, unsaved in
            router.sheetHasUnsavedInput = unsaved
        }
        .onChange(of: code) { _, newValue in
            codeDidChange(newValue)
        }
        .onChange(of: teamName) { _, newValue in
            if newValue.count > CreateLeagueRequest.maxTeamNameLength {
                teamName = String(newValue.prefix(CreateLeagueRequest.maxTeamNameLength))
            }
        }
        .announcesError(errorMessage)
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

            TextField("K7MPQ2XW", text: $code)
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
                        .strokeBorder(localError == nil ? Color.frBorder : Color.frError, lineWidth: 1)
                }
                .accessibilityLabel("Join code")
                .accessibilityHint("Enter the code shared by your league commissioner, or paste a join link.")

            PasteButton(payloadType: String.self) { strings in
                guard let pasted = strings.first else { return }
                applyPasted(pasted)
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
                mode = .code
                localError = nil
                join.clearError()
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
        switch mode {
        case .code:
            "\(teamHint) Invited by email? Open the link in that email instead."
        case .invitation:
            teamHint
        }
    }

    // MARK: State

    private var errorMessage: String? {
        if let localError { return localError }
        if outcomeUncertain {
            return "We couldn't confirm whether you joined. Check your league list before trying again."
        }
        return join.errorMessage
    }

    private var hasUnsavedInput: Bool {
        !teamName.isEmpty || (mode == .code && code != initialCode)
    }

    private var canSubmit: Bool {
        switch mode {
        case .code: !code.isEmpty
        case .invitation: true
        }
    }

    private func codeDidChange(_ newValue: String) {
        localError = nil
        outcomeUncertain = false
        // A pasted or typed link: read the code or the invitation token from it.
        if newValue.contains("?") || newValue.contains("://") {
            applyPasted(newValue)
            return
        }
        let normalized = JoinCode.normalize(newValue)
        if normalized != newValue { code = normalized }
    }

    private func applyPasted(_ text: String) {
        localError = nil
        outcomeUncertain = false
        join.clearError()
        switch JoinCode.parse(text) {
        case .invitation(let token):
            code = ""
            mode = .invitation(token: token)
            Announcer.announce("Invitation link pasted")
        case .code(let parsed):
            mode = .code
            code = parsed
            if !parsed.isEmpty {
                let spelled = parsed.map { String($0) }.joined(separator: " ")
                Announcer.announce("Code \(spelled) pasted")
            }
        }
    }

    private func submit() {
        guard !join.isRunning else { return }
        localError = nil
        outcomeUncertain = false

        let route: JoinLeagueRequest.Route
        switch mode {
        case .code:
            let normalized = JoinCode.normalize(code)
            guard !normalized.isEmpty else {
                localError = "Please enter a join code"
                focusedField = .code
                return
            }
            guard JoinCode.isValid(normalized) else {
                localError = JoinCode.invalidFormatMessage
                focusedField = .code
                return
            }
            route = .code(normalized)
        case .invitation(let token):
            route = .invitation(token: token)
        }

        let team = teamName.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = JoinLeagueRequest(route: route, teamName: team.isEmpty ? nil : team)
        let lifecycle = environment.leagueLifecycle
        focusedField = nil
        Task {
            let succeeded = await join.runAndWait {
                let result = try await lifecycle.joinLeague(request)
                // A `warning` still means the person is in: open the league
                // and let its home screen offer recovery. Never join again.
                await directory.refresh()
                directory.select(result.leagueID)
                Announcer.announce("Joined \(result.leagueName)")
                router.dismissSheet()
            }
            if !succeeded, join.lastError?.isUncertainOutcome == true {
                await directory.refresh()
                outcomeUncertain = true
            }
        }
    }
}

#if DEBUG
#Preview("Join with code") {
    let environment = AppEnvironment.preview()
    NavigationStack { JoinLeagueView(input: .code("k7mp-q2xw")) }
        .environment(environment)
        .environment(environment.session)
        .environment(ShellRouter())
        .environment(LeagueDirectoryStore(userID: "preview-user", repository: environment.leagues))
}

#Preview("Join by invitation") {
    let environment = AppEnvironment.preview()
    NavigationStack { JoinLeagueView(input: .invitation(token: "preview-token")) }
        .environment(environment)
        .environment(environment.session)
        .environment(ShellRouter())
        .environment(LeagueDirectoryStore(userID: "preview-user", repository: environment.leagues))
        .preferredColorScheme(.light)
}
#endif
