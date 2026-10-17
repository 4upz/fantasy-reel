import FantasyReelAPI
import FantasyReelCore
import SwiftUI
import UIKit

/// Owner: share the join code and link, invite by name or email, and manage
/// the invitations already sent (F-05). Pushed from the league `⋯` menu
/// ("Share invite", owner in setup).
struct ShareInviteView: View {
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let selection, selection.isOwner {
                    ScreenHeader(
                        "Invite Players",
                        eyebrow: "\(selection.season.name) · \(String(selection.season.seasonYear)) Season"
                    )
                    LeagueInviteTools(season: selection.season)
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
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .navigationTitle("Invite")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The owner's invite tools for a setup season (F-05): the join code and link
/// with Share and Regenerate, Invite Player, and the invitation list with
/// Resend and Cancel. The draft room (setup) embeds this; it renders nothing
/// for members or once the draft has started.
struct LeagueInvitesSection: View {
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        if let selection, selection.isOwner, selection.season.status == .setup {
            LeagueInviteTools(season: selection.season)
        }
    }
}

/// Join code card, Invite Player, invitation list.
private struct LeagueInviteTools: View {
    let season: League

    @Environment(ShellRouter.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            JoinCodeCard(season: season)
            if season.status == .setup {
                Button {
                    router.push(.invitePlayer)
                } label: {
                    Label("Invite Player", systemImage: "person.badge.plus")
                }
                .buttonStyle(.frSecondary)
                .accessibilityHint("Invite someone by name or email address.")
            }
            LeagueInvitationsList(season: season)
        }
    }
}

// MARK: - Join code

/// The season's share code (`league_join_links`) with Copy, Share and
/// Regenerate (V2DraftSetup "Join code"). Owner only.
///
/// A failed read shows an error with Try Again and never generates a code to
/// cover it: generating would kill a code that may already be shared. Generate
/// appears only when the read succeeded and found no code. Outside setup the
/// card says joining is closed.
struct JoinCodeCard: View {
    let season: League

    @Environment(AppEnvironment.self) private var environment

    @State private var state: LoadState<String> = .idle
    @State private var generate = AsyncAction()
    @State private var confirmsRegenerate = false
    @State private var copiedCode: String?

    init(season: League) {
        self.season = season
    }

    var body: some View {
        FRCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Join code")
                    .frFont(.overline)
                    .foregroundStyle(Color.frTextSecondary)
                    .accessibilityAddTraits(.isHeader)
                if season.status == .setup {
                    content
                } else {
                    JoinCodeNote(
                        systemImage: "lock.fill",
                        text: "Joining closed when the draft started. Codes and links work only during setup.",
                        tone: .neutral
                    )
                }
            }
        }
        .task(id: season.id) {
            guard season.status == .setup else { return }
            await load()
        }
        .confirmationDialog("Regenerate the join code?", isPresented: $confirmsRegenerate, titleVisibility: .visible) {
            Button("Regenerate", role: .destructive) { generateCode(replacing: true) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(Self.regenerateHint)
        }
        .announcesError(generate.errorMessage)
    }

    static let regenerateHint = "Regenerating replaces the link and code. The old ones stop working."

    @ViewBuilder
    private var content: some View {
        switch state {
        case .idle, .loading:
            HStack(spacing: 10) {
                ProgressView()
                Text("Loading join code…")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
            .frame(minHeight: FRMetrics.minTapTarget)
            .accessibilityElement(children: .combine)
        case .failed(let message):
            JoinCodeNote(systemImage: "exclamationmark.triangle.fill", text: "Couldn't load the join code. \(message)", tone: .error)
            Button("Try Again") {
                Task { await load() }
            }
            .buttonStyle(.fr(.secondary, size: .medium))
        case .empty:
            Text("No join code yet. Generate one to share a link anyone can use to join while the league is in setup.")
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            generateError
            Button {
                generateCode(replacing: false)
            } label: {
                Text(generate.isRunning ? "Generating…" : "Generate Join Link")
            }
            .buttonStyle(.fr(.primary, size: .medium, isLoading: generate.isRunning, fullWidth: true))
            .disabled(generate.isRunning)
        case .loaded(let code):
            codeRow(code)
            generateError
            Button {
                confirmsRegenerate = true
            } label: {
                Text(generate.isRunning ? "Regenerating…" : "Regenerate…")
                    .frFont(.label)
                    .foregroundStyle(generate.isRunning ? Color.frTextMuted : Color.frGold)
                    .frame(minHeight: FRMetrics.minTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(generate.isRunning)
            .accessibilityLabel("Regenerate join code")
            .accessibilityHint(Self.regenerateHint)
            .padding(.vertical, -8)
            Text(Self.regenerateHint)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var generateError: some View {
        if let message = generate.errorMessage {
            JoinCodeNote(systemImage: "exclamationmark.octagon.fill", text: message, tone: .error)
        }
    }

    private func codeRow(_ code: String) -> some View {
        let url = JoinCode.shareURL(code: code, siteURL: environment.configuration.siteURL)
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                codeText(code)
                copyButton(code)
                shareButton(code: code, url: url)
            }
            VStack(alignment: .leading, spacing: 10) {
                codeText(code)
                HStack(spacing: 8) {
                    copyButton(code)
                    shareButton(code: code, url: url)
                }
            }
        }
    }

    private func codeText(_ code: String) -> some View {
        let spelled = code.map { String($0) }.joined(separator: " ")
        return Text(code)
            .font(.system(.title, design: .monospaced, weight: .semibold))
            .foregroundStyle(Color.frText)
            .lineLimit(1)
            .fixedSize()
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            // Spelled out: VoiceOver reads "K7MPQ2XW" as a word and a number.
            .accessibilityLabel("Join code \(spelled)")
    }

    private func copyButton(_ code: String) -> some View {
        Button {
            UIPasteboard.general.string = code
            copiedCode = code
            Announcer.announce("Code copied")
        } label: {
            Text(copiedCode == code ? "Copied" : "Copy")
        }
        .buttonStyle(.fr(.neutral, size: .medium))
        .accessibilityLabel(copiedCode == code ? "Join code copied" : "Copy join code")
    }

    private func shareButton(code: String, url: URL) -> some View {
        ShareLink(
            item: url,
            subject: Text("Join \(season.name) on Fantasy Reel"),
            message: Text("Join my Fantasy Reel league with code \(code).")
        ) {
            Label("Share", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(.fr(.secondary, size: .medium))
        .accessibilityLabel("Share invite link")
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let code = try await environment.invitations.fetchJoinCode(of: season.id)
            if let code {
                state = .loaded(code)
            } else {
                state = .empty
            }
        } catch {
            if error.isCancellation { return }
            // Keep a code already on screen; never generate to cover a failure.
            if state.value == nil { state = .failed(message: error.userMessage) }
        }
    }

    private func generateCode(replacing: Bool) {
        guard !generate.isRunning else { return }
        let repository = environment.invitations
        let leagueID = season.id
        Task {
            let succeeded = await generate.runAndWait {
                let code = try await repository.generateJoinCode(for: leagueID)
                state = .loaded(code)
                copiedCode = nil
                Announcer.announce(replacing ? "Join code regenerated" : "Join link generated")
            }
            // The server may have replaced the code anyway: show whichever is current.
            if !succeeded, generate.lastError?.isUncertainOutcome == true {
                await load()
            }
        }
    }
}

/// An icon and a sentence inside the join code card (a card can't hold a
/// banner card).
private struct JoinCodeNote: View {
    let systemImage: String
    let text: String
    let tone: FRTone

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.foreground)
                .accessibilityHidden(true)
            Text(text)
                .frFont(.bodySmall)
                .foregroundStyle(tone == .error ? Color.frText : Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Invitations list

/// Every invitation of the season (`get_league_invitations`): recipient, its
/// effective status and when it was sent, with Resend, Copy Link and Cancel.
private struct LeagueInvitationsList: View {
    let season: League

    @Environment(AppEnvironment.self) private var environment

    @State private var state: LoadState<[LeagueInvitation]> = .idle
    @State private var action = AsyncAction()
    @State private var busyID: InvitationID?
    @State private var notice: String?
    @State private var pendingCancel: LeagueInvitation?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if pendingCount > 0 {
                SectionHeader("Invitations", detail: "\(pendingCount) pending")
            } else {
                SectionHeader("Invitations")
            }
            if let message = action.errorMessage {
                if isRateLimited {
                    InlineBanner(tone: .warning, title: "Try again later", message: message)
                } else {
                    InlineBanner(tone: .error, title: "Couldn't update the invitation", message: message)
                }
            }
            if let notice {
                InlineBanner(tone: .success, title: notice)
            }
            switch state {
            case .idle, .loading:
                LoadingView(label: "Loading invitations…")
                    .frame(minHeight: 88)
            case .failed(let message):
                ErrorStateView(title: "Invitations didn't load", message: message, layout: .card) {
                    Task { await load() }
                }
            case .empty:
                Text("No invitations yet. Invite players by name or email, or share the join code.")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            case .loaded(let invitations):
                FRRowGroup {
                    ForEach(invitations) { invitation in
                        LeagueInvitationRow(
                            invitation: invitation,
                            isBusy: busyID == invitation.id,
                            actionsDisabled: action.isRunning,
                            resend: { resend(invitation) },
                            copyLink: { copyLink(invitation) },
                            cancel: { pendingCancel = invitation }
                        )
                    }
                }
            }
        }
        .task(id: season.id) { await load() }
        .refreshOnForeground { await load() }
        .confirmationDialog(
            "Cancel this invitation?",
            isPresented: Binding(
                get: { pendingCancel != nil },
                set: { if !$0 { pendingCancel = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingCancel
        ) { invitation in
            Button("Cancel Invitation", role: .destructive) { cancel(invitation) }
            Button("Keep", role: .cancel) {}
        } message: { invitation in
            Text("\(invitation.recipient) won't be able to join with this invitation.")
        }
        .announcesError(action.errorMessage)
    }

    private var invitations: [LeagueInvitation] { state.value ?? [] }

    private var pendingCount: Int {
        let now = Date()
        return invitations.filter { $0.effectiveStatus(now: now) == .pending }.count
    }

    private var isRateLimited: Bool {
        guard let error = action.lastError, case .rateLimited = error else { return false }
        return true
    }

    private func load() async {
        if state.value == nil, state.errorMessage == nil { state = .loading }
        do {
            let rows = try await environment.invitations.fetchInvitations(of: season.id)
            let newState: LoadState<[LeagueInvitation]> = rows.isEmpty ? .empty : .loaded(rows)
            if newState != state { state = newState }
        } catch {
            if error.isCancellation { return }
            if state.value == nil { state = .failed(message: error.userMessage) }
        }
    }

    private func resend(_ invitation: LeagueInvitation) {
        let repository = environment.invitations
        perform(on: invitation) {
            let result = try await repository.resend(invitation.id)
            notice = result.message
            Announcer.announce(result.message)
        }
    }

    private func cancel(_ invitation: LeagueInvitation) {
        let repository = environment.invitations
        perform(on: invitation) {
            try await repository.cancel(invitation.id)
            notice = "Invitation to \(invitation.recipient) cancelled"
            Announcer.announce("Invitation cancelled")
        }
    }

    private func copyLink(_ invitation: LeagueInvitation) {
        let url = JoinCode.invitationURL(token: invitation.token, siteURL: environment.configuration.siteURL)
        UIPasteboard.general.string = url.absoluteString
        action.clearError()
        notice = "Invite link copied"
        Announcer.announce("Invite link copied")
    }

    /// Runs one row action, then re-reads the list (resend rotates the token
    /// and expiry; an uncertain result may have changed the row anyway).
    private func perform(on invitation: LeagueInvitation, _ operation: @escaping @MainActor () async throws -> Void) {
        guard !action.isRunning else { return }
        busyID = invitation.id
        notice = nil
        Task {
            await action.runAndWait {
                try await operation()
            }
            busyID = nil
            await load()
        }
    }
}

/// One invitation (`.mrow`): an envelope (email) or person (by name) bubble,
/// the recipient, "Pending · sent Oct 3", and an actions menu.
private struct LeagueInvitationRow: View {
    let invitation: LeagueInvitation
    let isBusy: Bool
    let actionsDisabled: Bool
    let resend: () -> Void
    let copyLink: () -> Void
    let cancel: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let now = Date()
        let canResend = invitation.canResend(now: now)
        let canCancel = invitation.canCancel(now: now)
        HStack(spacing: FRMetrics.rowGap) {
            HStack(spacing: FRMetrics.rowGap) {
                Image(systemName: hasEmail ? "envelope" : "person")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.frTextSecondary)
                    .frame(width: 36, height: 36)
                    .background(Color.frNeutralFill, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(invitation.recipient)
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                    Text(meta(now: now))
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)

            if isBusy {
                ProgressView()
                    .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                    .accessibilityLabel("Updating invitation")
            } else if canResend || canCancel {
                Menu {
                    if canResend {
                        Button("Resend Invitation", systemImage: "arrow.clockwise", action: resend)
                    }
                    if canCancel {
                        Button("Copy Link", systemImage: "link", action: copyLink)
                        Button("Cancel Invitation", systemImage: "xmark", role: .destructive, action: cancel)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.frTextSecondary)
                        .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                        .contentShape(Rectangle())
                }
                .disabled(actionsDisabled)
                .accessibilityLabel("Actions for \(invitation.recipient)")
                .padding(.trailing, -10)
            }
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 8)
        .frame(minHeight: FRMetrics.rowHeight)
    }

    private var hasEmail: Bool {
        if let email = invitation.email, !email.isEmpty { return true }
        return false
    }

    private func meta(now: Date) -> String {
        let status = invitation.effectiveStatus(now: now).displayName
        guard let sentAt = invitation.sentAt else { return status }
        return "\(status) · sent \(sentAt.formatted(.dateTime.month(.abbreviated).day()))"
    }
}

#if DEBUG
#Preview("Invite tools") {
    let now = Date()
    let season = League(
        id: "preview-season", name: "Saturday Matinee Society", ownerID: "preview-user", status: .setup,
        seriesID: "preview-series", seasonYear: 2027, seasonEnd: DateOnly(year: 2027, month: 12, day: 31)!,
        createdAt: now, updatedAt: now
    )
    let environment = AppEnvironment.preview(
        invitations: InMemoryInvitationRepository(
            invitations: [
                LeagueInvitation(
                    id: "inv-1", leagueID: "preview-season", email: "eve@example.com", token: "token-1",
                    status: .pending, sentAt: now.addingTimeInterval(-2 * 86_400), expiresAt: now.addingTimeInterval(5 * 86_400)
                ),
                LeagueInvitation(
                    id: "inv-2", leagueID: "preview-season", inviteeDisplayName: "Frank Capra", token: "token-2",
                    status: .accepted, sentAt: now.addingTimeInterval(-4 * 86_400)
                ),
            ],
            joinCodes: ["preview-season": "K7MPQ2XW"]
        )
    )
    NavigationStack {
        ShareInviteView()
    }
    .environment(environment)
    .environment(environment.session)
    .environment(ShellRouter())
    .environment(\.leagueSelection, LeagueSelection(userID: "preview-user", season: season, seriesSeasons: [season]))
}

#Preview("Join code · locked") {
    let now = Date()
    let season = League(
        id: "preview-season", name: "Popcorn Syndicate", ownerID: "preview-user", status: .active,
        seriesID: "preview-series", seasonYear: 2026, seasonEnd: DateOnly(year: 2026, month: 12, day: 31)!,
        createdAt: now, updatedAt: now
    )
    FRPreviewCanvas {
        JoinCodeCard(season: season)
    }
    .environment(AppEnvironment.preview())
}
#endif
