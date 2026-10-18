import Foundation
import Testing
@testable import FantasyReelCore

struct PushTests {
    private let league = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6"

    @Test func everyKnownTypeHasACategory() {
        let raw = ["outbid", "bid_won", "bid_lost", "pickup_available", "trade_proposed", "trade_countered",
                   "trade_accepted", "trade_rejected", "trade_cancelled", "trade_completed", "trade_vetoed",
                   "trade_review", "season_completed", "season_started", "league_ownership_transferred",
                   "draft_turn", "movie_scored", "movie_released", "league_movie_scored"]
        for value in raw {
            #expect(PushCategory.category(for: NotificationType(rawValue: value)) != nil, "\(value)")
        }
        #expect(PushCategory.category(for: .unknown("new_thing")) == nil)
        #expect(PushCategory.category(for: .draftTurn) == .draft)
        #expect(PushCategory.category(for: .tradeReview) == .trades)
        #expect(PushCategory.category(for: .movieReleased) == .myMovies)
        #expect(PushCategory.category(for: .leagueMovieScored) == .leagueActivity)
        #expect(PushCategory.category(for: .leagueOwnershipTransferred) == .season)
    }

    @Test func preferencesUseTheServerColumns() throws {
        var preferences = PushPreferences.allOn
        preferences[.leagueActivity] = false
        let json = String(decoding: try JSONEncoder().encode(preferences), as: UTF8.self)
        #expect(json.contains(#""league_activity":false"#))
        #expect(json.contains(#""my_movies":true"#))
        #expect(PushCategory.allCases.map(\.rawValue) == ["draft", "bids", "trades", "my_movies", "league_activity", "season"])

        let decoded = try JSONDecoder().decode(PushPreferences.self, from: Data(json.utf8))
        #expect(decoded == preferences)
        #expect(!decoded[.leagueActivity])
    }

    @Test func aTapOpensWhereTheInboxWould() {
        let outbid = PushPayload(userInfo: ["type": "outbid", "league_id": league.uppercased(), "notification_id": "n1"])
        #expect(outbid?.destination == .league(LeagueID(league), section: .bidding))
        #expect(outbid?.notificationID == "n1")

        let turn = PushPayload(userInfo: ["type": "draft_turn", "league_id": league, "aps": ["badge": 1]])
        #expect(turn?.destination == .league(LeagueID(league), section: .draft))

        // No league, or one that isn't a UUID: the inbox.
        #expect(PushPayload(userInfo: ["type": "outbid"])?.destination == .notifications)
        #expect(PushPayload(userInfo: ["type": "outbid", "league_id": "../settings"])?.destination == .notifications)

        // Not one of ours.
        #expect(PushPayload(userInfo: ["aps": ["alert": "hi"]]) == nil)
    }

    @Test func tokensAreLowercaseHex() {
        #expect(PushToken.hex(Data([0x00, 0xAB, 0x10, 0xFF])) == "00ab10ff")
    }
}
