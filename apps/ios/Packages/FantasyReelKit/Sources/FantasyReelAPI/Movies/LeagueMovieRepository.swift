import FantasyReelCore
import Foundation
import Supabase

/// What a season knows about movies, for research screens: who holds what
/// (labels on search results and wishlists) and one movie's holding and score
/// (league movie detail). Reads only; rosters change through their own
/// Edge Functions.
public protocol LeagueMovieRepository: Sendable {
    /// Every active holding in the season, from `team_holdings` (draft picks
    /// and pickups alike).
    func fetchHolders(in leagueID: LeagueID) async throws(APIError) -> [HoldingSummary]
    /// The season's active holding of one movie, if any team holds it.
    func fetchHolding(of tmdbID: TMDbID, in leagueID: LeagueID) async throws(APIError) -> TeamHolding?
    /// Our `movies` row for a TMDb id: the score of record. Nil when no league
    /// has ever picked the movie.
    func fetchMovie(_ tmdbID: TMDbID) async throws(APIError) -> Movie?
}

/// The `team_holdings` columns a label needs.
public struct HoldingSummary: Codable, Sendable, Hashable {
    public var tmdbID: TMDbID
    public var teamID: TeamID
    public var teamName: String
    public var source: HoldingSource

    public init(tmdbID: TMDbID, teamID: TeamID, teamName: String, source: HoldingSource) {
        self.tmdbID = tmdbID
        self.teamID = teamID
        self.teamName = teamName
        self.source = source
    }

    public enum CodingKeys: String, CodingKey {
        case tmdbID = "tmdb_id"
        case teamID = "team_id"
        case teamName = "team_name"
        case source
    }
}

extension LeagueHoldingsIndex {
    public init(myTeamID: TeamID?, summaries: [HoldingSummary]) {
        var holders: [TMDbID: Holder] = [:]
        for summary in summaries {
            holders[summary.tmdbID] = Holder(teamID: summary.teamID, teamName: summary.teamName, source: summary.source)
        }
        self.init(myTeamID: myTeamID, holders: holders)
    }
}

public struct SupabaseLeagueMovieRepository: LeagueMovieRepository {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchHolders(in leagueID: LeagueID) async throws(APIError) -> [HoldingSummary] {
        do {
            return try await client
                .from("team_holdings")
                .select("tmdb_id, team_id, team_name, source")
                .eq("league_id", value: leagueID.rawValue)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchHolding(of tmdbID: TMDbID, in leagueID: LeagueID) async throws(APIError) -> TeamHolding? {
        do {
            let rows: [TeamHolding] = try await client
                .from("team_holdings")
                .select()
                .eq("league_id", value: leagueID.rawValue)
                .eq("tmdb_id", value: tmdbID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchMovie(_ tmdbID: TMDbID) async throws(APIError) -> Movie? {
        do {
            let rows: [Movie] = try await client
                .from("movies")
                .select()
                .eq("tmdb_id", value: tmdbID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first
        } catch {
            throw APIError.wrap(error)
        }
    }
}
