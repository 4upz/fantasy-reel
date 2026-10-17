import FantasyReelAPI
import FantasyReelCore
import SwiftUI
import UIKit

/// Invite one player by name (existing users, `search-users`) or by email
/// address (`send-invite`), F-05. Pushed from the invite tools (`LeagueRoute.invitePlayer`).
///
/// A username invitation never shows the person's full email: results carry
/// only a masked hint. The server's own sentence is shown on success; a
/// throttled send says to try again later rather than calling it a failure.
/// Search and send state live in `InviteModel`.
struct InvitePlayerView: View {
    @Environment(\.leagueSelection) private var selection
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let selection, selection.isOwner {
                    if selection.season.status == .setup {
                        InvitePlayerForm(leagueID: selection.season.id, invitations: environment.invitations)
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
    }
}

/// The invite form for one setup season; owns its `InviteModel`.
private struct InvitePlayerForm: View {
    @State private var model: InviteModel

    init(leagueID: LeagueID, invitations: any InvitationRepository) {
        _model = State(initialValue: InviteModel(leagueID: leagueID, invitations: invitations))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            FRSegmentedControl("Invite by", selection: $model.mode, options: InviteMode.allCases, title: \.title)

            switch model.mode {
            case .name:
                nameSection
            case .email:
                emailSection
            }

            banners

            Button(action: send) {
                Text(model.isRunning ? "Sending…" : "Send Invite")
            }
            .buttonStyle(.fr(.primary, isLoading: model.isRunning))
            .disabled(!model.canSend || model.isRunning)

            FRFootnote("Invitations are emailed and work only for the address they go to. Inviting by name never shows you the person's email.")
        }
        // Keyed by the trimmed text, so spaces don't restart the wait.
        .task(id: model.trimmedQuery) { await model.search(model.trimmedQuery) }
        .onChange(of: model.mode) { model.modeDidChange() }
        .announcesError(model.localError ?? model.sendError)
    }

    private func send() {
        Task { await model.send() }
    }

    @ViewBuilder
    private var nameSection: some View {
        if let user = model.selectedUser {
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
                        model.clearSelection()
                    }
                    .buttonStyle(.fr(.neutral, size: .compact))
                    .disabled(model.isRunning)
                    .accessibilityLabel("Choose someone else")
                }
                .padding(.horizontal, FRMetrics.rowPadding)
                .padding(.vertical, 8)
                .frame(minHeight: FRMetrics.rowHeight)
            }
        } else {
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                FormFieldRow(label: "Name", labelWidth: 64) {
                    TextField("Search by name", text: $model.query)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        // Results appear as you type; Return just closes the keyboard.
                        .submitLabel(.done)
                        .accessibilityLabel("Search users by name")
                }
            }
            searchResults
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        let count = model.trimmedQuery.count
        if count == 1 {
            FRFootnote("Type at least 2 characters.")
        } else if count >= 2 {
            switch model.results {
            case .idle, .loading:
                LoadingView(label: "Searching…")
                    .frame(minHeight: 88)
            case .empty:
                FRFootnote("No users found. Invite them by email instead.")
            case .failed(let message):
                if model.searchRateLimited {
                    InlineBanner(tone: .warning, title: "Try again later", message: message)
                } else {
                    InlineBanner(tone: .error, title: "Search didn't work", message: message)
                }
            case .loaded(let users):
                FRRowGroup {
                    ForEach(users) { user in
                        Button {
                            model.choose(user)
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
                TextField("name@example.com", text: $model.email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .onSubmit(send)
                    .accessibilityLabel("Email address")
            }
        }
        .disabled(model.isRunning)
    }

    @ViewBuilder
    private var banners: some View {
        if let localError = model.localError {
            InlineBanner(tone: .error, title: localError)
        } else if model.outcomeUncertain {
            InlineBanner(
                tone: .warning,
                title: "We couldn't confirm the invitation was sent",
                message: "Check the invitations list before sending it again."
            )
        } else if let message = model.sendError {
            if model.sendRateLimited {
                InlineBanner(tone: .warning, title: "Try again later", message: message)
            } else {
                InlineBanner(tone: .error, title: "Couldn't send the invitation", message: message)
            }
        }
        if let sentMessage = model.sentMessage {
            if let sentLink = model.sentLink {
                InlineBanner(tone: .success, title: sentMessage, actionTitle: "Copy Link") {
                    UIPasteboard.general.string = sentLink.absoluteString
                    Announcer.announce("Invite link copied")
                }
            } else {
                InlineBanner(tone: .success, title: sentMessage)
            }
        }
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
