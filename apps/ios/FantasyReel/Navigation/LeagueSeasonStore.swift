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

    private(set) var state: LoadState<Snapshot> = .idle
    private(set) var season: League
    let userID: UserID
    private var seriesSeasons: [League]
    private let repository: any TeamRepository

    init(selection: LeagueSelection, repository: any TeamRepository) {
        self.season = selection.season
        self.userID = selection.userID
        self.seriesSeasons = selection.seriesSeasons
        self.repository = repository
    }

    var snapshot: Snapshot? { state.value }

    /// The directory re-read this season's row (a phase change, completion,
    /// a rename): adopt it and reload what depends on it.
    func update(selection: LeagueSelection) async {
        guard selection.season != season || selection.seriesSeasons != seriesSeasons else { return }
        season = selection.season
        seriesSeasons = selection.seriesSeasons
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
            let dropCount = try await myTeamID.asyncMap { try await repository.fetchDropCount(for: $0) } ?? 0
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

extension Optional {
    /// `map` for an async throwing transform.
    func asyncMap<T>(_ transform: (Wrapped) async throws -> T) async rethrows -> T? {
        guard let self else { return nil }
        return try await transform(self)
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

    init(selection: LeagueSelection, repository: any TeamRepository, @ViewBuilder content: () -> Content) {
        self.selection = selection
        _store = State(initialValue: LeagueSeasonStore(selection: selection, repository: repository))
        self.content = content()
    }

    var body: some View {
        content
            .environment(store)
            .onAppear { router.seasonStore = store }
            .onDisappear { if router.seasonStore === store { router.seasonStore = nil } }
            .task(id: selection.season.id) { await watch() }
            .onChange(of: selection) { Task { await store.update(selection: selection) } }
            .refreshOnForeground { await store.refresh() }
    }

    private func watch() async {
        await store.load()
        let leagueID = selection.season.id.rawValue
        let watches = ["draft_picks", "pickups", "counterpicks", "counterpick_bids"].map {
            ChangeFeed.Watch(table: $0, filter: .equals("league_id", leagueID))
        }
        var isFirstSignal = true
        for await _ in environment.changeFeed.signals(topic: "league-season", watching: watches) {
            if isFirstSignal {
                isFirstSignal = false
                continue
            }
            await store.refresh()
        }
    }
}
