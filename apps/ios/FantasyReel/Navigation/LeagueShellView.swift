import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// A league season's tab bar (mockup v2): Home, Draft, Roster before the season;
/// Home, Roster, Bids, Trades, Standings during it; Home, Roster, Standings once
/// it's over. Movie search is the round button beside the bar.
struct LeagueShellView: View {
    let selection: LeagueSelection

    @Environment(AppEnvironment.self) private var environment
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory

    var body: some View {
        LeagueSeasonScope(selection: selection, environment: environment) {
            tabs
        }
        .environment(\.leagueSelection, selection)
        .onAppear(perform: normalizeSelectedTab)
        .onChange(of: selection.tabs) { normalizeSelectedTab() }
        .task(id: selection.season.id) {
            await watchSeasonRow()
        }
    }

    private var tabs: some View {
        LeagueTabs(tabs: selection.tabs)
    }

    /// Keeps the selection on a tab that exists in this phase.
    private func normalizeSelectedTab() {
        if case .league(let tab) = router.selectedTab, !selection.tabs.contains(tab) {
            router.select(selection.defaultTab)
        }
    }

    /// Re-reads the directory when this season's row changes (draft starts,
    /// season completes, renamed), so tabs and headers follow the phase (N-05).
    private func watchSeasonRow() async {
        var isFirstSignal = true
        let watch = ChangeFeedWatch.season(selection.season.id)
        for await _ in environment.changeFeed.signals(topic: "league-shell", watching: [watch]) {
            // The first signal only confirms the subscription; the directory
            // was just loaded, so skip the duplicate read.
            if isFirstSignal {
                isFirstSignal = false
                continue
            }
            await directory.refresh()
        }
    }
}

/// The tab bar itself. Reads the season store for the badges: outbid offers
/// on Bids, offers waiting on you on Trades.
private struct LeagueTabs: View {
    let tabs: [LeagueTab]

    @Environment(ShellRouter.self) private var router
    @Environment(LeagueSeasonStore.self) private var store

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            ForEach(tabs, id: \.self) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: ShellTab.league(tab)) {
                    LeagueTabStack(tab: tab)
                }
                .badge(badge(for: tab))
            }
            Tab(value: ShellTab.search, role: .search) {
                NavigationStack(path: $router.searchPath) {
                    MovieSearchView(isSearchTabRoot: true)
                        .navigationDestination(for: LeagueRoute.self) { route in
                            LeagueDestinationView(route: route)
                        }
                }
            }
        }
    }

    private func badge(for tab: LeagueTab) -> Int {
        switch tab {
        case .bids: store.bids.outbidCount
        default: 0
        }
    }
}

/// One tab's navigation stack: its root screen, the shared top bar, and every
/// screen that can be pushed from a league.
struct LeagueTabStack: View {
    let tab: LeagueTab
    @Environment(ShellRouter.self) private var router

    var body: some View {
        NavigationStack(path: router.path(for: tab)) {
            root
                .leagueTopBar()
                .navigationDestination(for: LeagueRoute.self) { route in
                    LeagueDestinationView(route: route)
                }
        }
    }

    @ViewBuilder
    private var root: some View {
        switch tab {
        case .home: LeagueHomeView()
        case .draft: DraftView()
        case .roster: RosterView()
        case .bids: BidsView()
        case .trades: TradesView()
        case .standings: StandingsView()
        }
    }
}

/// Maps a pushed route to its screen. Feature threads add cases here.
struct LeagueDestinationView: View {
    let route: LeagueRoute

    var body: some View {
        switch route {
        case .rules: LeagueRulesView()
        case .draftResults: DraftResultsView()
        case .history: LeagueHistoryView()
        case .settings: LeagueSettingsView()
        case .shareInvite: ShareInviteView()
        case .movie(let tmdbID): LeagueMovieDetailView(tmdbID: tmdbID)
        case .team(let teamID): TeamDetailView(teamID: teamID)
        case .bidPriorities: BidPrioritiesView()
        case .movieSearch: MovieSearchView()
        }
    }
}

/// The ChangeFeed subscriptions the shell itself uses.
enum ChangeFeedWatch {
    static func season(_ id: LeagueID) -> ChangeFeed.Watch {
        ChangeFeed.Watch(table: "leagues", filter: .equals("id", id.rawValue))
    }
}
