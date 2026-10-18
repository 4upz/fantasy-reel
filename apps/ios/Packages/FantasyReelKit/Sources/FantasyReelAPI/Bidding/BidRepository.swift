import FantasyReelCore
import Foundation
import Supabase

/// Pickup and counterpick bidding (F-12).
///
/// Reads go straight to Supabase: every active member can read every bid in
/// the league, as on the web. Every write goes through an Edge Function (the
/// tables refuse client writes).
public protocol BidRepository: Sendable {
    /// Pending (active/outbid) pickup bids in the league, newest first.
    func fetchPendingPickupBids(in leagueID: LeagueID) async throws(APIError) -> [PickupBid]
    /// Pending counterpick bids in the league, movie and target team embedded.
    func fetchPendingCounterpickBids(in leagueID: LeagueID) async throws(APIError) -> [CounterpickBid]
    /// Settled (won/lost) bids of both kinds, newest processing first.
    func fetchSettledBids(in leagueID: LeagueID) async throws(APIError) -> (pickups: [PickupBid], counterpicks: [CounterpickBid])
    /// This week's processing deadline and new-bid cutoff (nil when off).
    func fetchBidWeek(for leagueID: LeagueID) async throws(APIError) -> BidWeek
    /// Bidding-phase counterpicks the team already holds.
    func fetchBiddingCounterpickCount(for teamID: TeamID) async throws(APIError) -> Int
    /// TMDb ids of upcoming movies that already have a score (bids refuse them).
    func fetchScoredUpcomingTMDbIDs() async throws(APIError) -> Set<TMDbID>
    /// Opponents' movies the team can counterpick (`get_counterpick_options`).
    func fetchCounterpickOptions(in leagueID: LeagueID, for teamID: TeamID) async throws(APIError) -> [CounterpickOption]

    func placePickupBid(_ request: PlacePickupBid) async throws(APIError) -> PlaceBidResult
    func placeCounterpickBid(league: LeagueID, movie: MovieID, amount: Int) async throws(APIError) -> PlaceBidResult
    func cancelPickupBid(_ bidID: BidID) async throws(APIError)
    func cancelCounterpickBid(_ bidID: BidID) async throws(APIError)
    /// Saves the team's full pending pickup order, most wanted first.
    func setPickupPriorities(league: LeagueID, bidIDs: [BidID]) async throws(APIError)
    /// Saves the team's full pending counterpick order, most wanted first.
    func setCounterpickPriorities(league: LeagueID, bidIDs: [BidID]) async throws(APIError)
}

/// A pickup bid to place, raise or counter.
public struct PlacePickupBid: Sendable, Hashable {
    public var leagueID: LeagueID
    public var tmdbID: TMDbID
    public var amount: Int
    /// The holding to release if this bid wins (overwrites any earlier choice).
    public var conditionalDrop: (id: HoldingID, source: HoldingSource)?

    public init(leagueID: LeagueID, tmdbID: TMDbID, amount: Int, conditionalDrop: (id: HoldingID, source: HoldingSource)? = nil) {
        self.leagueID = leagueID
        self.tmdbID = tmdbID
        self.amount = amount
        self.conditionalDrop = conditionalDrop
    }

    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.leagueID == rhs.leagueID && lhs.tmdbID == rhs.tmdbID && lhs.amount == rhs.amount
            && lhs.conditionalDrop?.id == rhs.conditionalDrop?.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(leagueID)
        hasher.combine(tmdbID)
        hasher.combine(amount)
        hasher.combine(conditionalDrop?.id)
    }
}

/// place-bid / place-counterpick-bid success. `raceCondition` means the bid
/// saved but someone else's equal or higher bid landed at the same moment, so
/// it is already outbid; show `message`.
public struct PlaceBidResult: Decodable, Sendable, Hashable {
    public let message: String?
    public let wasUpdate: Bool
    public let raceCondition: Bool

    public init(message: String?, wasUpdate: Bool = false, raceCondition: Bool = false) {
        self.message = message
        self.wasUpdate = wasUpdate
        self.raceCondition = raceCondition
    }

    enum CodingKeys: String, CodingKey {
        case message
        case wasUpdate = "was_update"
        case raceCondition = "race_condition"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        message = try c.decodeIfPresent(String.self, forKey: .message)
        wasUpdate = try c.decodeIfPresent(Bool.self, forKey: .wasUpdate) ?? false
        raceCondition = try c.decodeIfPresent(Bool.self, forKey: .raceCondition) ?? false
    }
}

public struct SupabaseBidRepository: BidRepository {
    static let counterpickBidSelect = "*, movies(title, poster_url, release_date, fantasy_points), target_team:teams!counterpick_bids_target_team_id_fkey(name)"

    private let client: SupabaseClient
    private let functions: EdgeFunctionClient

    public init(provider: SupabaseProvider, functions: EdgeFunctionClient) {
        self.client = provider.client
        self.functions = functions
    }

    public func fetchPendingPickupBids(in leagueID: LeagueID) async throws(APIError) -> [PickupBid] {
        do {
            return try await client
                .from("pickup_bids")
                .select()
                .eq("league_id", value: leagueID.rawValue)
                .in("status", values: ["active", "outbid"])
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchPendingCounterpickBids(in leagueID: LeagueID) async throws(APIError) -> [CounterpickBid] {
        do {
            return try await client
                .from("counterpick_bids")
                .select(Self.counterpickBidSelect)
                .eq("league_id", value: leagueID.rawValue)
                .in("status", values: ["active", "outbid"])
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchSettledBids(in leagueID: LeagueID) async throws(APIError) -> (pickups: [PickupBid], counterpicks: [CounterpickBid]) {
        do {
            async let pickups: [PickupBid] = client
                .from("pickup_bids")
                .select()
                .eq("league_id", value: leagueID.rawValue)
                .in("status", values: ["won", "lost"])
                .order("processing_deadline", ascending: false)
                .limit(500)
                .execute()
                .value
            async let counterpicks: [CounterpickBid] = client
                .from("counterpick_bids")
                .select(Self.counterpickBidSelect)
                .eq("league_id", value: leagueID.rawValue)
                .in("status", values: ["won", "lost"])
                .order("processing_deadline", ascending: false)
                .limit(500)
                .execute()
                .value
            return try await (pickups, counterpicks)
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchBidWeek(for leagueID: LeagueID) async throws(APIError) -> BidWeek {
        do {
            async let deadline: String? = client.rpc("get_next_processing_deadline").execute().value
            async let cutoff: String? = client.rpc("get_new_bid_cutoff", params: ["p_league_id": leagueID.rawValue]).execute().value
            let (deadlineText, cutoffText) = try await (deadline, cutoff)
            return BidWeek(
                processingDeadline: deadlineText.flatMap(PostgresTimestamp.parse),
                cutoffAt: cutoffText.flatMap(PostgresTimestamp.parse)
            )
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchBiddingCounterpickCount(for teamID: TeamID) async throws(APIError) -> Int {
        do {
            return try await client
                .from("counterpicks")
                .select("*", head: true, count: .exact)
                .eq("counterpicker_team_id", value: teamID.rawValue)
                .eq("phase", value: "bidding")
                .execute()
                .count ?? 0
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchScoredUpcomingTMDbIDs() async throws(APIError) -> Set<TMDbID> {
        struct Row: Decodable { let tmdb_id: TMDbID }
        do {
            let rows: [Row] = try await client
                .from("movies")
                .select("tmdb_id")
                .not("fantasy_points", operator: .is, value: "null")
                .gte("release_date", value: DateOnly.today().isoString)
                .execute()
                .value
            return Set(rows.map(\.tmdb_id))
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchCounterpickOptions(in leagueID: LeagueID, for teamID: TeamID) async throws(APIError) -> [CounterpickOption] {
        do {
            return try await client
                .rpc("get_counterpick_options", params: ["p_league_id": leagueID.rawValue, "p_team_id": teamID.rawValue])
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func placePickupBid(_ request: PlacePickupBid) async throws(APIError) -> PlaceBidResult {
        struct Body: Encodable, Sendable {
            let league_id: String
            let tmdb_id: Int
            let amount: Int
            let conditional_drop_draft_pick_id: String?
            let conditional_drop_pickup_id: String?

            func encode(to encoder: any Encoder) throws {
                // Send explicit nulls: the server overwrites the drop either way,
                // and an explicit null says "keep my whole roster".
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(league_id, forKey: .league_id)
                try c.encode(tmdb_id, forKey: .tmdb_id)
                try c.encode(amount, forKey: .amount)
                try c.encode(conditional_drop_draft_pick_id, forKey: .conditional_drop_draft_pick_id)
                try c.encode(conditional_drop_pickup_id, forKey: .conditional_drop_pickup_id)
            }

            enum CodingKeys: String, CodingKey {
                case league_id, tmdb_id, amount, conditional_drop_draft_pick_id, conditional_drop_pickup_id
            }
        }
        let drop = request.conditionalDrop
        return try await functions.invoke("place-bid", body: Body(
            league_id: request.leagueID.rawValue,
            tmdb_id: request.tmdbID.rawValue,
            amount: request.amount,
            conditional_drop_draft_pick_id: drop?.source == .draft ? drop?.id.rawValue : nil,
            conditional_drop_pickup_id: drop?.source == .pickup ? drop?.id.rawValue : nil
        ))
    }

    public func placeCounterpickBid(league: LeagueID, movie: MovieID, amount: Int) async throws(APIError) -> PlaceBidResult {
        struct Body: Encodable, Sendable { let league_id: String; let movie_id: String; let amount: Int }
        return try await functions.invoke(
            "place-counterpick-bid",
            body: Body(league_id: league.rawValue, movie_id: movie.rawValue, amount: amount)
        )
    }

    public func cancelPickupBid(_ bidID: BidID) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke("cancel-bid", body: ["bid_id": bidID.rawValue])
    }

    public func cancelCounterpickBid(_ bidID: BidID) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke("cancel-counterpick-bid", body: ["bid_id": bidID.rawValue])
    }

    public func setPickupPriorities(league: LeagueID, bidIDs: [BidID]) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke(
            "set-bid-priorities",
            body: PrioritiesBody(league_id: league.rawValue, bid_ids: bidIDs.map(\.rawValue))
        )
    }

    public func setCounterpickPriorities(league: LeagueID, bidIDs: [BidID]) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke(
            "set-counterpick-bid-priorities",
            body: PrioritiesBody(league_id: league.rawValue, bid_ids: bidIDs.map(\.rawValue))
        )
    }

    private struct PrioritiesBody: Encodable, Sendable {
        let league_id: String
        let bid_ids: [String]
    }
}
