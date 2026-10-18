import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation
import SwiftUI

/// One season's teams, rosters and scores, shared by every league tab (F-10,
/// F-11, F-14) so Home, Roster, Standings and team detail never disagree, and a
/// team edit or drop shows everywhere at once.
///
/// `LeagueShellView` owns it and rebuilds it per season. Realtime on the roster
/// tables and the foreground refresh keep it current; mutations reload it.
@Observable
@MainActor
final class LeagueSeasonStore {
    struct Snapshot: Equatable {
        var teams: [SeasonTeam]
        var holdings: [TeamHolding]
        var counterpicks: [Counterpick]
        /// Live `league_standings` rows; empty when the season has a frozen table.
        var liveStandings: [StandingRow]
        var myDropCount: Int
        var contestedMovieIDs: Set<MovieID>
        /// Last season's champions, crowned in standings.
        var reigningChampions: ReigningChampions?
    }

    struct ReigningChampions: Equatable {
        let seasonYear: Int
        let userIDs: Set<UserID>
    }

    private(set) var state: LoadState<Snapshot> = .idle {
        didSet { snapshotGeneration &+= 1 }
    }
    /// Bumps whenever `state` is set, so derived tables re-derive only then.
    /// Observed: a cache hit reads only this, and views fed only by a derived
    /// table must still re-render when the snapshot changes.
    private var snapshotGeneration = 0
    private(set) var season: League
    let userID: UserID
    private var seriesSeasons: [League]
    private let repository: any TeamRepository
    private let refresher = RefreshCoalescer()
    /// Open bids and the bidding week (F-12), loaded while the season is active.
    let bids: BidsStore
    /// Trade offers (F-13), loaded while the season is active.
    let trades: TradesStore
    /// Projected scores (Beta, F-19); silent unless the server turns them on.
    let projections: ProjectionStore
    /// Whether Standings shows the projected table, kept across tab switches.
    var showsProjectedStandings = false
    @ObservationIgnored private var projectedCache: (key: ProjectedKey, value: [ProjectedStandings.Standing]?)?

    init(
        selection: LeagueSelection,
        repository: any TeamRepository,
        bidRepository: any BidRepository,
        tradeRepository: any TradeRepository,
        movieRepository: any MovieRepository
    ) {
        self.season = selection.season
        self.userID = selection.userID
        self.seriesSeasons = selection.seriesSeasons
        self.repository = repository
        self.bids = BidsStore(leagueID: selection.season.id, repository: bidRepository)
        self.trades = TradesStore(leagueID: selection.season.id, repository: tradeRepository)
        self.projections = ProjectionStore(
            leagueID: selection.season.id, seasonIsLive: !selection.season.isCompleted, repository: movieRepository
        )
    }

    var snapshot: Snapshot? { state.value }

    /// The selection this store was last given.
    var selection: LeagueSelection {
        LeagueSelection(userID: userID, season: season, seriesSeasons: seriesSeasons)
    }

    /// The directory re-read this season's row (a phase change, completion,
    /// a rename): adopt it and reload what depends on it.
    func update(selection: LeagueSelection) async {
        guard selection.season != season || selection.seriesSeasons != seriesSeasons else { return }
        season = selection.season
        seriesSeasons = selection.seriesSeasons
        if season.isCompleted { projections.seasonEnded() }
        await refresh()
    }

    // MARK: Loading

    func load() async {
        if case .loaded = state { return }
        state = .loading
        await refresh()
    }

    /// Re-reads everything. A failed background refresh keeps what's on screen.
    func refresh() async {
        await refresher.run { [weak self] in await self?.performRefresh() }
    }

    private func performRefresh() async {
        let repository = repository
        let leagueID = season.id
        let includeFormer = season.isCompleted
        let needsLiveStandings = season.finalStandings == nil
        let previousChampionSeason = previousCompletedSeason
        do {
            async let teams = repository.fetchTeams(in: leagueID, includeFormer: includeFormer)
            async let holdings = repository.fetchHoldings(in: leagueID)
            async let counterpicks = repository.fetchCounterpicks(in: leagueID)
            async let contested = repository.fetchContestedMovieIDs(in: leagueID)
            async let standings: [StandingRow] = needsLiveStandings ? repository.fetchStandings(in: leagueID) : []
            let loadedTeams = try await teams
            let myTeamID = loadedTeams.first { $0.userID == userID && $0.participantStatus == .active }?.id
                ?? loadedTeams.first { $0.userID == userID }?.id
            var dropCount = 0
            if let myTeamID { dropCount = try await repository.fetchDropCount(for: myTeamID) }
            var reigning: ReigningChampions?
            if let previous = previousChampionSeason, let winners = previous.winnerTeamIDs, !winners.isEmpty {
                let owners = (try? await repository.fetchOwners(of: winners)) ?? [:]
                reigning = ReigningChampions(seasonYear: previous.seasonYear, userIDs: Set(owners.values))
            }
            let snapshot = Snapshot(
                teams: loadedTeams,
                holdings: try await holdings,
                counterpicks: try await counterpicks,
                liveStandings: try await standings,
                myDropCount: dropCount,
                contestedMovieIDs: try await contested,
                reigningChampions: reigning
            )
            if state != .loaded(snapshot) { state = .loaded(snapshot) }
            // Every held movie, in one batch: roster, standings, trades and
            // counterpick choices all read from it.
            projections.learn(
                snapshot.holdings.map { ($0.movieID, $0.tmdbID) }
                    + snapshot.counterpicks.compactMap { counterpick in counterpick.movie.map { (counterpick.movieID, $0.tmdbID) } }
            )
            if season.status == .active {
                async let bidsUpdated: Void = bids.update(leagueID: leagueID, teamID: myTeamID)
                if season.tradesEnabled { await trades.update(leagueID: leagueID, teamID: myTeamID) }
                await bidsUpdated
            }
        } catch {
            if case .loaded = state { return }
            state = .failed(message: APIError.wrap(error).userMessage)
        }
    }

    /// The newest earlier season of this series that finished, for the crown
    /// and the new-season welcome card.
    var previousCompletedSeason: League? {
        seriesSeasons
            .filter { $0.seasonYear < season.seasonYear && $0.status == .completed }
            .max { $0.seasonYear < $1.seasonYear }
    }

    // MARK: Derived

    var myTeam: SeasonTeam? {
        guard let teams = snapshot?.teams else { return nil }
        return teams.first { $0.userID == userID && $0.participantStatus == .active }
            ?? teams.first { $0.userID == userID }
    }

    /// Every team that has been in the season, active or not.
    var teams: [SeasonTeam] { snapshot?.teams ?? [] }

    /// The commissioner is the season's owner (`leagues.owner_id`).
    var isCommissioner: Bool { season.ownerID == userID }

    func team(_ id: TeamID) -> SeasonTeam? {
        snapshot?.teams.first { $0.id == id }
    }

    func holdings(of teamID: TeamID) -> [TeamHolding] {
        snapshot?.holdings.filter { $0.teamID == teamID } ?? []
    }

    /// Counterpicks the team holds against other teams' movies.
    func counterpicks(by teamID: TeamID) -> [Counterpick] {
        snapshot?.counterpicks.filter { $0.counterpickerTeamID == teamID } ?? []
    }

    /// The ranked table: the frozen one for a completed season, otherwise live.
    var standings: [FinalStandingRow] {
        SeasonResults.standings(final: season.finalStandings, live: snapshot?.liveStandings ?? [])
    }

    func standing(of teamID: TeamID) -> FinalStandingRow? {
        standings.first { $0.teamID == teamID }
    }

    var teamCount: Int {
        season.finalStandings?.count ?? snapshot?.teams.filter { $0.participantStatus == .active }.count ?? 0
    }

    /// Whether to show budgets at all (a season with no starting budget hides them).
    var showsBudget: Bool { season.faabBudget > 0 }

    var ownerNameByUserID: [UserID: String] {
        var names: [UserID: String] = [:]
        for team in snapshot?.teams ?? [] {
            if let name = team.ownerName { names[team.userID] = name }
        }
        return names
    }

    var champions: [Champion] {
        SeasonResults.champions(winnerTeamIDs: season.winnerTeamIDs, standings: standings, ownerNameByUserID: ownerNameByUserID)
    }

    /// The year a team's owner is crowned for, if any: this season's champions
    /// once it's over, otherwise last season's.
    func crownYear(for teamID: TeamID, userID: UserID) -> Int? {
        if season.isCompleted {
            return (season.winnerTeamIDs ?? []).contains(teamID) ? season.seasonYear : nil
        }
        guard let reigning = snapshot?.reigningChampions, reigning.userIDs.contains(userID) else { return nil }
        return reigning.seasonYear
    }

    /// Trades are open with this team: both of us active, trades on, the
    /// deadline not passed (a deadline day still counts).
    func canProposeTrade(to teamID: TeamID) -> Bool {
        guard let me = myTeam, me.id != teamID, me.participantStatus == .active,
              let team = team(teamID), team.participantStatus == .active else { return false }
        guard season.status == .active, season.tradesEnabled else { return false }
        if let deadline = season.tradeDeadline, deadline < DateOnly.today() { return false }
        return true
    }

    var dropsRemaining: Int { max(season.dropLimit - (snapshot?.myDropCount ?? 0), 0) }

    func dropContext() -> DropBlocker.Context {
        DropBlocker.Context(
            leagueStatus: season.status,
            counterpicksBlockDrops: season.counterpicksBlockDrops,
            contestedMovieIDs: snapshot?.contestedMovieIDs ?? [],
            dropsRemaining: dropsRemaining
        )
    }

    /// The holding behind a TMDb id on my roster, for the movie detail's Drop.
    func myHolding(tmdbID: TMDbID) -> TeamHolding? {
        guard let team = myTeam else { return nil }
        return holdings(of: team.id).first { $0.tmdbID == tmdbID }
    }

    // MARK: Projections (Beta, F-19)

    private struct ProjectedKey: Equatable {
        let snapshotGeneration: Int
        let projectionsVersion: Int
        let doublePointsOver90: Bool
    }

    /// The projected table, or nil while there is nothing to show: projections
    /// off, a completed season, still loading, or no movie that rests on a
    /// projection. Waits for every movie's answer so a total never moves part-way.
    var projectedStandings: [ProjectedStandings.Standing]? {
        let key = ProjectedKey(snapshotGeneration: snapshotGeneration, projectionsVersion: projections.version, doublePointsOver90: season.doublePointsOver90)
        if let cached = projectedCache, cached.key == key { return cached.value }
        let value = computeProjectedStandings()
        projectedCache = (key, value)
        return value
    }

    private func computeProjectedStandings() -> [ProjectedStandings.Standing]? {
        guard projections.isEnabled, !season.isCompleted, let snapshot else { return nil }
        let sources = snapshot.holdings.map {
            ProjectedStandings.Source(
                teamID: $0.teamID, tmdbID: $0.tmdbID, title: $0.title, releaseDate: $0.releaseDate,
                posterURL: $0.posterURL, fantasyPoints: $0.fantasyPoints
            )
        } + snapshot.counterpicks.compactMap { counterpick -> ProjectedStandings.Source? in
            guard let movie = counterpick.movie else { return nil }
            return ProjectedStandings.Source(
                teamID: counterpick.counterpickerTeamID, tmdbID: movie.tmdbID, title: movie.title,
                releaseDate: movie.releaseDate, posterURL: movie.posterURL,
                fantasyPoints: counterpick.fantasyPoints, counterpick: true
            )
        }
        guard !sources.isEmpty, projections.hasAnswers(for: sources.map(\.tmdbID)) else { return nil }
        let teams = standings.map {
            ProjectedStandings.Team(teamID: $0.teamID, teamName: team($0.teamID)?.name ?? $0.teamName, earned: $0.totalPoints, rank: $0.rank)
        }
        let table = ProjectedStandings.compute(
            teams: teams, sources: sources, projections: projections.projections,
            doublePointsOver90: season.doublePointsOver90
        )
        return ProjectedStandings.hasProjectedLegs(table) ? table : nil
    }

    // MARK: Mutations

    func renameMyTeam(to name: String) async throws {
        guard let team = myTeam else { return }
        try await repository.renameTeam(team.id, to: name)
        await refresh()
    }

    func setMyTeamAvatar(_ image: Data, contentType: String) async throws {
        guard let team = myTeam else { return }
        _ = try await repository.setTeamAvatar(team.id, image: image, contentType: contentType)
        await refresh()
    }

    func removeMyTeamAvatar() async throws {
        guard let team = myTeam else { return }
        try await repository.removeTeamAvatar(team.id)
        await refresh()
    }

    func drop(_ holding: TeamHolding) async throws {
        _ = try await repository.dropMovie(holding.holdingID, source: holding.source)
        Announcer.announce("Dropped \(holding.title)")
        await refresh()
    }
}

/// Owns the season store for one season's tabs and keeps it current: Realtime
/// on the roster tables (an invalidation signal only), the foreground refresh,
/// and the directory's re-reads of the season row.
struct LeagueSeasonScope<Content: View>: View {
    let selection: LeagueSelection
    @State private var store: LeagueSeasonStore
    @Environment(AppEnvironment.self) private var environment
    @Environment(ShellRouter.self) private var router
    private let content: Content

    init(selection: LeagueSelection, environment: AppEnvironment, @ViewBuilder content: () -> Content) {
        self.selection = selection
        _store = State(initialValue: LeagueSeasonStore(
            selection: selection, repository: environment.teams,
            bidRepository: environment.bids, tradeRepository: environment.trades,
            movieRepository: environment.movies
        ))
        self.content = content()
    }

    var body: some View {
        content
            .environment(store)
            .environment(\.projectionStore, store.projections)
            .onAppear { router.seasonStore = store }
            .onDisappear { if router.seasonStore === store { router.seasonStore = nil } }
            .task(id: selection.season.id) { await watch() }
            .onChange(of: selection) { Task { await store.update(selection: selection) } }
            .refreshOnForeground {
                await store.refresh()
                // The week can roll over while the app is away: re-read the cutoff.
                if store.season.status == .active {
                    await store.bids.refresh()
                    if store.season.tradesEnabled { await store.trades.refresh() }
                }
            }
    }

    private func watch() async {
        await store.load()
        let leagueID = selection.season.id.rawValue
        let feed = environment.changeFeed
        let store = store
        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await forEachChange(feed, topic: "league-season", tables: ["draft_picks", "pickups", "counterpicks", "counterpick_bids"], leagueID: leagueID) {
                    await store.refresh()
                }
            }
            group.addTask {
                await forEachChange(feed, topic: "league-bids", tables: ["pickup_bids", "counterpick_bids"], leagueID: leagueID) {
                    if await store.season.status == .active { await store.bids.refresh() }
                }
            }
            group.addTask {
                // A completed trade can move only budgets, and `team_budgets`
                // can't be filtered by league: re-read the season too.
                await forEachChange(feed, topic: "league-trades", tables: ["trade_offers"], leagueID: leagueID) {
                    guard await store.season.status == .active else { return }
                    async let seasonRefreshed: Void = store.refresh()
                    await store.trades.refresh()
                    await seasonRefreshed
                }
            }
        }
    }
}

/// Runs `action` on every change to `tables` in the league, skipping the
/// first signal (it only confirms the subscription).
private func forEachChange(
    _ feed: ChangeFeed,
    topic: String,
    tables: [String],
    leagueID: String,
    action: @escaping @Sendable () async -> Void
) async {
    let watches = tables.map { ChangeFeed.Watch(table: $0, filter: .equals("league_id", leagueID)) }
    var isFirstSignal = true
    for await _ in feed.signals(topic: topic, watching: watches) {
        if isFirstSignal {
            isFirstSignal = false
            continue
        }
        await action()
    }
}
