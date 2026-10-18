import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Drop confirmation (F-11): says what a drop costs before the player commits.
/// Opened from the roster and from the league movie detail. When drop-movie
/// would refuse, the sheet explains why instead of offering the button.
struct DropMovieView: View {
    let holdingID: HoldingID

    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router
    @State private var action = AsyncAction()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let holding {
                    content(holding)
                } else {
                    EmptyStateView(
                        title: "Movie not on your roster",
                        message: "It may already have been dropped or traded.",
                        systemImage: "film"
                    )
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frSheetBackground)
        .navigationTitle("Drop Movie")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { router.dismissSheet() }
            }
        }
        .announcesError(action.errorMessage)
    }

    private var holding: TeamHolding? {
        guard let team = store.myTeam else { return nil }
        return store.holdings(of: team.id).first { $0.holdingID == holdingID }
    }

    @ViewBuilder
    private func content(_ holding: TeamHolding) -> some View {
        let preRelease = holding.isPreReleaseScore()
        FRRowGroup {
            MovieRow(
                title: holding.title,
                meta: SeasonFormat.rosterMeta(holding),
                posterURL: holding.posterURL,
                points: holding.fantasyPoints,
                preRelease: preRelease
            )
        }
        if let blocker = DropBlocker.find(holding, context: store.dropContext()) {
            let text = blocker.explanation(
                movieTitle: holding.title,
                dropLimit: store.season.dropLimit,
                leagueStatus: store.season.status,
                counterpickerName: holding.counterpickedByName
            )
            InlineBanner(tone: .neutral, title: text.headline, message: text.detail, systemImage: "lock.fill")
        } else {
            confirmation(holding, preRelease: preRelease)
        }
    }

    @ViewBuilder
    private func confirmation(_ holding: TeamHolding, preRelease: Bool) -> some View {
        let season = store.season
        let used = store.snapshot?.myDropCount ?? 0
        let remainingAfter = max(season.dropLimit - used - 1, 0)
        let slotsAfter = max(store.holdings(of: holding.teamID).count - 1, 0)

        VStack(alignment: .leading, spacing: 6) {
            Text("Drop \(holding.title)?")
                .frFont(.panelTitle)
                .foregroundStyle(Color.frText)
                .accessibilityAddTraits(.isHeader)
            Text("Dropping is permanent. Read what it costs before you confirm.")
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
        }
        .padding(.top, 8)

        FRCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Your drops")
                        .frFont(.rowLabel)
                        .foregroundStyle(Color.frText)
                    Spacer()
                    Text("\(used) of \(season.dropLimit) used")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .monospacedDigit()
                }
                if season.dropLimit <= 10 {
                    DropPips(used: used, limit: season.dropLimit)
                }
                Text(remainingAfter == 0
                    ? "This is your last drop. You will have none left for the rest of the season."
                    : "After this you will have \(remainingAfter) left for the rest of the season.")
                    .frFont(.bodySmall)
                    .foregroundStyle(remainingAfter == 0 ? Color.frWarning : Color.frTextSecondary)
            }
        }

        SectionHeader("What happens")
        FRCard {
            VStack(alignment: .leading, spacing: 10) {
                bullet("\(holding.title) leaves your roster now, freeing a slot. You will have \(slotsAfter) of \(season.totalSlots) slots filled.")
                bullet(pointsLine(holding, preRelease: preRelease))
                bullet("Everyone in the league is told it is available, and any team can bid on it.")
            }
        }

        InlineBanner(tone: .warning, title: "This takes effect immediately and cannot be undone.")

        if let message = action.errorMessage {
            InlineBanner(tone: .error, title: message)
        }

        VStack(spacing: 12) {
            Button {
                action.run {
                    try await store.drop(holding)
                    router.dismissSheet()
                }
            } label: {
                Text(action.isRunning ? "Dropping…" : "Drop Movie")
            }
            .buttonStyle(.fr(.destructive, isLoading: action.isRunning))
            .disabled(action.isRunning)
            .accessibilityLabel("Drop \(holding.title)")

            Button("Keep Movie") { router.dismissSheet() }
                .buttonStyle(.fr(.neutral))
                .disabled(action.isRunning)
        }
        .padding(.top, 4)
    }

    private func pointsLine(_ holding: TeamHolding, preRelease: Bool) -> String {
        guard let points = holding.fantasyPoints else {
            return "You give up whatever it scores when it opens, good or bad."
        }
        return "You give up its \(FantasyPoints.signed(points)) pts\(preRelease ? " at release" : "")."
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•")
                .foregroundStyle(Color.frTextMuted)
                .accessibilityHidden(true)
            Text(text)
                .frFont(.bodySmall)
                .foregroundStyle(Color.frText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// One pip per drop: filled for used, outlined for left.
struct DropPips: View {
    let used: Int
    let limit: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<max(limit, 0), id: \.self) { index in
                Capsule()
                    .fill(index < used ? Color.frGold : Color.frElevated)
                    .frame(height: 6)
            }
        }
        .accessibilityHidden(true)
    }
}
