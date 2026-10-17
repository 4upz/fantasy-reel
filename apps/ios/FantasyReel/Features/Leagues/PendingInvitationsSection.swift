import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Pending invitations with Accept and Decline, shown in the menu sheet and on
/// the no-league screen (F-05, mockups V2Menu and V2NoLeagues). Renders
/// nothing while there are none.
///
/// Accept opens the join sheet in invitation mode, which waits for the person
/// to confirm (links and cards only pre-fill). Decline asks first, then calls
/// `decline-invitation`.
struct PendingInvitationsSection: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session
    @Environment(ShellRouter.self) private var router

    @State private var invitations: [PendingInvitation] = []
    @State private var loadError: String?
    @State private var decline = AsyncAction()
    @State private var decliningID: InvitationID?
    @State private var pendingDecline: PendingInvitation?

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            if !invitations.isEmpty {
                if invitations.count == 1 {
                    SectionHeader("Invitation")
                } else {
                    SectionHeader("Invitations", detail: "\(invitations.count)")
                }
                if let message = decline.errorMessage {
                    InlineBanner(tone: .error, title: "Couldn't decline the invitation", message: message)
                }
                ForEach(invitations) { invitation in
                    PendingInvitationCard(
                        invitation: invitation,
                        isDeclining: decliningID == invitation.id,
                        isBusy: decline.isRunning,
                        accept: { accept(invitation) },
                        decline: { pendingDecline = invitation }
                    )
                }
            } else if let loadError {
                ErrorStateView(
                    title: "Invitations didn't load",
                    message: loadError,
                    layout: .card
                ) {
                    Task { await load() }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: session.account?.email) { await load() }
        .refreshOnForeground { await load() }
        .announcesError(decline.errorMessage)
        .confirmationDialog(
            pendingDecline.map { "Decline the invitation to \($0.leagueName)?" } ?? "Decline this invitation?",
            isPresented: Binding(
                get: { pendingDecline != nil },
                set: { if !$0 { pendingDecline = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDecline
        ) { invitation in
            Button("Decline", role: .destructive) { declineInvitation(invitation) }
            Button("Keep", role: .cancel) {}
        }
    }

    private func load() async {
        guard let email = session.account?.email, !email.isEmpty else {
            invitations = []
            loadError = nil
            return
        }
        do {
            let pending = try await environment.invitations.fetchPending(for: email)
            if pending != invitations { invitations = pending }
            loadError = nil
        } catch {
            if error.isCancellation { return }
            // Keep showing cards already on screen; only an empty section
            // turns into the error card.
            if invitations.isEmpty { loadError = error.userMessage }
        }
    }

    private func accept(_ invitation: PendingInvitation) {
        router.present(.joinLeague(.invitation(token: invitation.token)))
    }

    private func declineInvitation(_ invitation: PendingInvitation) {
        guard !decline.isRunning else { return }
        decliningID = invitation.id
        let repository = environment.invitations
        decline.run {
            defer { decliningID = nil }
            try await repository.decline(invitation.id)
            invitations.removeAll { $0.id == invitation.id }
            Announcer.announce("Invitation to \(invitation.leagueName) declined")
        }
    }
}

/// One invitation card (V2Menu "Invitation"): league avatar and name, when it
/// was sent and when it expires, then Decline and Accept side by side.
private struct PendingInvitationCard: View {
    let invitation: PendingInvitation
    let isDeclining: Bool
    let isBusy: Bool
    let accept: () -> Void
    let decline: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        FRCard(padding: EdgeInsets(top: 12, leading: 16, bottom: 16, trailing: 16)) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Avatar(name: invitation.leagueName, size: .medium)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(invitation.leagueName)
                            .frFont(.rowTitle)
                            .foregroundStyle(Color.frText)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                        meta
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: FRMetrics.minTapTarget)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(accessibilityText)

                buttons
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var meta: some View {
        HStack(spacing: 0) {
            if let sent = sentText {
                Text("\(sent) · ")
                    .foregroundStyle(Color.frTextSecondary)
            }
            Text(expiryText)
                .foregroundStyle(isExpiringSoon ? Color.frWarning : Color.frTextSecondary)
        }
        .frFont(.meta)
        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
    }

    @ViewBuilder
    private var buttons: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 12))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            Button(action: decline) {
                Text(isDeclining ? "Declining…" : "Decline")
            }
            .buttonStyle(.fr(.neutral, size: .medium, isLoading: isDeclining, fullWidth: true))
            .disabled(isBusy)
            .accessibilityLabel("Decline invitation to \(invitation.leagueName)")

            Button(action: accept) {
                Text("Accept")
            }
            .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
            .disabled(isDeclining)
            .accessibilityLabel("Accept invitation to \(invitation.leagueName)")
        }
    }

    private var sentText: String? {
        invitation.sentAt.map { "Sent \($0.formatted(.dateTime.month(.abbreviated).day()))" }
    }

    private var daysLeft: Int { invitation.daysLeft() }

    private var isExpiringSoon: Bool { daysLeft <= 2 }

    private var expiryText: String {
        switch daysLeft {
        case 0: "Expires today"
        case 1: "Expires in 1 day"
        default: "Expires in \(daysLeft) days"
        }
    }

    private var accessibilityText: String {
        var parts = ["Invitation to \(invitation.leagueName)"]
        if let sentText { parts.append(sentText) }
        parts.append(expiryText)
        return parts.joined(separator: ", ")
    }
}

#if DEBUG
#Preview("Invitation cards") {
    let now = Date()
    FRPreviewCanvas {
        SectionHeader("Invitations", detail: "2")
        PendingInvitationCard(
            invitation: PendingInvitation(
                id: "inv-1", token: "token-1", sentAt: now.addingTimeInterval(-2 * 86_400),
                expiresAt: now.addingTimeInterval(5 * 86_400), leagueID: "league-1", leagueName: "Film Twitter Refugees"
            ),
            isDeclining: false, isBusy: false, accept: {}, decline: {}
        )
        PendingInvitationCard(
            invitation: PendingInvitation(
                id: "inv-2", token: "token-2", sentAt: now.addingTimeInterval(-6 * 86_400),
                expiresAt: now.addingTimeInterval(3_600), leagueID: "league-2", leagueName: "Office Movie Club"
            ),
            isDeclining: true, isBusy: true, accept: {}, decline: {}
        )
    }
}
#endif
