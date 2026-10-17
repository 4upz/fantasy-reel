import SwiftUI

/// Create a league (F-05). Presented as the one sheet; push any further steps inside it.
struct CreateLeagueView: View {
    @Environment(ShellRouter.self) private var router

    var body: some View {
        FeaturePlaceholderView(title: "Create League", requirements: "F-05", systemImage: "plus.circle", showsHeader: false)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { router.dismissSheet() }
                }
            }
    }
}

/// Join with a code, a pasted link, or an email invitation token (F-05).
struct JoinLeagueView: View {
    let input: JoinInput
    @Environment(ShellRouter.self) private var router

    var body: some View {
        FeaturePlaceholderView(title: "Join League", requirements: "F-05", systemImage: "ticket", showsHeader: false)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { router.dismissSheet() }
                }
            }
    }
}

/// Owner: share the join code and link, invite by name or email (F-05).
struct ShareInviteView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Invite", requirements: "F-05", systemImage: "person.badge.plus", showsHeader: false)
    }
}

/// Pending invitations with Accept and Decline, shown in the menu sheet and on
/// the no-league screen (F-05). Renders nothing until the Leagues feature lands.
struct PendingInvitationsSection: View {
    var body: some View {
        EmptyView()
    }
}

/// The owner's invite tools for a setup season (F-05): the join code and link
/// with Share and Regenerate, Invite by name or email, and the invitation list
/// with Resend and Cancel. The draft room (setup) embeds this; it renders
/// nothing for members or once the draft has started.
struct LeagueInvitesSection: View {
    var body: some View {
        EmptyView()
    }
}
