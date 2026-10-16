import Foundation
@testable import FantasyReelCore

/// Decodes `json` with the app's configured decoder.
func decodeJSON<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try FRJSON.decode(type, from: Data(json.utf8))
}

/// An instant from a known-good ISO 8601 string (test input, so a failure is a test bug).
func instant(_ string: String) -> Date {
    PostgresTimestamp.parse(string) ?? .distantPast
}

func approximatelyEqual(_ lhs: Date?, _ rhs: TimeInterval, tolerance: TimeInterval = 0.0005) -> Bool {
    guard let lhs else { return false }
    return abs(lhs.timeIntervalSince1970 - rhs) < tolerance
}

enum Fixtures {
    /// A `leagues.select('*')` row as PostgREST renders it, every column present.
    static let leagueRowJSON = """
    {
      "id": "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6",
      "name": "League of Culture",
      "owner_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "invite_only": false,
      "draft_start_date": "2026-01-10T20:00:00+00:00",
      "draft_end_date": null,
      "status": "active",
      "max_participants": 8,
      "created_at": "2025-12-01T18:22:41.512893+00:00",
      "updated_at": "2026-10-15T09:00:02.004+00:00",
      "total_slots": 8,
      "draft_slots": 5,
      "drop_limit": 2,
      "counterbid_hours": 24,
      "trades_enabled": true,
      "trade_deadline": "2026-11-30",
      "trade_veto_hours": 24,
      "trade_review_enabled": true,
      "faab_budget": 100,
      "draft_counterpick_slots": 1,
      "bidding_counterpick_slots": 0,
      "counterpicks_block_drops": true,
      "join_code": "CULT2026",
      "join_token": "0d6f7c1e-1111-4222-8333-944455566677",
      "custom_draft_order": true,
      "new_bid_cutoff_hours": 48,
      "trade_offer_expiry_default_hours": null,
      "trade_offer_expiry_min_hours": 12,
      "trade_offer_expiry_max_days": null,
      "series_id": "5e0b1a6d-2c3b-4b4d-8e5f-60718293a4b5",
      "season_year": 2026,
      "season_end": "2026-12-31",
      "completed_at": null,
      "winner_team_ids": null,
      "final_standings": null,
      "double_points_over_90": true
    }
    """

    static func league(
        id: String,
        series: String,
        year: Int,
        status: LeagueStatus,
        name: String = "League",
        created: String
    ) -> League {
        League(
            id: LeagueID(id),
            name: name,
            ownerID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            status: status,
            seriesID: SeriesID(series),
            seasonYear: year,
            seasonEnd: DateOnly(year: year, month: 12, day: 31) ?? DateOnly.today(),
            createdAt: instant(created),
            updatedAt: instant(created)
        )
    }
}
