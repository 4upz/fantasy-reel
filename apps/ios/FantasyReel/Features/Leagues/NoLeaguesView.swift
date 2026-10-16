import SwiftUI

/// Signed in with no leagues yet (V2NoLeagues): the "Leagues" header,
/// invitations, Create League, Join with Code (F-04, F-05), and a link to how
/// scoring works.
struct NoLeaguesView: View {
    @Environment(ShellRouter.self) private var router

    var body: some View {
        ScrollView {
            VStack(spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Leagues")
                PendingInvitationsSection()
                EmptyStateView(
                    title: "You're not in a league yet",
                    message: "Start one with friends, or join with the code your commissioner shared.",
                    systemImage: "film.stack"
                ) {
                    Button("Create League") { router.present(.createLeague) }
                        .buttonStyle(.frPrimary)
                    Button("Join with Code") { router.present(.joinLeague(.manual)) }
                        .buttonStyle(.frSecondary)
                }
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    // How to Play lives in the menu sheet's stack, not in
                    // LeagueRoute, so open the menu there.
                    Button {
                        router.presentMenu(.howToPlay)
                    } label: {
                        HowScoringWorksRow()
                    }
                    .buttonStyle(.frRow)
                }
                .padding(.top, 12)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
    }
}

private struct HowScoringWorksRow: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.frGold)
                .frame(width: 32, height: 32)
                .background(Color.frGoldTint, in: Circle())
                .accessibilityHidden(true)
            Text("How scoring works")
                .frFont(.rowLabel)
                .foregroundStyle(Color.frText)
                .frame(maxWidth: .infinity, alignment: .leading)
            RowChevron()
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 8)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
