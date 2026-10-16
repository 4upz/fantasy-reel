import SwiftUI

/// Signed in with no leagues yet: invitations, Create League, Join with Code (F-04, F-05).
struct NoLeaguesView: View {
    @Environment(ShellRouter.self) private var router

    var body: some View {
        ScrollView {
            VStack(spacing: FRMetrics.sectionSpacing) {
                PendingInvitationsSection()
                EmptyStateView(
                    title: "You're not in a league yet",
                    message: "Start one with friends, or join with the code your commissioner shared.",
                    systemImage: "film.stack"
                )
                .padding(.top, 12)
                VStack(spacing: 12) {
                    Button("Create League") { router.present(.createLeague) }
                        .buttonStyle(.frPrimary)
                    Button("Join with Code") { router.present(.joinLeague(.manual)) }
                        .buttonStyle(.frSecondary)
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
        }
        .background(Color.frBackground)
    }
}
