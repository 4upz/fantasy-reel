import FantasyReelCore
import SwiftUI

/// Standings tab (F-14, mockup V2Standings): the league summary strip, then
/// every team ranked with ties shared ("T-3"), your row marked, last season's
/// champion crowned. A completed season shows its frozen final table. The
/// projected view (F-19) slots in later.
struct StandingsView: View {
    @Environment(LeagueSeasonStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader(
                    "Standings",
                    eyebrow: "\(store.season.name) · \(String(store.season.seasonYear)) Season"
                )
                LoadStateView(
                    store.state,
                    loadingLabel: "Loading standings…",
                    retry: { Task { await store.refresh() } },
                    content: { snapshot in StandingsContent(snapshot: snapshot) },
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

private struct StandingsContent: View {
    let snapshot: LeagueSeasonStore.Snapshot

    @Environment(LeagueSeasonStore.self) private var store

    var body: some View {
        let season = store.season
        let summary = StandingsSummary.make(holdings: snapshot.holdings, counterpicks: snapshot.counterpicks)
        let rows = store.standings

        if season.isCompleted {
            ChampionCard(champions: store.champions, seasonYear: season.seasonYear)
        }
        Text(summaryLine(summary, completed: season.isCompleted))
            .frFont(.meta)
            .foregroundStyle(Color.frTextSecondary)
            .padding(.horizontal, 4)
            .accessibilityLabel("\(summary.movies) movies, \(summary.scored) scored, \(summary.pending) pending")

        if summary.scored == 0, !season.isCompleted, !rows.isEmpty {
            InlineBanner(
                tone: .info,
                title: "No points counted yet",
                message: "Scores update nightly, and a movie's points count once it releases. Check back after movies in your draft have been released!"
            )
        }

        if rows.isEmpty {
            EmptyStateView(
                title: "No teams yet",
                message: "Teams will appear here once the draft begins.",
                systemImage: "trophy"
            )
        } else {
            FRRowGroup(separatorInset: 108) {
                ForEach(rows) { row in
                    StandingRowView(row: row)
                }
            }
            Text("Points count from each movie's release day. Tied teams share a rank.")
                .frFont(.caption)
                .foregroundStyle(Color.frTextSecondary)
                .padding(.horizontal, 16)
        }
    }

    private func summaryLine(_ summary: StandingsSummary, completed: Bool) -> String {
        let counts = "\(summary.movies) movies · \(summary.scored) scored · \(summary.pending) pending"
        return completed ? "Final · \(String(store.season.seasonYear)) season · \(counts)" : counts
    }
}

/// One ranked team: rank, avatar, name, owner (or crown), points.
private struct StandingRowView: View {
    let row: FinalStandingRow

    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router

    var body: some View {
        let team = store.team(row.teamID)
        let isMe = row.userID == store.userID
        let crown = store.crownYear(for: row.teamID, userID: row.userID)
        let owner = team?.ownerDisplayName ?? row.displayName ?? "Former member"
        let rankLabel = CompetitionRank.label(rank: row.rank, isTied: row.isTied)

        Button {
            router.push(.team(row.teamID))
        } label: {
            ListRow(
                title: team?.team.name ?? row.teamName,
                meta: crown.map { "\(String($0)) champion" } ?? owner,
                showsChevron: true,
                accessibilityLabel: accessibilityLabel(team: team, owner: owner, isMe: isMe, crown: crown)
            ) {
                HStack(spacing: FRMetrics.rowGap) {
                    Text(rankLabel)
                        .frFont(.number)
                        .foregroundStyle(rankColor)
                        .frame(minWidth: 32, alignment: .leading)
                        .fixedSize()
                    Avatar(name: team?.team.name ?? row.teamName, imageURL: team?.team.avatarURL, size: .medium, corners: .rounded)
                        .overlay(alignment: .topTrailing) {
                            if crown != nil {
                                Image(systemName: "crown.fill")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Color.frGold)
                                    .offset(x: 4, y: -6)
                                    .accessibilityHidden(true)
                            }
                        }
                }
            } trailing: {
                HStack(spacing: 8) {
                    if isMe { FRBadge("You", tone: .gold) }
                    TrailingValue(FantasyPoints.whole(row.totalPoints), tone: row.totalPoints < 0 ? .negative : .neutral)
                }
            }
            .background(isMe ? Color.frGoldTint : Color.clear)
        }
        .buttonStyle(.frRow)
    }

    private var rankColor: Color {
        switch row.rank {
        case 1: .frGold
        case 2: .frSilver
        case 3: .frBronze
        default: .frTextSecondary
        }
    }

    private func accessibilityLabel(team: SeasonTeam?, owner: String, isMe: Bool, crown: Int?) -> String {
        var parts = [
            CompetitionRank.spokenLabel(rank: row.rank, isTied: row.isTied),
            team?.team.name ?? row.teamName,
            owner,
        ]
        if isMe { parts.append("your team") }
        if let crown { parts.append("\(String(crown)) champion") }
        parts.append("\(FantasyPoints.whole(row.totalPoints)) points")
        return parts.joined(separator: ", ")
    }
}

/// The completed season's champion (co-champions when tied).
private struct ChampionCard: View {
    let champions: [Champion]
    let seasonYear: Int

    var body: some View {
        if !champions.isEmpty {
            FRCard(tone: .gold) {
                HStack(spacing: 12) {
                    Image(systemName: "crown.fill")
                        .font(.title2)
                        .foregroundStyle(Color.frGold)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(champions.count > 1 ? "\(String(seasonYear)) co-champions" : "\(String(seasonYear)) champion")
                            .frFont(.overline)
                            .foregroundStyle(Color.frTextSecondary)
                        Text(SeasonResults.joinNames(champions.map(\.displayName)))
                            .frFont(.cardTitle)
                            .foregroundStyle(Color.frText)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// One team's movies, pickups and counterpicks (F-14, mockup V2TeamDetail).
struct TeamDetailView: View {
    let teamID: TeamID

    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if let team = store.team(teamID) {
                    content(team)
                } else if store.snapshot == nil {
                    LoadStateView(
                        store.state,
                        loadingLabel: "Loading team…",
                        retry: { Task { await store.refresh() } },
                        content: { _ in EmptyView() },
                        empty: { EmptyView() }
                    )
                } else {
                    EmptyStateView(title: "Team not found", message: "This team is no longer in the season.", systemImage: "person.2")
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .navigationTitle(store.team(teamID)?.team.name ?? "Team")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store.refresh() }
    }

    @ViewBuilder
    private func content(_ team: SeasonTeam) -> some View {
        let holdings = store.holdings(of: team.id)
        let drafted = holdings.filter { $0.source == .draft }
        let pickups = holdings.filter { $0.source != .draft }
        let counterpicks = store.counterpicks(by: team.id)

        header(team)
        if holdings.isEmpty, counterpicks.isEmpty {
            EmptyRowsCard(message: "No movies drafted yet")
        } else {
            if !drafted.isEmpty {
                SectionHeader("Drafted", detail: String(drafted.count))
                rows(drafted)
            }
            if !pickups.isEmpty {
                SectionHeader("Pickups", detail: String(pickups.count))
                rows(pickups)
            }
            if !counterpicks.isEmpty {
                SectionHeader("Counterpicks", detail: String(counterpicks.count))
                FRRowGroup {
                    ForEach(counterpicks) { counterpick in
                        CounterpickRow(counterpick: counterpick, targetName: store.team(counterpick.targetTeamID)?.team.name)
                    }
                }
                Text("A counterpick scores the movie's points inverted.")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 16)
            }
            TMDbAttribution()
        }
    }

    private func rows(_ holdings: [TeamHolding]) -> some View {
        FRRowGroup {
            ForEach(holdings) { holding in
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
            }
        }
    }

    private func header(_ team: SeasonTeam) -> some View {
        let isMe = team.userID == store.userID
        return FRCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Avatar(name: team.team.name, imageURL: team.team.avatarURL, size: .large, corners: .rounded)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(team.team.name)
                            .frFont(.cardTitle)
                            .foregroundStyle(Color.frText)
                            .lineLimit(2)
                            .accessibilityAddTraits(.isHeader)
                        Text("\(team.ownerDisplayName)\(isMe ? " · You" : "") · \(String(store.season.seasonYear)) Season")
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                FRHairline()
                StatColumns(stats(team))
                if store.canProposeTrade(to: team.id) {
                    Button("Propose Trade") { router.present(.proposeTrade(team.id)) }
                        .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
                }
            }
        }
    }

    private func stats(_ team: SeasonTeam) -> [StatItem] {
        var items: [StatItem] = []
        if let standing = store.standing(of: team.id) {
            items.append(StatItem(
                "Rank",
                value: CompetitionRank.label(rank: standing.rank, isTied: standing.isTied),
                suffix: "of \(store.teamCount)",
                accessibilityLabel: "\(CompetitionRank.spokenLabel(rank: standing.rank, isTied: standing.isTied)) of \(store.teamCount)"
            ))
        }
        let points = store.standing(of: team.id)?.totalPoints ?? team.totalPoints
        items.append(StatItem("Points", value: FantasyPoints.whole(points), accessibilityLabel: "Points, \(FantasyPoints.whole(points))"))
        if store.showsBudget {
            let remaining = team.remainingBudget(startingBudget: store.season.faabBudget)
            items.append(StatItem(
                "Budget",
                value: SeasonFormat.budget(remaining),
                suffix: "\(SeasonFormat.budget(team.budget?.totalSpent ?? 0)) spent",
                accessibilityLabel: "Fantasy Budget, \(remaining) dollars left, \(team.budget?.totalSpent ?? 0) spent"
            ))
        }
        return items
    }
}
