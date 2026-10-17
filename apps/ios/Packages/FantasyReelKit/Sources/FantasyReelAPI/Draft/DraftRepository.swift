import FantasyReelCore
import Foundation
import Supabase

/// The draft room's reads and mutations (F-08, F-09). Season and member reads
/// come from `LeagueRepository`, and draft order from `LeagueLifecycleRepository`;
/// this covers picks, counterpicks and the phase calls.
///
/// Submissions follow the draft retry contract: never auto-retry, and on an
/// uncertain result re-read and resend the same `DraftAttempt` (`DraftAttempt.resolve`).
public protocol DraftRepository: Sendable {
    /// Every draft pick of the season with its movie, in board order.
    func fetchPicks(_ leagueID: LeagueID) async throws(APIError) -> [DraftPickRecord]
    /// Every counterpick of the season with its movie, in pick order.
    func fetchCounterpicks(_ leagueID: LeagueID) async throws(APIError) -> [DraftCounterpick]
    /// Opponents' movies this team may counterpick right now.
    func fetchCounterpickOptions(_ leagueID: LeagueID, teamID: TeamID) async throws(APIError) -> [CounterpickOption]

    /// `draft-pick` or `make-counterpick`, by the attempt's selection.
    func submit(_ attempt: DraftAttempt) async throws(APIError) -> DraftSubmissionResult

    /// Owner: setup → drafting. Randomizes the order when none is custom.
    func startDraft(_ leagueID: LeagueID) async throws(APIError)
    /// Owner, board full: drafting → counterpicking.
    func startCounterpickRound(_ leagueID: LeagueID) async throws(APIError)
    /// Owner: skip the round from a full board, or (`endRemaining`) end it
    /// while counterpicking, keeping saved counterpicks. Either activates the season.
    func skipCounterpickRound(_ leagueID: LeagueID, endRemaining: Bool) async throws(APIError)
}

public struct SupabaseDraftRepository: DraftRepository {
    private let client: SupabaseClient
    private let functions: EdgeFunctionClient

    public init(provider: SupabaseProvider, functions: EdgeFunctionClient) {
        self.client = provider.client
        self.functions = functions
    }

    public func fetchPicks(_ leagueID: LeagueID) async throws(APIError) -> [DraftPickRecord] {
        do {
            return try await client
                .from("draft_picks")
                .select("*, movies (*)")
                .eq("league_id", value: leagueID.rawValue)
                .order("round")
                .order("pick_number")
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchCounterpicks(_ leagueID: LeagueID) async throws(APIError) -> [DraftCounterpick] {
        do {
            return try await client
                .from("counterpicks")
                .select("*, movies (*)")
                .eq("league_id", value: leagueID.rawValue)
                .order("pick_order")
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchCounterpickOptions(_ leagueID: LeagueID, teamID: TeamID) async throws(APIError) -> [CounterpickOption] {
        do {
            return try await client
                .rpc("get_counterpick_options", params: [
                    "p_league_id": leagueID.rawValue,
                    "p_team_id": teamID.rawValue,
                ])
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func submit(_ attempt: DraftAttempt) async throws(APIError) -> DraftSubmissionResult {
        let request = DraftSubmissionRequest(attempt)
        return try await functions.invoke(request.function, body: request)
    }

    public func startDraft(_ leagueID: LeagueID) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke("start-draft", body: ["league_id": leagueID.rawValue])
    }

    public func startCounterpickRound(_ leagueID: LeagueID) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke("start-counterpick-round", body: ["league_id": leagueID.rawValue])
    }

    public func skipCounterpickRound(_ leagueID: LeagueID, endRemaining: Bool) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke(
            "skip-counterpick-round",
            body: SkipCounterpickRoundRequest(leagueID: leagueID, endRemaining: endRemaining)
        )
    }
}

private struct SkipCounterpickRoundRequest: Encodable, Sendable {
    let leagueID: LeagueID
    let endRemaining: Bool

    enum CodingKeys: String, CodingKey {
        case leagueID = "league_id"
        case endRemaining = "end_remaining"
    }
}
