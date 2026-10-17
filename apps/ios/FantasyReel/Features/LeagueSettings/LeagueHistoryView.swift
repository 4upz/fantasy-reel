import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Every season of the series with its champions, and the titles table
/// (mockup v2 "League history", F-16). Pushed from the league `⋯` menu when
/// the series has two or more seasons.
///
/// Reads the series' seasons fresh (`fetchSeriesSeasons`, limited by RLS to
/// seasons this account was part of) and their frozen `final_standings`.
/// Tapping a season switches the whole shell to it.
struct LeagueHistoryView: View {
    @Environment(\.leagueSelection) private var selection
    @Environment(AppEnvironment.self) private var environment
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(\.dismiss) private var dismiss

    @State private var state: LoadState<[League]> = .idle

    var body: some View {
        Group {
            if let selection {
                LoadStateView(
                    state,
                    loadingLabel: "Loading history…",
                    emptyTitle: "No seasons yet",
                    emptyMessage: "Seasons of this league show up here.",
                    emptySystemImage: "clock.arrow.circlepath",
                    retry: { Task { await load(seriesID: selection.season.seriesID) } }
                ) { seasons in
                    content(seasons: seasons, selection: selection)
                }
                .task(id: selection.season.seriesID) {
                    await load(seriesID: selection.season.seriesID)
                }
            } else {
                EmptyStateView(title: "No league selected", systemImage: "clock.arrow.circlepath")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.frBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func load(seriesID: SeriesID) async {
        if state.value == nil { state = .loading }
        do {
            let seasons = try await environment.leagues.fetchSeriesSeasons(seriesID)
            let sorted = seasons.sorted { $0.seasonYear > $1.seasonYear }
            state = sorted.isEmpty ? .empty : .loaded(sorted)
        } catch {
            let message = APIError.wrap(error).userMessage
            // Keep showing loaded history if a refresh fails.
            if state.value == nil { state = .failed(message: message) }
        }
    }

    private func content(seasons: [League], selection: LeagueSelection) -> some View {
        let titles = SeasonHistory.titles(in: seasons)
        return ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("History", eyebrow: selection.season.name)

                SectionHeader("Seasons", detail: "\(seasons.count)")
                LazyVStack(spacing: 0) {
                    ForEach(Array(seasons.enumerated()), id: \.element.id) { index, season in
                        Button {
                            open(season, from: selection)
                        } label: {
                            HistorySeasonRow(
                                season: season,
                                userID: selection.userID,
                                isCurrent: season.id == selection.season.id
                            )
                        }
                        .buttonStyle(.frRow)
                        .overlay(alignment: .top) {
                            if index > 0 {
                                FRHairline().padding(.leading, 72)
                            }
                        }
                    }
                }
                .background(Color.frSurface)
                .clipShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
                Text("The crown marks each champion; ties share the title. Completed seasons keep their final standings, even if a team later leaves.")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)

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
            await load(seriesID: selection.season.seriesID)
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

/// One season: a year tile (crown once completed), "2025 Season", and its
/// result: the champions with your finish, or the phase while it's running.
struct HistorySeasonRow: View {
    let season: League
    let userID: UserID
    let isCurrent: Bool

    private var champions: [FinalStandingRow] { SeasonHistory.champions(of: season) }

    var body: some View {
        ListRow(
            title: SeasonText.seasonTitle(season.seasonYear),
            meta: meta,
            showsChevron: true,
            isHero: true,
            accessibilityLabel: accessibilityText
        ) {
            yearTile
        } trailing: {
            if !season.isCompleted {
                StatusBadge(status: season.status)
            }
        }
        .background(isCurrent ? Color.frGoldTint : Color.clear)
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
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var meta: String {
        guard season.isCompleted else {
            return "Ends \(season.seasonEnd.formattedShort)"
        }
        guard !champions.isEmpty else { return "No champion recorded" }
        let names = SeasonText.ampersandList(champions.map(\.teamName))
        if champions.contains(where: { $0.userID == userID }) {
            return "\(names) · You"
        }
        var parts = [names]
        if champions.count == 1, let points = champions.first?.totalPoints {
            parts.append("\(SeasonText.total(points)) pts")
        }
        if let finish = SeasonHistory.finish(of: userID, in: season) {
            parts.append(SeasonText.yourFinish(finish))
        }
        return parts.joined(separator: " · ")
    }

    private var accessibilityText: String {
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
        if champions.contains(where: { $0.userID == userID }) {
            parts.append(champions.count > 1 ? "you shared the title" : "your title")
        } else if let finish = SeasonHistory.finish(of: userID, in: season) {
            parts.append(SeasonText.yourFinish(finish))
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
