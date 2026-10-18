import FantasyReelCore
import SwiftUI

/// Roster tab (F-11, mockup V2Roster): slot, drop and counterpick capacity,
/// then drafted movies, pickups and counterpicks. Unreleased movies can be
/// dropped from a row's context menu or VoiceOver actions; the confirmation
/// sheet spells out the cost. Projected finish (F-19) slots in later.
struct RosterView: View {
    @Environment(LeagueSeasonStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader(
                    "Roster",
                    eyebrow: "\(store.season.name) · \(String(store.season.seasonYear)) Season"
                )
                LoadStateView(
                    store.state,
                    loadingLabel: "Loading your roster…",
                    retry: { Task { await store.refresh() } },
                    content: { _ in RosterContent() },
                    empty: { EmptyView() }
                )
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .refreshable { await store.refresh() }
    }
}

private struct RosterContent: View {
    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router

    var body: some View {
        if let team = store.myTeam {
            let holdings = store.holdings(of: team.id)
            let counterpicks = store.counterpicks(by: team.id)
            CapacityCard(slotsFilled: holdings.count, counterpicks: counterpicks.count)
            holdingSection(
                "Drafted",
                holdings.filter { $0.source == .draft },
                empty: "No draft picks yet."
            )
            holdingSection(
                "Pickups",
                holdings.filter { $0.source != .draft },
                empty: "No pickups yet. Win bids to add movies!"
            )
            if store.season.status == .active, store.season.dropLimit > 0 {
                Text("Released movies can't be dropped. Touch and hold an unreleased movie to drop it.")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 16)
            }
            counterpickSection(counterpicks)
            if !holdings.isEmpty || !counterpicks.isEmpty { TMDbAttribution() }
        } else {
            EmptyStateView(
                title: "No roster yet",
                message: "You'll have a roster once you're on a team in this season.",
                systemImage: "film.stack"
            )
        }
    }

    @ViewBuilder
    private func holdingSection(_ title: String, _ holdings: [TeamHolding], empty: String) -> some View {
        SectionHeader(title, detail: String(holdings.count))
        if holdings.isEmpty {
            EmptyRowsCard(message: empty)
        } else {
            let context = store.dropContext()
            FRRowGroup {
                ForEach(holdings) { holding in
                    HoldingRow(holding: holding, canDrop: DropBlocker.find(holding, context: context) == nil)
                }
            }
        }
    }

    @ViewBuilder
    private func counterpickSection(_ counterpicks: [Counterpick]) -> some View {
        let slots = store.season.draftCounterpickSlots + store.season.biddingCounterpickSlots
        if slots > 0 || !counterpicks.isEmpty {
            SectionHeader("Counterpicks", detail: "\(counterpicks.count) of \(slots)")
            if counterpicks.isEmpty {
                EmptyRowsCard(message: "No counterpicks claimed yet.")
            } else {
                FRRowGroup {
                    ForEach(counterpicks) { counterpick in
                        CounterpickRow(counterpick: counterpick, targetName: store.team(counterpick.targetTeamID)?.team.name)
                    }
                }
            }
        }
    }
}

/// "7 of 8" with "1 open" under it, drops left and counterpicks used.
private struct CapacityCard: View {
    let slotsFilled: Int
    let counterpicks: Int

    @Environment(LeagueSeasonStore.self) private var store

    var body: some View {
        let season = store.season
        let open = max(season.totalSlots - slotsFilled, 0)
        let dropsLeft = store.dropsRemaining
        let counterpickSlots = season.draftCounterpickSlots + season.biddingCounterpickSlots
        FRCard {
            StatColumns([
                StatItem(
                    "Roster",
                    value: String(slotsFilled),
                    suffix: "of \(season.totalSlots)",
                    caption: open > 0 ? "\(open) open" : "Full",
                    accessibilityLabel: "Roster, \(slotsFilled) of \(season.totalSlots) slots filled, \(open) open"
                ),
                StatItem(
                    "Drops left",
                    value: String(dropsLeft),
                    suffix: "of \(season.dropLimit)",
                    accessibilityLabel: dropsLeft == 0
                        ? "No drops left, \(season.dropLimit) of \(season.dropLimit) used"
                        : "Drops left, \(dropsLeft) of \(season.dropLimit)"
                ),
                StatItem(
                    "Counterpicks",
                    value: String(counterpicks),
                    suffix: "of \(counterpickSlots)",
                    accessibilityLabel: "Counterpicks, \(counterpicks) of \(counterpickSlots)"
                ),
            ])
        }
    }
}

/// One drafted or picked-up movie. Tapping opens the league movie detail.
private struct HoldingRow: View {
    let holding: TeamHolding
    let canDrop: Bool

    @Environment(ShellRouter.self) private var router

    var body: some View {
        Button {
            router.push(.movie(holding.tmdbID))
        } label: {
            MovieRow(
                title: holding.title,
                meta: SeasonFormat.rosterMeta(holding),
                posterURL: holding.posterURL,
                points: holding.fantasyPoints,
                preRelease: holding.isPreReleaseScore(),
                showsChevron: true
            )
        }
        .buttonStyle(.frRow)
        .contextMenu {
            if canDrop {
                Button("Drop \(holding.title)", systemImage: "minus.circle", role: .destructive) {
                    router.present(.dropMovie(holding.holdingID))
                }
            }
        }
        .accessibilityActions {
            if canDrop {
                Button("Drop") { router.present(.dropMovie(holding.holdingID)) }
            }
        }
    }
}

/// A counterpick: the counterpicker scores the target movie's points inverted.
struct CounterpickRow: View {
    let counterpick: Counterpick
    let targetName: String?

    @Environment(ShellRouter.self) private var router

    var body: some View {
        let row = MovieRow(
            title: counterpick.title,
            meta: meta,
            posterURL: counterpick.movie?.posterURL,
            points: counterpick.fantasyPoints,
            preRelease: counterpick.isPreReleaseScore(),
            showsChevron: counterpick.movie != nil
        )
        if let tmdbID = counterpick.movie?.tmdbID {
            Button { router.push(.movie(tmdbID)) } label: { row }
                .buttonStyle(.frRow)
        } else {
            row
        }
    }

    private var meta: String {
        var parts: [String] = []
        if let targetName { parts.append("On \(targetName)") }
        if let rt = counterpick.movie?.combinedScore {
            parts.append("RT \(Int(JSMath.round(rt)))%")
        } else {
            parts.append(DateOnly.display(counterpick.releaseDate, style: .short))
        }
        return parts.joined(separator: " · ")
    }
}

/// The empty body of a roster or team section.
struct EmptyRowsCard: View {
    let message: String

    var body: some View {
        FRCard {
            Text(message)
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
        }
    }
}
