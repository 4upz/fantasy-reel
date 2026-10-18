import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Every season of the series with its champions, and the titles table
/// (mockup v2 "League history", F-16). Pushed from the league `⋯` menu when
/// the series has two or more seasons.
///
/// Renders the directory's seasons of this series (`selection.seriesSeasons`,
/// limited by RLS to seasons this account was part of) and their frozen
/// `final_standings`; pull to refresh re-reads the directory. Tapping a season
/// switches the whole shell to it.
struct LeagueHistoryView: View {
    @Environment(\.leagueSelection) private var selection
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let selection, !selection.seriesSeasons.isEmpty {
                content(seasons: selection.seriesSeasons, selection: selection)
            } else if selection != nil {
                EmptyStateView(
                    title: "No seasons yet",
                    message: "Seasons of this league show up here.",
                    systemImage: "clock.arrow.circlepath"
                )
            } else {
                EmptyStateView(title: "No league selected", systemImage: "clock.arrow.circlepath")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.frBackground)
        .headerScreenTitle("History")
    }

    private func content(seasons: [League], selection: LeagueSelection) -> some View {
        let titles = SeasonHistory.titles(in: seasons)
        return ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("History", eyebrow: selection.season.name)

                SectionHeader("Seasons", detail: "\(seasons.count)")
                FRRowGroup(separatorInset: HistorySeasonRow.separatorInset) {
                    ForEach(seasons) { season in
                        Button {
                            open(season, from: selection)
                        } label: {
                            HistorySeasonRow(
                                season: season,
                                champions: SeasonHistory.champions(of: season),
                                userID: selection.userID,
                                isCurrent: season.id == selection.season.id
                            )
                        }
                        .buttonStyle(.frRow)
                    }
                }
                FRFootnote("The crown marks each champion; ties share the title. Completed seasons keep their final standings, even if a team later leaves.")

                if !titles.isEmpty {
                    SectionHeader("Titles", detail: titles.count == 1 ? "1 team" : "\(titles.count) teams")
                    FRRowGroup {
                        ForEach(titles) { title in
                            HistoryTitleRow(title: title, isYou: title.userID == selection.userID)
                        }
                    }
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .refreshable {
            await directory.refresh()
        }
    }

    /// Switches the shell to `season`. Selecting a different season resets
    /// every tab stack, which also closes this screen; the season already on
    /// screen just closes History.
    private func open(_ season: League, from selection: LeagueSelection) {
        if season.id == selection.season.id {
            dismiss()
        } else if directory.select(season.id) {
            Announcer.announce("Showing the \(season.seasonYear) season.")
        }
    }
}

// MARK: - Rows

/// One season: a year tile (crown once completed), "2025 Season" with its
/// phase badge while it runs, and its result: the champions (gold when they
/// include you), the runners-up, and your finish.
struct HistorySeasonRow: View {
    let season: League
    /// `SeasonHistory.champions(of: season)`, computed once by the caller.
    let champions: [FinalStandingRow]
    let userID: UserID
    let isCurrent: Bool

    /// 16 padding + 44 tile + 12 gap.
    static let separatorInset: CGFloat = 72

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var youHoldTheTitle: Bool {
        champions.contains { $0.userID == userID }
    }

    /// Rank-2 rows of the frozen table (several when tied for second).
    private var runnersUp: [FinalStandingRow] {
        SeasonHistory.finalTable(of: season).filter { $0.rank == 2 }
    }

    var body: some View {
        let runnersUp = runnersUp
        let lineLimit = dynamicTypeSize.isAccessibilitySize ? 4 : 1
        HStack(spacing: FRMetrics.rowGap) {
            yearTile
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(SeasonText.seasonTitle(season.seasonYear))
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                    if !season.isCompleted {
                        StatusBadge(status: season.status)
                    }
                }
                resultLine
                    .lineLimit(lineLimit)
                if !runnersUp.isEmpty {
                    Text(runnersUpText(runnersUp))
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .lineLimit(lineLimit)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            RowChevron()
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 10)
        .frame(minHeight: FRMetrics.heroRowHeight)
        .background(isCurrent ? Color.frGoldTint : Color.clear)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(runnersUp: runnersUp))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    private var yearTile: some View {
        let completed = season.isCompleted
        return Image(systemName: completed ? "crown.fill" : "film")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(completed ? Color.frGold : Color.frSuccess)
            .frame(width: 44, height: 44)
            .background(
                completed ? Color.frGoldTint : Color.frSuccessTint,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var resultLine: some View {
        if !season.isCompleted {
            Text("Ends \(season.seasonEnd.formattedShort)")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        } else if champions.isEmpty {
            Text("No champion recorded")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        } else if youHoldTheTitle {
            Text("\(SeasonText.ampersandList(champions.map(\.teamName))) · You")
                .frFont(.meta)
                .fontWeight(.semibold)
                .foregroundStyle(Color.frGold)
        } else {
            Text(championMeta)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
    }

    private var championMeta: String {
        var parts = [SeasonText.ampersandList(champions.map(\.teamName))]
        if champions.count == 1, let points = champions.first?.totalPoints {
            parts.append("\(SeasonText.total(points)) pts")
        }
        if let finish = SeasonHistory.finish(of: userID, in: season) {
            parts.append(SeasonText.yourFinish(finish))
        }
        return parts.joined(separator: " · ")
    }

    private func runnersUpText(_ rows: [FinalStandingRow]) -> String {
        let label = rows.count > 1 ? "Runners-up" : "Runner-up"
        return "\(label): \(SeasonText.ampersandList(rows.map(\.teamName)))"
    }

    private func accessibilityText(runnersUp: [FinalStandingRow]) -> String {
        var parts = [SeasonText.seasonTitle(season.seasonYear)]
        if isCurrent { parts.append("showing now") }
        guard season.isCompleted else {
            parts.append(season.status.displayName)
            parts.append("ends \(season.seasonEnd.formattedFull)")
            return parts.joined(separator: ", ")
        }
        guard !champions.isEmpty else {
            parts.append("no champion recorded")
            return parts.joined(separator: ", ")
        }
        let names = SeasonText.sentenceList(champions.map(\.teamName))
        parts.append(champions.count > 1 ? "co-champions \(names)" : "champion \(names)")
        if let points = champions.first?.totalPoints {
            parts.append(SeasonText.spokenTotal(points))
        }
        if youHoldTheTitle {
            parts.append(champions.count > 1 ? "you shared the title" : "your title")
        } else if let finish = SeasonHistory.finish(of: userID, in: season) {
            parts.append(SeasonText.yourFinish(finish))
        }
        if !runnersUp.isEmpty {
            let label = runnersUp.count > 1 ? "runners-up" : "runner-up"
            parts.append("\(label) \(SeasonText.sentenceList(runnersUp.map(\.teamName)))")
        }
        return parts.joined(separator: ", ")
    }
}

/// One person's titles: avatar initials, team, "owner · 2025, 2023, shared",
/// and the count beside a crown.
struct HistoryTitleRow: View {
    let title: SeasonHistory.Title
    let isYou: Bool

    /// "2024", "2023, shared" (the mockup); several wins read
    /// "2025, 2023 (shared)".
    static func yearsText(_ wins: [SeasonHistory.Win]) -> String {
        if wins.count == 1, let win = wins.first {
            return win.shared ? "\(win.year), shared" : "\(win.year)"
        }
        return wins
            .map { $0.shared ? "\($0.year) (shared)" : "\($0.year)" }
            .joined(separator: ", ")
    }

    private var years: String { Self.yearsText(title.wins) }

    var body: some View {
        let owner = isYou ? "\(title.displayName) (You)" : title.displayName
        ListRow(
            title: title.teamName,
            meta: "\(owner) · \(years)",
            accessibilityLabel: accessibilityText
        ) {
            Avatar(name: title.teamName, size: .medium)
        } trailing: {
            HStack(spacing: 6) {
                Image(systemName: "crown.fill")
                    .imageScale(.small)
                    .foregroundStyle(Color.frGold)
                Text(verbatim: "\(title.count)")
                    .frFont(.number)
                    .foregroundStyle(Color.frText)
            }
            .frame(minWidth: FRMetrics.trailingColumn, alignment: .trailing)
        }
    }

    private var accessibilityText: String {
        let count = title.count == 1 ? "1 title" : "\(title.count) titles"
        let owner = isYou ? "\(title.displayName), you" : title.displayName
        return "\(title.teamName), \(owner), \(count): \(years)"
    }
}

#if DEBUG
#Preview("History") {
    let seasons = SeasonPreviewData.history
    let environment = AppEnvironment.preview(leagues: InMemoryLeagueRepository(seasons: seasons))
    let selection = LeagueSelection(userID: SeasonPreviewData.alice, season: seasons[0], seriesSeasons: seasons)
    NavigationStack {
        LeagueHistoryView()
    }
    .environment(\.leagueSelection, selection)
    .environment(environment)
    .environment(LeagueDirectoryStore(userID: SeasonPreviewData.alice, repository: environment.leagues))
}
#endif
