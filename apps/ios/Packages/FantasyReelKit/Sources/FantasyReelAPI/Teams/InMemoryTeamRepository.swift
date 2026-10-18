import FantasyReelCore
import Foundation

/// In-memory `TeamRepository` for previews, screenshots and tests. Drops and
/// edits change the stored data so a preview behaves like the real thing.
public actor InMemoryTeamRepository: TeamRepository {
    public var teams: [SeasonTeam]
    public var holdings: [TeamHolding]
    public var counterpicks: [Counterpick]
    public var standings: [StandingRow]
    public var dropCounts: [TeamID: Int]
    public var contestedMovieIDs: Set<MovieID>
    public var owners: [TeamID: UserID]
    public var failure: APIError?

    public init(
        teams: [SeasonTeam] = [],
        holdings: [TeamHolding] = [],
        counterpicks: [Counterpick] = [],
        standings: [StandingRow] = [],
        dropCounts: [TeamID: Int] = [:],
        contestedMovieIDs: Set<MovieID> = [],
        owners: [TeamID: UserID] = [:],
        failure: APIError? = nil
    ) {
        self.teams = teams
        self.holdings = holdings
        self.counterpicks = counterpicks
        self.standings = standings
        self.dropCounts = dropCounts
        self.contestedMovieIDs = contestedMovieIDs
        self.owners = owners
        self.failure = failure
    }

    public func fetchTeams(in leagueID: LeagueID, includeFormer: Bool) async throws(APIError) -> [SeasonTeam] {
        if let failure { throw failure }
        return teams.filter { includeFormer || $0.participantStatus == .active }
    }

    public func fetchHoldings(in leagueID: LeagueID) async throws(APIError) -> [TeamHolding] {
        if let failure { throw failure }
        return holdings.filter { $0.leagueID == leagueID }
    }

    public func fetchCounterpicks(in leagueID: LeagueID) async throws(APIError) -> [Counterpick] {
        if let failure { throw failure }
        return counterpicks.filter { $0.leagueID == leagueID }
    }

    public func fetchStandings(in leagueID: LeagueID) async throws(APIError) -> [StandingRow] {
        if let failure { throw failure }
        return standings
    }

    public func fetchDropCount(for teamID: TeamID) async throws(APIError) -> Int {
        if let failure { throw failure }
        return dropCounts[teamID] ?? 0
    }

    public func fetchContestedMovieIDs(in leagueID: LeagueID) async throws(APIError) -> Set<MovieID> {
        if let failure { throw failure }
        return contestedMovieIDs
    }

    public func fetchOwners(of teamIDs: [TeamID]) async throws(APIError) -> [TeamID: UserID] {
        owners.filter { teamIDs.contains($0.key) }
    }

    public func renameTeam(_ teamID: TeamID, to name: String) async throws(APIError) {
        if let failure { throw failure }
        for index in teams.indices where teams[index].id == teamID {
            teams[index].team.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    public func setTeamAvatar(_ teamID: TeamID, image: Data, contentType: String) async throws(APIError) -> String {
        if let failure { throw failure }
        let url = "https://example.invalid/team-avatars/\(teamID.rawValue)/avatar?v=1"
        for index in teams.indices where teams[index].id == teamID { teams[index].team.avatarURL = url }
        return url
    }

    public func removeTeamAvatar(_ teamID: TeamID) async throws(APIError) {
        if let failure { throw failure }
        for index in teams.indices where teams[index].id == teamID { teams[index].team.avatarURL = nil }
    }

    public func dropMovie(_ holdingID: HoldingID, source: HoldingSource) async throws(APIError) -> DropResult {
        if let failure { throw failure }
        guard let holding = holdings.first(where: { $0.holdingID == holdingID }) else {
            throw .server(.init(status: 404, message: source == .draft ? "Draft pick not found" : "Pickup not found"))
        }
        holdings.removeAll { $0.holdingID == holdingID }
        let used = (dropCounts[holding.teamID] ?? 0) + 1
        dropCounts[holding.teamID] = used
        return DropResult(dropsUsed: used, dropsRemaining: nil)
    }
}
