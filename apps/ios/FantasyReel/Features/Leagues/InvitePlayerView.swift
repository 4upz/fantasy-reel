import FantasyReelAPI
import FantasyReelCore
import SwiftUI
import UIKit

private enum InviteMode: Hashable, CaseIterable {
    case name
    case email

    var title: String {
        switch self {
        case .name: "By name"
        case .email: "By email"
        }
    }
}

/// Invite one player by name (existing users, `search-users`) or by email
/// address (`send-invite`), F-05. Pushed from the invite tools (`LeagueRoute.invitePlayer`).
///
/// A username invitation never shows the person's full email: results carry
/// only a masked hint. The server's own sentence is shown on success; a
/// throttled send says to try again later rather than calling it a failure.
struct InvitePlayerView: View {
    @Environment(\.leagueSelection) private var selection
    @Environment(AppEnvironment.self) private var environment

    @State private var mode: InviteMode = .name
    @State private var query = ""
    @State private var results: LoadState<[UserSearchResult]> = .idle
    @State private var searchRateLimited = false
    @State private var selectedUser: UserSearchResult?
    @State private var email = ""
    @State private var send = AsyncAction()
    @State private var localError: String?
    @State private var outcomeUncertain = false
    @State private var sentMessage: String?
    @State private var sentLink: URL?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let selection, selection.isOwner {
                    if selection.season.status == .setup {
                        form
                    } else {
                        InlineBanner(
                            tone: .info,
                            title: "Invitations closed when the draft started",
                            message: "Joining, inviting and join links work only during setup."
                        )
                    }
                } else {
                    EmptyStateView(
                        title: "Only the commissioner can invite players",
                        message: "Ask your commissioner for the league's join code.",
                        systemImage: "person.badge.plus"
                    )
                    .padding(.top, 32)
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Invite Player")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query) { await debouncedSearch() }
        .onChange(of: mode) {
            localError = nil
            outcomeUncertain = false
            sentMessage = nil
            sentLink = nil
            send.clearError()
        }
        .announcesError(localError ?? send.errorMessage)
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            FRSegmentedControl("Invite by", selection: $mode, options: InviteMode.allCases, title: \.title)

            switch mode {
            case .name:
                nameSection
            case .email:
                emailSection
            }

            banners

            Button(action: submit) {
                Text(send.isRunning ? "Sending…" : "Send Invite")
            }
            .buttonStyle(.fr(.primary, isLoading: send.isRunning))
            .disabled(!canSend || send.isRunning)

            Text("Invitations are emailed and work only for the address they go to. Inviting by name never shows you the person's email.")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var nameSection: some View {
        if let user = selectedUser {
            Text("Selected player")
                .frFont(.overline)
                .foregroundStyle(Color.frTextSecondary)
                .padding(.horizontal, 16)
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                HStack(spacing: FRMetrics.rowGap) {
                    HStack(spacing: FRMetrics.rowGap) {
                        Avatar(name: user.displayName, imageURL: user.avatarURL, size: .medium)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName)
                                .frFont(.rowTitle)
                                .foregroundStyle(Color.frText)
                            Text(user.emailHint)
                                .frFont(.meta)
                                .foregroundStyle(Color.frTextSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Selected: \(user.displayName), \(user.emailHint)")
                    Button("Change") {
                        selectedUser = nil
                        sentMessage = nil
                    }
                    .buttonStyle(.fr(.neutral, size: .compact))
                    .disabled(send.isRunning)
                    .accessibilityLabel("Choose someone else")
                }
                .padding(.horizontal, FRMetrics.rowPadding)
                .padding(.vertical, 8)
                .frame(minHeight: FRMetrics.rowHeight)
            }
        } else {
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                FormFieldRow(label: "Name", labelWidth: 64) {
                    TextField("Search by name", text: $query)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .accessibilityLabel("Search users by name")
                }
            }
            searchResults
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        let count = trimmedQuery.count
        if count == 1 {
            Text("Type at least 2 characters.")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .padding(.horizontal, 16)
        } else if count >= 2 {
            switch results {
            case .idle, .loading:
                LoadingView(label: "Searching…")
                    .frame(minHeight: 88)
            case .empty:
                Text("No users found. Invite them by email instead.")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 16)
            case .failed(let message):
                if searchRateLimited {
                    InlineBanner(tone: .warning, title: "Try again later", message: message)
                } else {
                    InlineBanner(tone: .error, title: "Search didn't work", message: message)
                }
            case .loaded(let users):
                FRRowGroup {
                    ForEach(users) { user in
                        Button {
                            choose(user)
                        } label: {
                            ListRow(
                                title: user.displayName,
                                meta: user.emailHint,
                                accessibilityLabel: "\(user.displayName), \(user.emailHint)",
                                leading: { Avatar(name: user.displayName, imageURL: user.avatarURL, size: .medium) },
                                trailing: { EmptyView() }
                            )
                        }
                        .buttonStyle(.frRow)
                        .accessibilityHint("Selects this person to invite.")
                    }
                }
            }
        }
    }

    private var emailSection: some View {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            FormFieldRow(label: "Email", labelWidth: 64) {
                TextField("name@example.com", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .onSubmit(submit)
                    .accessibilityLabel("Email address")
            }
        }
        .disabled(send.isRunning)
    }

    @ViewBuilder
    private var banners: some View {
        if let localError {
            InlineBanner(tone: .error, title: localError)
        } else if outcomeUncertain {
            InlineBanner(
                tone: .warning,
                title: "We couldn't confirm the invitation was sent",
                message: "Check the invitations list before sending it again."
            )
        } else if let message = send.errorMessage {
            if sendRateLimited {
                InlineBanner(tone: .warning, title: "Try again later", message: message)
            } else {
                InlineBanner(tone: .error, title: "Couldn't send the invitation", message: message)
            }
        }
        if let sentMessage {
            if let sentLink {
                InlineBanner(tone: .success, title: sentMessage, actionTitle: "Copy Link") {
                    UIPasteboard.general.string = sentLink.absoluteString
                    Announcer.announce("Invite link copied")
                }
            } else {
                InlineBanner(tone: .success, title: sentMessage)
            }
        }
    }

    // MARK: State

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSend: Bool {
        switch mode {
        case .name: selectedUser != nil
        case .email: !trimmedEmail.isEmpty
        }
    }

    private var sendRateLimited: Bool {
        guard let error = send.lastError, case .rateLimited = error else { return false }
        return true
    }

    private func choose(_ user: UserSearchResult) {
        selectedUser = user
        sentMessage = nil
        sentLink = nil
        Announcer.announce("\(user.displayName) selected")
    }

    /// Waits ~300 ms after the last keystroke (`.task(id: query)` cancels the
    /// previous wait), then searches with 2+ characters.
    private func debouncedSearch() async {
        let text = trimmedQuery
        guard text.count >= 2, let leagueID = selection?.season.id else {
            results = .idle
            return
        }
        results = .loading
        do {
            try await Task.sleep(for: .milliseconds(300))
        } catch {
            return
        }
        await search(text, in: leagueID)
    }

    private func search(_ text: String, in leagueID: LeagueID) async {
        do {
            let users = try await environment.invitations.searchUsers(text, in: leagueID)
            if Task.isCancelled { return }
            searchRateLimited = false
            results = users.isEmpty ? .empty : .loaded(users)
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if case .rateLimited = error {
                searchRateLimited = true
            } else {
                searchRateLimited = false
            }
            results = .failed(message: error.userMessage)
        }
    }

    private func submit() {
        guard !send.isRunning, let season = selection?.season else { return }
        localError = nil
        outcomeUncertain = false
        sentMessage = nil
        sentLink = nil

        let recipient: InviteRecipient
        let invitee: String?
        switch mode {
        case .name:
            guard let user = selectedUser else {
                localError = "Choose someone to invite"
                return
            }
            recipient = .user(user.userID)
            invitee = user.displayName
        case .email:
            let address = trimmedEmail
            guard AuthMessages.looksLikeEmail(address) else {
                localError = AuthMessages.invalidEmail
                return
            }
            recipient = .email(address)
            invitee = nil
        }

        let repository = environment.invitations
        let leagueID = season.id
        Task {
            let succeeded = await send.runAndWait {
                let result = try await repository.invite(recipient, to: leagueID)
                let message = Self.successMessage(for: result, invitee: invitee)
                sentMessage = message
                sentLink = result.inviteURL
                selectedUser = nil
                query = ""
                email = ""
                Announcer.announce(message)
            }
            if !succeeded, send.lastError?.isUncertainOutcome == true {
                outcomeUncertain = true
            }
        }
    }

    /// Username invitations name the person rather than the address the
    /// server used (web `InviteModal.inviteMessage`).
    private static func successMessage(for result: InviteResult, invitee: String?) -> String {
        guard let invitee else { return result.message }
        return result.emailSent
            ? "Invitation sent to \(invitee)"
            : "Invitation created for \(invitee) (email delivery pending)"
    }
}

#if DEBUG
#Preview("Invite player") {
    let now = Date()
    let season = League(
        id: "preview-season", name: "Saturday Matinee Society", ownerID: "preview-user", status: .setup,
        seriesID: "preview-series", seasonYear: 2027, seasonEnd: DateOnly(year: 2027, month: 12, day: 31)!,
        createdAt: now, updatedAt: now
    )
    let environment = AppEnvironment.preview(
        invitations: InMemoryInvitationRepository(searchResults: [
            UserSearchResult(userID: "user-eve", displayName: "Eve Lumet", emailHint: "e***@example.com"),
            UserSearchResult(userID: "user-frank", displayName: "Frank Capra", emailHint: "f***@example.com"),
        ])
    )
    NavigationStack {
        InvitePlayerView()
    }
    .environment(environment)
    .environment(\.leagueSelection, LeagueSelection(userID: "preview-user", season: season, seriesSeasons: [season]))
}
#endif
