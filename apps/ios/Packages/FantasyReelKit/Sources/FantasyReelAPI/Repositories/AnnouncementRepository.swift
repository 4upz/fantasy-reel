import FantasyReelCore
import Foundation

/// Commissioner announcements to the league's linked Discord channels (F-15).
public protocol AnnouncementRepository: Sendable {
    /// Returns how many channels it reached (0 when none are linked).
    func postAnnouncement(_ message: String, to leagueID: LeagueID) async throws(APIError) -> Int
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
