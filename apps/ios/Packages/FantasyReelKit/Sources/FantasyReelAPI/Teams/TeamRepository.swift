import FantasyReelCore
import Foundation
import Supabase

/// Everything the Home, Roster, Standings and Team tabs read about one season's
/// teams, plus the team's own edits and drops (F-10, F-11, F-14).
///
/// Reads go straight to Supabase under RLS, as on the web. Drops go through the
/// `drop-movie` Edge Function. Team name and avatar are direct `teams` writes,
/// which RLS limits to the caller's own team.
public protocol TeamRepository: Sendable {
    /// Every team of the season with owner, score and budget. Pass
    /// `includeFormer` for a completed season so people who left still show.
    func fetchTeams(in leagueID: LeagueID, includeFormer: Bool) async throws(APIError) -> [SeasonTeam]
    /// Every active holding in the season (`team_holdings`).
    func fetchHoldings(in leagueID: LeagueID) async throws(APIError) -> [TeamHolding]
    /// Every counterpick in the season, movie embedded.
    func fetchCounterpicks(in leagueID: LeagueID) async throws(APIError) -> [Counterpick]
    /// The live `league_standings` RPC.
    func fetchStandings(in leagueID: LeagueID) async throws(APIError) -> [StandingRow]
    /// Drops the team has used (`get_team_drop_count`).
    func fetchDropCount(for teamID: TeamID) async throws(APIError) -> Int
    /// Movies with an open (active/outbid) counterpick bid in the season.
    func fetchContestedMovieIDs(in leagueID: LeagueID) async throws(APIError) -> Set<MovieID>
    /// Who owned each team, for crowning a previous season's champions.
    func fetchOwners(of teamIDs: [TeamID]) async throws(APIError) -> [TeamID: UserID]

    /// Renames the caller's team. `name` is sent trimmed; validate first with
    /// `TeamNameRule`.
    func renameTeam(_ teamID: TeamID, to name: String) async throws(APIError)
    /// Uploads a prepared image to `team-avatars/<teamId>/avatar` and points the
    /// team at it. Returns the new `avatar_url`.
    func setTeamAvatar(_ teamID: TeamID, image: Data, contentType: String) async throws(APIError) -> String
    /// Clears the team's avatar and removes the stored image.
    func removeTeamAvatar(_ teamID: TeamID) async throws(APIError)
    /// Drops a drafted movie or a pickup (`drop-movie`).
    func dropMovie(_ holdingID: HoldingID, source: HoldingSource) async throws(APIError) -> DropResult
}

/// `drop-movie`'s success body.
public struct DropResult: Decodable, Sendable, Hashable {
    public let dropsUsed: Int?
    public let dropsRemaining: Int?

    public init(dropsUsed: Int?, dropsRemaining: Int?) {
        self.dropsUsed = dropsUsed
        self.dropsRemaining = dropsRemaining
    }

    enum CodingKeys: String, CodingKey {
        case dropsUsed = "drops_used"
        case dropsRemaining = "drops_remaining"
    }
}

/// The web's team-name rule: trimmed, 1–100 characters.
public enum TeamNameRule {
    public static let maxLength = 100

    /// The error to show, or nil when `name` is acceptable.
    public static func validate(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Team name is required" }
        if trimmed.count > maxLength { return "Team name must be 100 characters or less" }
        return nil
    }
}

public struct SupabaseTeamRepository: TeamRepository {
    static let teamSelect = "*, teams (*, team_scores (*), team_budgets (*)), profiles (display_name, avatar_url, wishlist_public)"
    static let avatarBucket = "team-avatars"

    private let client: SupabaseClient
    private let functions: EdgeFunctionClient

    public init(provider: SupabaseProvider, functions: EdgeFunctionClient) {
        self.client = provider.client
        self.functions = functions
    }

    public func fetchTeams(in leagueID: LeagueID, includeFormer: Bool) async throws(APIError) -> [SeasonTeam] {
        do {
            let statuses = includeFormer ? ["active", "left", "kicked"] : ["active"]
            let response = try await client
                .from("league_participants")
                .select(Self.teamSelect)
                .eq("league_id", value: leagueID.rawValue)
                .in("status", values: statuses)
                .order("draft_order", ascending: true)
                .execute()
            return try SeasonTeam.decodeList(response.data)
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchHoldings(in leagueID: LeagueID) async throws(APIError) -> [TeamHolding] {
        do {
            return try await client
                .from("team_holdings")
                .select()
                .eq("league_id", value: leagueID.rawValue)
                .order("source", ascending: true)
                .order("round", ascending: true)
                .order("pick_number", ascending: true)
                .order("acquired_at", ascending: true)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchCounterpicks(in leagueID: LeagueID) async throws(APIError) -> [Counterpick] {
        do {
            return try await client
                .from("counterpicks")
                .select("*, movies (*)")
                .eq("league_id", value: leagueID.rawValue)
                .order("pick_order", ascending: true)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchStandings(in leagueID: LeagueID) async throws(APIError) -> [StandingRow] {
        do {
            return try await client
                .rpc("league_standings", params: ["p_league_id": leagueID.rawValue])
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchDropCount(for teamID: TeamID) async throws(APIError) -> Int {
        do {
            let count: Int? = try await client
                .rpc("get_team_drop_count", params: ["p_team_id": teamID.rawValue])
                .execute()
                .value
            return count ?? 0
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchContestedMovieIDs(in leagueID: LeagueID) async throws(APIError) -> Set<MovieID> {
        struct Row: Decodable { let movie_id: MovieID }
        do {
            let rows: [Row] = try await client
                .from("counterpick_bids")
                .select("movie_id")
                .eq("league_id", value: leagueID.rawValue)
                .in("status", values: ["active", "outbid"])
                .execute()
                .value
            return Set(rows.map(\.movie_id))
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchOwners(of teamIDs: [TeamID]) async throws(APIError) -> [TeamID: UserID] {
        guard !teamIDs.isEmpty else { return [:] }
        struct Participant: Decodable { let user_id: UserID }
        struct Row: Decodable { let id: TeamID; let league_participants: Participant? }
        do {
            let rows: [Row] = try await client
                .from("teams")
                .select("id, league_participants!inner(user_id)")
                .in("id", values: teamIDs.map(\.rawValue))
                .execute()
                .value
            var owners: [TeamID: UserID] = [:]
            for row in rows {
                if let participant = row.league_participants { owners[row.id] = participant.user_id }
            }
            return owners
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func renameTeam(_ teamID: TeamID, to name: String) async throws(APIError) {
        do {
            try await client
                .from("teams")
                .update(["name": name.trimmingCharacters(in: .whitespacesAndNewlines)])
                .eq("id", value: teamID.rawValue)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func setTeamAvatar(_ teamID: TeamID, image: Data, contentType: String) async throws(APIError) -> String {
        let path = "\(teamID.rawValue)/avatar"
        let bucket = client.storage.from(Self.avatarBucket)
        let publicURL: URL
        do {
            _ = try await bucket.upload(path, data: image, options: FileOptions(contentType: contentType, upsert: true))
            publicURL = try bucket.getPublicURL(path: path)
        } catch {
            throw .server(.init(status: nil, message: "Failed to upload image"))
        }
        // Cache-buster: the object path never changes, so the URL must.
        let millis = Int64((Date().timeIntervalSince1970 * 1000).rounded())
        let avatarURL = "\(publicURL.absoluteString)?v=\(millis)"
        do {
            try await client
                .from("teams")
                .update(["avatar_url": avatarURL])
                .eq("id", value: teamID.rawValue)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
        return avatarURL
    }

    public func removeTeamAvatar(_ teamID: TeamID) async throws(APIError) {
        do {
            try await client
                .from("teams")
                .update(["avatar_url": AnyJSON.null])
                .eq("id", value: teamID.rawValue)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
        // Best effort, like the web: a leftover file is harmless.
        _ = try? await client.storage.from(Self.avatarBucket).remove(paths: ["\(teamID.rawValue)/avatar"])
    }

    public func dropMovie(_ holdingID: HoldingID, source: HoldingSource) async throws(APIError) -> DropResult {
        let body: [String: String]
        switch source {
        case .draft: body = ["draft_pick_id": holdingID.rawValue]
        case .pickup: body = ["pickup_id": holdingID.rawValue]
        case .unknown: throw .server(.init(status: nil, message: "This movie can't be dropped from the app."))
        }
        return try await functions.invoke("drop-movie", body: body)
    }
}
