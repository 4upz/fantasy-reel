import FantasyReelCore
import Foundation
import Supabase

/// Invitations and share codes (F-05). Reads run under RLS like the web;
/// every change goes through its Edge Function, which checks ownership,
/// the setup phase and the email rate limits.
public protocol InvitationRepository: Sendable {
    /// Unexpired pending invitations addressed to `email`, newest first.
    /// Invitations whose league is gone or hidden are dropped.
    func fetchPending(for email: String) async throws(APIError) -> [PendingInvitation]
    func decline(_ id: InvitationID) async throws(APIError)

    // Owner only.
    /// Every invitation of the season, with username invitees' emails withheld.
    func fetchInvitations(of leagueID: LeagueID) async throws(APIError) -> [LeagueInvitation]
    func searchUsers(_ query: String, in leagueID: LeagueID) async throws(APIError) -> [UserSearchResult]
    func invite(_ recipient: InviteRecipient, to leagueID: LeagueID) async throws(APIError) -> InviteResult
    /// Rotates the token and expiry and emails it again.
    func resend(_ id: InvitationID) async throws(APIError) -> InviteResult
    func cancel(_ id: InvitationID) async throws(APIError)
    /// The current share code, or nil when none was generated yet. A failed
    /// read throws: never generate a new one to cover it, which would kill a
    /// code already shared.
    func fetchJoinCode(of leagueID: LeagueID) async throws(APIError) -> String?
    /// Creates the code, or replaces it (the old code and link stop working).
    func generateJoinCode(for leagueID: LeagueID) async throws(APIError) -> String
}

/// The restricted growth dashboard (F-18).
public protocol AdminRepository: Sendable {
    /// The stats, or nil when this account isn't an app administrator (the
    /// RPC refuses with 42501). Other failures throw.
    func fetchGrowthStats() async throws(APIError) -> GrowthStats?
}

/// Commissioner announcements to the league's linked Discord channels (F-15).
public protocol AnnouncementRepository: Sendable {
    /// Returns how many channels it reached (0 when none are linked).
    func postAnnouncement(_ message: String, to leagueID: LeagueID) async throws(APIError) -> Int
}

public struct SupabaseInvitationRepository: InvitationRepository {
    private let client: SupabaseClient
    private let functions: EdgeFunctionClient

    public init(provider: SupabaseProvider, functions: EdgeFunctionClient) {
        self.client = provider.client
        self.functions = functions
    }

    private struct PendingRow: Decodable {
        let invitation: PendingInvitation
        let hasLeague: Bool

        private enum CodingKeys: String, CodingKey { case leagues }

        init(from decoder: any Decoder) throws {
            invitation = try PendingInvitation(from: decoder)
            let c = try decoder.container(keyedBy: CodingKeys.self)
            hasLeague = c.contains(.leagues) ? !(try c.decodeNil(forKey: .leagues)) : false
        }
    }

    public func fetchPending(for email: String) async throws(APIError) -> [PendingInvitation] {
        do {
            // Invitations are stored with lowercased emails (send-invite normalizes).
            let rows: [PendingRow] = try await client
                .from("invitations")
                .select("*, leagues(id, name, status, owner_id)")
                .eq("status", value: "pending")
                .eq("email", value: email.lowercased())
                .gte("expires_at", value: PostgresTimestamp.format(Date()))
                .order("sent_at", ascending: false)
                .execute()
                .value
            return rows.filter(\.hasLeague).map(\.invitation)
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func decline(_ id: InvitationID) async throws(APIError) {
        let _: JSONValue = try await functions.invoke("decline-invitation", body: ["invitation_id": id.rawValue])
    }

    public func fetchInvitations(of leagueID: LeagueID) async throws(APIError) -> [LeagueInvitation] {
        do {
            return try await client
                .rpc("get_league_invitations", params: ["p_league_id": leagueID.rawValue])
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    private struct SearchBody: Encodable, Sendable {
        let query: String
        let league_id: String
    }

    private struct SearchResponse: Decodable, Sendable {
        let users: [UserSearchResult]
    }

    public func searchUsers(_ query: String, in leagueID: LeagueID) async throws(APIError) -> [UserSearchResult] {
        let response: SearchResponse = try await functions.invoke(
            "search-users", body: SearchBody(query: query, league_id: leagueID.rawValue)
        )
        return response.users
    }

    public func invite(_ recipient: InviteRecipient, to leagueID: LeagueID) async throws(APIError) -> InviteResult {
        var body = ["league_id": leagueID.rawValue]
        switch recipient {
        case .email(let email): body["email"] = email.trimmingCharacters(in: .whitespacesAndNewlines)
        case .user(let userID): body["user_id"] = userID.rawValue
        }
        return try await functions.invoke("send-invite", body: body)
    }

    public func resend(_ id: InvitationID) async throws(APIError) -> InviteResult {
        try await functions.invoke("resend-invitation", body: ["invitation_id": id.rawValue])
    }

    public func cancel(_ id: InvitationID) async throws(APIError) {
        let _: JSONValue = try await functions.invoke("cancel-invitation", body: ["invitation_id": id.rawValue])
    }

    private struct JoinLinkRow: Decodable, Sendable {
        let join_code: String
    }

    public func fetchJoinCode(of leagueID: LeagueID) async throws(APIError) -> String? {
        do {
            let rows: [JoinLinkRow] = try await client
                .from("league_join_links")
                .select("join_code")
                .eq("league_id", value: leagueID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first?.join_code
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func generateJoinCode(for leagueID: LeagueID) async throws(APIError) -> String {
        let row: JoinLinkRow = try await functions.invoke("generate-join-link", body: ["league_id": leagueID.rawValue])
        return row.join_code
    }
}

public struct SupabaseAdminRepository: AdminRepository {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchGrowthStats() async throws(APIError) -> GrowthStats? {
        do {
            return try await client.rpc("admin_growth_stats").execute().value
        } catch {
            let wrapped = APIError.wrap(error)
            if wrapped.serverCode == "42501" { return nil }
            throw wrapped
        }
    }
}

public struct EdgeAnnouncementRepository: AnnouncementRepository {
    private let functions: EdgeFunctionClient

    public init(functions: EdgeFunctionClient) {
        self.functions = functions
    }

    private struct Response: Decodable, Sendable {
        let channels_notified: Int?
    }

    public func postAnnouncement(_ message: String, to leagueID: LeagueID) async throws(APIError) -> Int {
        let response: Response = try await functions.invoke(
            "send-announcement", body: ["league_id": leagueID.rawValue, "message": message]
        )
        return response.channels_notified ?? 0
    }
}
