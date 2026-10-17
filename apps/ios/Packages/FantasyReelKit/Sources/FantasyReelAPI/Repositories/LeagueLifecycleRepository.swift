import FantasyReelCore
import Foundation

/// League lifecycle mutations (F-05, F-15, F-16): create, join, commissioner
/// updates and rollover. All go through Edge Functions, which own validation
/// and phase rules; nothing here writes a table directly.
///
/// Never auto-retry these. On an uncertain result (`APIError.isUncertainOutcome`)
/// re-read the directory or season and let the person decide (N-04).
public protocol LeagueLifecycleRepository: Sendable {
    func createLeague(_ request: CreateLeagueRequest) async throws(APIError) -> LeagueMembershipResult
    func joinLeague(_ request: JoinLeagueRequest) async throws(APIError) -> LeagueMembershipResult
    /// One owner action on one season (`update-league`).
    func update(_ leagueID: LeagueID, _ update: LeagueUpdate) async throws(APIError) -> LeagueUpdateResult
    /// Owner only, after completion. An already-started next season comes
    /// back with `wasCreated == false` instead of an error, so two taps or two
    /// devices land on the same season.
    func startNextSeason(after leagueID: LeagueID) async throws(APIError) -> NextSeason
}

public struct EdgeLeagueLifecycleRepository: LeagueLifecycleRepository {
    private let functions: EdgeFunctionClient

    public init(functions: EdgeFunctionClient) {
        self.functions = functions
    }

    public func createLeague(_ request: CreateLeagueRequest) async throws(APIError) -> LeagueMembershipResult {
        try await functions.invoke("create-league", body: request)
    }

    public func joinLeague(_ request: JoinLeagueRequest) async throws(APIError) -> LeagueMembershipResult {
        try await functions.invoke("join-league", body: request)
    }

    public func update(_ leagueID: LeagueID, _ update: LeagueUpdate) async throws(APIError) -> LeagueUpdateResult {
        try await functions.invoke("update-league", body: LeagueUpdateRequest(leagueID: leagueID, update: update))
    }

    public func startNextSeason(after leagueID: LeagueID) async throws(APIError) -> NextSeason {
        do {
            return try await functions.invoke("start-next-season", body: ["league_id": leagueID.rawValue])
        } catch {
            if let existing = Self.existingSeason(in: error) { return existing }
            throw error
        }
    }

    /// The 409 "already been started" answer names the existing season.
    static func existingSeason(in error: APIError) -> NextSeason? {
        guard case .server(let server) = error, server.status == 409,
              let id = server.body?["league_id"]?.stringValue,
              let year = server.body?["season_year"]?.intValue
        else { return nil }
        return NextSeason(leagueID: LeagueID(rawValue: id), seasonYear: year, wasCreated: false)
    }
}
