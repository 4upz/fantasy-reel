import FantasyReelCore
import SwiftUI

/// League Home tab: team header, my movies, around the league, phase cards (F-10).
///
/// A completed season shows `CompletedSeasonHomeView` instead (F-16, owned by
/// the league lifecycle work in `Features/LeagueSettings`); F-10 owns the rest.
struct LeagueHomeView: View {
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        if selection?.season.isCompleted == true {
            CompletedSeasonHomeView()
        } else {
            SeasonOverviewView()
        }
    }
}

/// The overview of a season in setup, drafting or play (mockup V2Home).
struct SeasonOverviewView: View {
    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader(
                    store.season.name,
                    subtitle: "\(String(store.season.seasonYear)) Season",
                    status: store.season.status
                )
                LoadStateView(
                    store.state,
                    loadingLabel: "Loading your league…",
                    retry: { Task { await store.refresh() } },
                    content: { snapshot in OverviewContent(snapshot: snapshot) },
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

private struct OverviewContent: View {
    let snapshot: LeagueSeasonStore.Snapshot

    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        if let team = store.myTeam {
            if store.season.status == .setup, let previous = store.previousCompletedSeason {
                SeasonWelcomeCard(season: store.season, teamName: team.team.name, previousSeason: previous)
            }
            TeamCard(team: team)
            OverviewBanners()
            sharedWishlistBanner
            myMovies(team)
            AroundTheLeague(releases: LeagueOverview.upcomingReleases(
                holdings: snapshot.holdings, teams: snapshot.teams, myTeamID: team.id
            ))
            if !snapshot.holdings.isEmpty { TMDbAttribution() }
        } else {
            FRCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Welcome to \(store.season.name)")
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                    Text(store.season.status == .setup
                        ? "Waiting for the draft to begin..."
                        : "Your team will appear here once you join the draft.")
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
        }
    }

    @ViewBuilder
    private var sharedWishlistBanner: some View {
        let count = LeagueOverview.sharedWishlistCount(teams: snapshot.teams, me: store.userID)
        if count > 0 {
            InlineBanner(
                tone: .info,
                title: count == 1 ? "1 league-mate has shared their wishlist" : "\(count) league-mates have shared their wishlists",
                systemImage: "heart.fill",
                actionTitle: "View"
            ) {
                router.presentMenu(.wishlist)
            }
        }
    }

    @ViewBuilder
    private func myMovies(_ team: SeasonTeam) -> some View {
        let movies = LeagueOverview.timeline(store.holdings(of: team.id))
        SectionHeader("My movies", actionTitle: movies.isEmpty ? nil : "See roster") {
            router.select(.roster)
        }
        if movies.isEmpty {
            FRCard {
                Text(emptyMoviesMessage)
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
            }
        } else {
            FRRowGroup {
                ForEach(movies) { holding in
                    Button {
                        router.push(.movie(holding.tmdbID))
                    } label: {
                        MovieRow(
                            title: holding.title,
                            meta: SeasonFormat.releaseMeta(
                                holding.releaseDate, rt: holding.combinedScore,
                                suffix: holding.source == .pickup ? "Pickup" : nil
                            ),
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
    }

    private var emptyMoviesMessage: String {
        switch store.season.status {
        case .setup: "Your movies will appear here after the draft"
        case .drafting: "Draft your first movie to see it here"
        default: "No movies on your roster yet"
        }
    }
}

/// The team card (V2Home "Your team"): avatar, name, owner, edit, then rank,
/// counted points and budget.
private struct TeamCard: View {
    let team: SeasonTeam

    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        FRCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Avatar(name: team.team.name, imageURL: team.team.avatarURL, size: .large, corners: .rounded)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(team.team.name)
                            .frFont(.cardTitle)
                            .foregroundStyle(Color.frText)
                            .lineLimit(2)
                            .accessibilityAddTraits(.isHeader)
                        Text("\(team.ownerDisplayName) · Your team")
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if !store.season.isCompleted {
                        Button {
                            router.present(.editTeam)
                        } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 17, weight: .medium))
                                .foregroundStyle(Color.frText)
                                .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                                .background(Color.frElevated, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Edit team name and image")
                    }
                }
                FRHairline()
                StatColumns(stats)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your team")
    }

    private var stats: [StatItem] {
        var items: [StatItem] = []
        if let standing = store.standing(of: team.id), store.season.status == .active {
            let count = store.teamCount
            let rankText = CompetitionRank.label(rank: standing.rank, isTied: standing.isTied)
            let canOpen = selection?.tabs.contains(.standings) == true
            items.append(StatItem(
                "Rank",
                value: rankText,
                suffix: "of \(count)",
                accessibilityLabel: "\(CompetitionRank.spokenLabel(rank: standing.rank, isTied: standing.isTied)) of \(count)\(canOpen ? ", open standings" : "")",
                action: canOpen ? { router.select(.standings) } : nil
            ))
        }
        items.append(StatItem(
            "Points",
            value: FantasyPoints.whole(team.totalPoints),
            accessibilityLabel: "Points, \(FantasyPoints.whole(team.totalPoints))"
        ))
        if store.showsBudget, let budget = team.budget {
            items.append(StatItem(
                "Budget",
                value: SeasonFormat.budget(budget.remainingBudget),
                accessibilityLabel: "Fantasy Budget, \(budget.remainingBudget) dollars"
            ))
        } else {
            items.append(StatItem("Movies", value: String(store.holdings(of: team.id).count)))
        }
        return items
    }
}

/// "The 2027 season is open" (carried over from a completed season), dismissed
/// per league and remembered on this device.
private struct SeasonWelcomeCard: View {
    let season: League
    let teamName: String
    let previousSeason: League

    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory
    @State private var isDismissed: Bool

    init(season: League, teamName: String, previousSeason: League) {
        self.season = season
        self.teamName = teamName
        self.previousSeason = previousSeason
        _isDismissed = State(initialValue: UserDefaults.standard.bool(forKey: Self.key(season.id)))
    }

    static func key(_ id: LeagueID) -> String { "fr.seasonWelcomeDismissed.\(id.rawValue)" }

    var body: some View {
        if !isDismissed {
            FRCard(tone: .gold) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
                        Text("The \(String(season.seasonYear)) season is open")
                            .frFont(.cardTitle)
                            .foregroundStyle(Color.frText)
                            .accessibilityAddTraits(.isHeader)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            UserDefaults.standard.set(true, forKey: Self.key(season.id))
                            isDismissed = true
                        } label: {
                            Image(systemName: "xmark")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.frTextSecondary)
                                .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, -12)
                        .padding(.trailing, -12)
                        .accessibilityLabel("Dismiss season welcome")
                    }
                    Text("Your team, \(teamName), carried over. Rosters start empty for the new draft.")
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                    Button("See the \(String(previousSeason.seasonYear)) final standings") {
                        if directory.select(previousSeason.id) {
                            router.showSeason(previousSeason.id, defaultTab: .home)
                            router.select(.standings)
                        }
                    }
                    .frFont(.label)
                    .foregroundStyle(Color.frGold)
                    .frame(minHeight: FRMetrics.minTapTarget)
                }
            }
        }
    }
}

/// "Around the league": every upcoming release on any roster, by date, with who
/// holds it. Collapsed to 8 rows.
private struct AroundTheLeague: View {
    let releases: [LeagueRelease]

    @Environment(ShellRouter.self) private var router
    @State private var showsAll = false

    private static let collapsedCount = 8

    var body: some View {
        if !releases.isEmpty {
            SectionHeader("Around the league", detail: String(releases.count))
            FRRowGroup {
                ForEach(visible) { release in
                    Button {
                        router.push(.movie(release.tmdbID))
                    } label: {
                        MovieRow(
                            title: release.title,
                            meta: "\(dayLabel(release.releaseDate)) · \(release.holderLine)",
                            posterURL: release.posterURL,
                            showsChevron: true
                        ) {
                            if release.isMine {
                                FRBadge("Yours", tone: .gold)
                            }
                        }
                    }
                    .buttonStyle(.frRow)
                }
                if releases.count > Self.collapsedCount {
                    Button {
                        withAnimation { showsAll.toggle() }
                    } label: {
                        Text(showsAll ? "Show less" : "Show all \(releases.count) releases")
                            .frFont(.label)
                            .foregroundStyle(Color.frGold)
                            .frame(maxWidth: .infinity, minHeight: FRMetrics.minTapTarget)
                    }
                    .buttonStyle(.frRow)
                }
            }
        }
    }

    private var visible: [LeagueRelease] {
        showsAll ? releases : Array(releases.prefix(Self.collapsedCount))
    }

    private func dayLabel(_ date: DateOnly) -> String {
        switch DateOnly.today().days(until: date) {
        case ...0: "Today"
        case 1: "Tomorrow"
        default: date.formattedShort
        }
    }
}

/// Alert cards from other features (bids awaiting you) slot in here.
private struct OverviewBanners: View {
    var body: some View {
        EmptyView()
    }
}
