import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Home for a completed season (mockup v2 "Season complete", F-16): champion
/// banner, the owner's Start Next Season card (or a link to the next season
/// once it exists), and the frozen final standings.
///
/// Everything here reads the season's `final_standings` snapshot through
/// `SeasonHistory`, never live standings: a champion who later left keeps
/// their title.
struct CompletedSeasonHomeView: View {
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        if let selection {
            CompletedSeasonContent(selection: selection)
        } else {
            LoadingView()
        }
    }
}

private struct CompletedSeasonContent: View {
    let selection: LeagueSelection

    @Environment(AppEnvironment.self) private var environment
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(ShellRouter.self) private var router

    @State private var startAction = AsyncAction()
    @State private var isConfirmingStart = false
    @State private var showsAllStandings = false
    /// Who carries over, by name, for the confirmation (nil until loaded).
    @State private var carryOverNames: [String]?
    /// Shown when the season was created but the directory hasn't caught up.
    @State private var startNotice: String?

    private static let previewRowCount = 3

    private var season: League { selection.season }
    private var nextYear: Int { season.seasonYear + 1 }
    private var champions: [FinalStandingRow] { SeasonHistory.champions(of: season) }
    private var finalTable: [FinalStandingRow] { SeasonHistory.finalTable(of: season) }

    /// The season after this one, when this account can see it.
    private var nextSeason: League? {
        selection.seriesSeasons
            .filter { $0.seasonYear > season.seasonYear }
            .min { $0.seasonYear < $1.seasonYear }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if selection.seriesSeasons.count >= 2 {
                    ScreenHeader(season.name, status: season.status) {
                        seasonSwitcher
                    }
                } else {
                    ScreenHeader(
                        season.name,
                        subtitle: SeasonText.seasonTitle(season.seasonYear),
                        status: season.status
                    )
                }
                ChampionBanner(seasonYear: season.seasonYear, champions: champions)
                    .padding(.top, 8)
                nextSeasonCard
                standingsSection
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.frBackground)
        .alert(
            "Start the \(String(nextYear)) season?",
            isPresented: $isConfirmingStart,
            actions: {
                Button("Start \(String(nextYear))") { startNextSeason() }
                Button("Cancel", role: .cancel) {}
            },
            message: { Text(confirmationMessage) }
        )
        .task(id: season.id) {
            await loadCarryOverNames()
        }
        .announcesError(startAction.errorMessage)
    }

    // MARK: - Season switcher

    /// "2025 Season ▾": every season of this league the account can see, as in
    /// the menu sheet's Seasons group. Picking one switches the whole shell.
    private var seasonSwitcher: some View {
        Menu {
            ForEach(selection.seriesSeasons) { option in
                Button {
                    if option.id != season.id { directory.select(option.id) }
                } label: {
                    if option.id == season.id {
                        Label(seasonOptionTitle(option), systemImage: "checkmark")
                    } else {
                        Text(seasonOptionTitle(option))
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(SeasonText.seasonTitle(season.seasonYear))
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .accessibilityHidden(true)
            }
            .frFont(.label)
            .foregroundStyle(Color.frGold)
            .frame(minHeight: FRMetrics.minTapTarget)
            .contentShape(Rectangle())
        }
        .padding(.vertical, -10)
        .accessibilityLabel("Season")
        .accessibilityValue(SeasonText.seasonTitle(season.seasonYear))
        .accessibilityHint("Switches to another season of this league.")
    }

    private func seasonOptionTitle(_ option: League) -> String {
        "\(SeasonText.seasonTitle(option.seasonYear)) · \(option.status.displayName)"
    }

    // MARK: - Next season

    @ViewBuilder
    private var nextSeasonCard: some View {
        if let nextSeason {
            FRCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: "The \(nextSeason.seasonYear) season is underway")
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                    Text("Same league, fresh rosters. This season's results stay here.")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                    Button(goToTitle(nextSeason)) {
                        _ = directory.select(nextSeason.id)
                    }
                    .buttonStyle(.fr(.primary, size: .medium, fullWidth: true))
                    .padding(.top, 8)
                }
            }
        } else if selection.isOwner {
            FRCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: "Ready for \(nextYear)?")
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                    Text("Members and settings carry over. Rosters start fresh.")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                    Button("Start Next Season") {
                        startAction.clearError()
                        isConfirmingStart = true
                    }
                    .buttonStyle(.fr(.primary, size: .medium, isLoading: startAction.isRunning, fullWidth: true))
                    .disabled(startAction.isRunning)
                    .padding(.top, 8)
                    // Plain inline text, not a banner: a banner is a card, and
                    // cards never nest.
                    if let message = startAction.errorMessage {
                        inlineMessage(message, tone: .error)
                    } else if let startNotice {
                        inlineMessage(startNotice, tone: .info)
                    }
                }
            }
        }
    }

    private func inlineMessage(_ text: String, tone: FRTone) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: tone.defaultSymbol)
                .foregroundStyle(tone.foreground)
                .accessibilityHidden(true)
            Text(text)
                .foregroundStyle(tone == .error ? Color.frError : Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frFont(.meta)
        .padding(.top, 8)
        .accessibilityElement(children: .combine)
    }

    private func goToTitle(_ next: League) -> String {
        "Go to \(SeasonText.seasonTitle(next.seasonYear))"
    }

    /// The web's confirmation (`ConfirmStartSeasonModal`): who comes along and
    /// what resets. It says nothing about leaving the new season; there is no
    /// way to do that in the app.
    private var confirmationMessage: String {
        let carry = "League settings carry over to \(nextYear), and everyone still in the \(season.seasonYear) "
            + "season comes along with their team name and team image."
        let reset = "Rosters start empty. People who left or were removed aren't brought back."
        let message = "\(carry) \(reset)"
        guard let names = carryOverNames, !names.isEmpty else { return message }
        let list = SeasonText.sentenceList(names)
        return "\(message)\n\nCarrying over (\(names.count)): \(list)"
    }

    /// Once per season: the names only feed the confirmation.
    private func loadCarryOverNames() async {
        guard carryOverNames == nil, selection.isOwner, nextSeason == nil else { return }
        let leagues = environment.leagues
        let seasonID = season.id
        guard let members = try? await leagues.fetchMembers(of: seasonID) else { return }
        carryOverNames = members.map(\.displayName)
    }

    private func startNextSeason() {
        let lifecycle = environment.leagueLifecycle
        let seasonID = season.id
        let year = nextYear
        startNotice = nil
        startAction.run {
            let next: NextSeason
            do {
                next = try await lifecycle.startNextSeason(after: seasonID)
            } catch {
                let apiError = APIError.wrap(error)
                // A timeout may still have created the season: re-read, so the
                // card offers "Go to" instead of a second Start if it exists.
                if apiError.isUncertainOutcome {
                    await directory.refresh()
                }
                throw apiError
            }
            await directory.refresh()
            if directory.select(next.leagueID) {
                Announcer.announce(next.wasCreated ? "\(year) season created." : "Opened the \(year) season.")
            } else {
                startNotice = "The \(year) season is ready. It will appear once your leagues refresh."
            }
        }
    }

    // MARK: - Final standings

    private func toggleAllStandings() {
        withAnimation {
            showsAllStandings.toggle()
        }
        Announcer.announce(showsAllStandings ? "Showing all teams." : "Showing the top 3.")
    }

    /// When the season was completed (the snapshot's moment), else its end date.
    private var frozenDate: String {
        if let completedAt = season.completedAt {
            return completedAt.formatted(.dateTime.month(.wide).day().year())
        }
        return season.seasonEnd.formattedFull
    }

    @ViewBuilder
    private var standingsSection: some View {
        let table = finalTable
        if table.isEmpty {
            SectionHeader("Final standings")
            FRCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text("No final standings saved")
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                    Text("This season finished before final standings were recorded, so they aren't available.")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        } else {
            if table.count > Self.previewRowCount {
                SectionHeader(
                    "Final standings",
                    actionTitle: showsAllStandings ? "Show Top 3" : "See all \(table.count)"
                ) {
                    toggleAllStandings()
                }
            } else {
                SectionHeader("Final standings")
            }
            let rows = showsAllStandings ? table : Array(table.prefix(Self.previewRowCount))
            FRRowGroup(separatorInset: 108) {
                ForEach(rows) { row in
                    Button {
                        router.push(.team(row.teamID))
                    } label: {
                        FinalStandingListRow(row: row, isYou: row.userID == selection.userID)
                    }
                    .buttonStyle(.frRow)
                }
            }
        }
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "lock.fill")
                .imageScale(.small)
                .accessibilityHidden(true)
            Text(verbatim: "Final standings are frozen as of \(frozenDate).")
                .fixedSize(horizontal: false, vertical: true)
        }
        .frFont(.meta)
        .foregroundStyle(Color.frTextSecondary)
        .padding(.horizontal, 4)
    }
}

// MARK: - Champion banner

/// The `.card` on `--goldbg` at the top of a completed season: crown, "2025
/// Champion" (or "Co-champions" when tied), team, owner and final points.
struct ChampionBanner: View {
    let seasonYear: Int
    let champions: [FinalStandingRow]

    private var isShared: Bool { champions.count > 1 }

    private var eyebrow: String {
        "\(seasonYear) \(isShared ? "Co-champions" : "Champion")"
    }

    private var teamNames: String {
        SeasonText.sentenceList(champions.map(\.teamName))
    }

    private var ownerNames: String {
        SeasonText.sentenceList(champions.map(SeasonText.ownerName))
    }

    /// Co-champions are tied, so there is one figure.
    private var points: Double? { champions.first?.totalPoints }

    var body: some View {
        FRCard(tone: .gold) {
            VStack(spacing: 0) {
                Image(systemName: "crown.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.frOnGold)
                    .frame(width: 40, height: 40)
                    .background(Color.frGold, in: Circle())
                    .accessibilityHidden(true)
                Text(eyebrow)
                    .frFont(.overline)
                    .foregroundStyle(Color.frGold)
                    .padding(.top, 10)
                Text(champions.isEmpty ? "No champion recorded" : teamNames)
                    .frFont(.panelTitle)
                    .foregroundStyle(Color.frText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                if !champions.isEmpty {
                    ownerLine
                        .padding(.top, 4)
                }
                if isShared, let points {
                    Text(verbatim: "Tied on \(SeasonText.total(points)) pts. \(champions.count == 2 ? "Both" : "All") hold the title.")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var ownerLine: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { ownerLineContent }
            VStack(spacing: 4) { ownerLineContent }
        }
    }

    @ViewBuilder
    private var ownerLineContent: some View {
        if champions.count == 1, let champion = champions.first {
            Avatar(name: champion.teamName, size: .small)
        }
        Text(ownerNames)
            .frFont(.label)
            .foregroundStyle(Color.frTextSecondary)
        if let points {
            Text(verbatim: "\(SeasonText.total(points)) pts")
                .frFont(.number)
                .foregroundStyle(Color.frGold)
        }
    }

    private var accessibilityText: String {
        guard !champions.isEmpty else { return "\(seasonYear) season. No champion recorded." }
        var text = "\(eyebrow): \(teamNames), \(ownerNames)"
        if let points { text += ", \(SeasonText.spokenTotal(points))" }
        if isShared { text += ". Tied, so they share the title." }
        return text
    }
}

// MARK: - Standings row

/// One frozen final-standings row: rank (gold/silver/bronze for the podium,
/// "T-2" when tied), team avatar, team over owner ("· You" on your own row)
/// and the whole-number total.
struct FinalStandingListRow: View {
    let row: FinalStandingRow
    let isYou: Bool

    /// Wide enough for "T-12" at the current text size.
    @ScaledMetric(relativeTo: .body) private var rankWidth: CGFloat = 36

    var body: some View {
        let owner = SeasonText.ownerName(row)
        ListRow(
            title: row.teamName,
            meta: isYou ? "\(owner) · You" : owner,
            showsChevron: true,
            accessibilityLabel: accessibilityText(owner: owner)
        ) {
            HStack(spacing: FRMetrics.rowGap) {
                Text(SeasonText.rankLabel(row))
                    .frFont(.number)
                    .foregroundStyle(rankColor)
                    .lineLimit(1)
                    .frame(width: rankWidth, alignment: .leading)
                Avatar(name: row.teamName, size: .medium)
            }
        } trailing: {
            TrailingValue(SeasonText.total(row.totalPoints))
        }
        .background(isYou ? Color.frGoldTint : Color.clear)
    }

    private var rankColor: Color {
        switch row.rank {
        case 1: .frGold
        case 2: .frSilver
        case 3: .frBronze
        default: .frTextSecondary
        }
    }

    private func accessibilityText(owner: String) -> String {
        var parts = [SeasonText.spokenRank(row), row.teamName, owner]
        if isYou { parts.append("your team") }
        parts.append(SeasonText.spokenTotal(row.totalPoints))
        return parts.joined(separator: ", ")
    }
}

#if DEBUG
extension SeasonPreviewData {
    @MainActor
    static func completedHome(isOwner: Bool, withNextSeason: Bool = false, tied: Bool = false) -> some View {
        let season = completedSeason(year: 2025, tied: tied)
        var seasons = [season]
        if withNextSeason { seasons.insert(activeSeason(year: 2026), at: 0) }
        let selection = LeagueSelection(
            userID: isOwner ? season.ownerID : alice,
            season: season,
            seriesSeasons: seasons
        )
        let environment = AppEnvironment.preview(leagues: InMemoryLeagueRepository(seasons: seasons))
        let directory = LeagueDirectoryStore(userID: selection.userID, repository: environment.leagues)
        return NavigationStack {
            CompletedSeasonHomeView()
        }
        .environment(\.leagueSelection, selection)
        .environment(environment)
        .environment(directory)
        .environment(ShellRouter())
    }
}

#Preview("Completed · owner") {
    SeasonPreviewData.completedHome(isOwner: true)
}

#Preview("Completed · tied, next season") {
    SeasonPreviewData.completedHome(isOwner: false, withNextSeason: true, tied: true)
}
#endif
