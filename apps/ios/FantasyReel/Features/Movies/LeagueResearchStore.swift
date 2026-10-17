import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// What research screens need to know about one season: who holds each movie
/// (the "Drafted by …" labels on search results and wishlists) and who plays
/// in it (shared wishlists). Account-scoped and kept per season, so moving
/// between search, a movie and the wishlist reads the season once.
///
/// Labels are a convenience, so a failed read leaves the screens working
/// without them rather than blocking search.
@Observable
@MainActor
final class LeagueResearchStore {
    struct Snapshot {
        var holdings: LeagueHoldingsIndex
        var members: [LeagueMember]
        var loadedAt: Date
    }

    private(set) var snapshots: [LeagueID: Snapshot] = [:]
    private(set) var failures: [LeagueID: String] = [:]

    private let leagues: any LeagueRepository
    private let leagueMovies: any LeagueMovieRepository
    private var inFlight: [LeagueID: Task<Void, Never>] = [:]
    /// Holdings change with picks, bids and trades; reread after this long.
    private let freshness: TimeInterval = 60

    init(leagues: any LeagueRepository, leagueMovies: any LeagueMovieRepository) {
        self.leagues = leagues
        self.leagueMovies = leagueMovies
    }

    func holdings(in leagueID: LeagueID?) -> LeagueHoldingsIndex {
        leagueID.flatMap { snapshots[$0]?.holdings } ?? .empty
    }

    func members(of leagueID: LeagueID?) -> [LeagueMember] {
        leagueID.flatMap { snapshots[$0]?.members } ?? []
    }

    /// Reads the season unless a recent read is on hand. `force` rereads
    /// (pull to refresh, returning to the app).
    func load(_ selection: LeagueSelection, force: Bool = false) async {
        let leagueID = selection.season.id
        if !force, let snapshot = snapshots[leagueID], Date().timeIntervalSince(snapshot.loadedAt) < freshness { return }
        if let running = inFlight[leagueID] {
            await running.value
            return
        }
        let task = Task { await read(selection) }
        inFlight[leagueID] = task
        await task.value
        inFlight[leagueID] = nil
    }

    private func read(_ selection: LeagueSelection) async {
        let leagueID = selection.season.id
        do {
            async let members = leagues.fetchMembers(of: leagueID)
            async let holders = leagueMovies.fetchHolders(in: leagueID)
            let (loadedMembers, summaries) = try await (members, holders)
            let myTeamID = loadedMembers.first { $0.userID == selection.userID }?.team?.id
            snapshots[leagueID] = Snapshot(
                holdings: LeagueHoldingsIndex(myTeamID: myTeamID, summaries: summaries),
                members: loadedMembers,
                loadedAt: Date()
            )
            failures[leagueID] = nil
        } catch {
            let apiError = APIError.wrap(error)
            if apiError.isCancellation { return }
            failures[leagueID] = apiError.userMessage
        }
    }
}
