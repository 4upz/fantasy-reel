import Foundation
import Testing
@testable import FantasyReelCore

struct GrowthStatsTests {
    @Test func decodesTheRPCDocument() throws {
        let stats = try decodeJSON(GrowthStats.self, """
        {"generated_at":"2026-10-17T12:00:00Z",
         "users":{"total":120,"new_30d":14,"active_7d":30,"active_30d":61},
         "leagues":{"total":22,"new_30d":3},
         "rosters":{"holdings":180,"drafted":150,"picked_up":30},
         "monthly":[{"month":"2026-09-01","signups":10,"leagues":2}],
         "growth":[{"week":"2026-10-12","users":120,"leagues":22}],
         "league_funnel":{"created":22,"invited":18,"second_player":15,"drafted":12,"live":9},
         "user_funnel":{"in_league":90,"with_others":80,"drafted":60},
         "activity":{"draft_picks":{"total":150,"last_30d":20},"pickups":{"total":30,"last_30d":4},
           "bids":{"total":70,"last_30d":9},"counterpicks":{"total":12,"last_30d":1},
           "trades_proposed":{"total":8,"last_30d":2},"trades_completed":{"total":5,"last_30d":1}},
         "league_list":[{"id":"l1","name":"Popcorn Syndicate","owner":"Alice","status":"active","season_year":2026,
           "players":5,"max_players":8,"invited":true,"created_at":"2026-01-02T00:00:00Z"}],
         "recent_users":[{"id":"u1","display_name":null,"provider":"discord","signed_up_at":"2026-10-16T00:00:00Z",
           "last_active_at":null,"leagues":0}]}
        """)
        #expect(stats.users.active30d == 61)
        #expect(stats.monthly.first?.month == DateOnly(year: 2026, month: 9, day: 1))
        #expect(stats.activity.rows.map(\.label).first == "Draft picks")
        #expect(stats.leagueList.first?.status == .active)
        #expect(stats.recentUsers.first?.displayName == nil)
    }
}
