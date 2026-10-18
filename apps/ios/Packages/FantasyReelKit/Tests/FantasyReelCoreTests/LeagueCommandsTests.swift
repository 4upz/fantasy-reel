import Foundation
import Testing
@testable import FantasyReelCore

/// Encodes `value` and reads it back as a loose JSON object.
private func jsonObject(_ value: some Encodable) throws -> [String: JSONValue] {
    let data = try FRJSON.encode(value)
    return try #require(try FRJSON.decode(JSONValue.self, from: data).objectValue)
}

struct LeagueMemberTests {
    @Test func decodesParticipantWithEmbeds() throws {
        let member = try decodeJSON(LeagueMember.self, """
        {"id":"p1","league_id":"l1","user_id":"u1","role":"owner","status":"active","draft_order":2,
         "joined_at":"2026-01-02T03:04:05+00:00",
         "teams":{"id":"t1","participant_id":"p1","name":"Reel Deal","avatar_url":null},
         "profiles":{"id":"pr1","user_id":"u1","display_name":"Alice Spielberg"}}
        """)
        #expect(member.id == ParticipantID("p1"))
        #expect(member.participant.role == .owner)
        #expect(member.participant.draftOrder == 2)
        #expect(member.team?.name == "Reel Deal")
        #expect(member.displayName == "Alice Spielberg")
        #expect(member.teamName == "Reel Deal")
    }

    @Test func missingEmbedsFallBack() throws {
        let member = try decodeJSON(LeagueMember.self, """
        {"id":"p2","league_id":"l1","user_id":"u2","teams":null,"profiles":null}
        """)
        #expect(member.team == nil)
        #expect(member.displayName == "Former member")
        #expect(member.teamName == "Former member")
    }

    @Test func roundTripsThroughEncoding() throws {
        let member = LeagueMember(
            participant: LeagueParticipant(id: "p1", leagueID: "l1", userID: "u1", draftOrder: 1),
            team: Team(id: "t1", participantID: "p1", name: "Reel Deal")
        )
        let decoded = try FRJSON.decode(LeagueMember.self, from: try FRJSON.encode(member))
        #expect(decoded == member)
    }

    @Test func sortsByDraftOrderThenJoinTime() {
        func member(_ id: String, order: Int?, joined: String) -> LeagueMember {
            LeagueMember(participant: LeagueParticipant(
                id: ParticipantID(id), leagueID: "l1", userID: UserID(id), draftOrder: order, joinedAt: instant(joined)
            ))
        }
        let sorted = [
            member("late", order: nil, joined: "2026-01-03T00:00:00Z"),
            member("second", order: 2, joined: "2026-01-01T00:00:00Z"),
            member("early", order: nil, joined: "2026-01-02T00:00:00Z"),
            member("first", order: 1, joined: "2026-01-04T00:00:00Z"),
        ].sortedByDraftOrder()
        #expect(sorted.map(\.id.rawValue) == ["first", "second", "early", "late"])
    }
}

struct LeagueCommandTests {
    @Test func createOmitsDefaults() throws {
        let body = try jsonObject(CreateLeagueRequest(name: "Popcorn Syndicate", teamName: "Reel Deal", totalSlots: 10))
        #expect(body["name"] == "Popcorn Syndicate")
        #expect(body["team_name"] == "Reel Deal")
        #expect(body["invite_only"] == false)
        #expect(body["total_slots"] == 10)
        #expect(body["draft_slots"] == nil)
    }

    @Test func joinSendsExactlyOneRoute() throws {
        let code = try jsonObject(JoinLeagueRequest(route: .code("ABCD2345"), teamName: "Reel Deal"))
        #expect(code == ["join_code": "ABCD2345", "team_name": "Reel Deal"])
        let token = try jsonObject(JoinLeagueRequest(route: .invitation(token: "tok")))
        #expect(token == ["invitation_token": "tok"])
    }

    @Test func updateCarriesActionAndFields() throws {
        let league = LeagueID("l1")
        #expect(try jsonObject(LeagueUpdateRequest(leagueID: league, update: .completeSeason))
            == ["action": "complete_league", "league_id": "l1"])
        #expect(try jsonObject(LeagueUpdateRequest(leagueID: league, update: .info(name: "New Name")))
            == ["action": "update_info", "league_id": "l1", "name": "New Name"])
        #expect(try jsonObject(LeagueUpdateRequest(leagueID: league, update: .reorderDraft(["p2", "p1"])))
            == ["action": "reorder_participants", "league_id": "l1", "participant_order": ["p2", "p1"]])
        #expect(try jsonObject(LeagueUpdateRequest(leagueID: league, update: .season(end: DateOnly(year: 2026, month: 12, day: 31)!)))
            == ["action": "update_season_config", "league_id": "l1", "season_end": "2026-12-31"])
    }

    @Test func tradeSettingsSendExplicitNulls() throws {
        let settings = TradeSettings(
            tradesEnabled: true, tradeDeadline: nil, reviewEnabled: false, reviewHours: 0,
            expiryDefaultHours: 72, expiryMinHours: nil, expiryMaxDays: nil
        )
        let body = try jsonObject(LeagueUpdateRequest(leagueID: "l1", update: .trades(settings)))
        #expect(body["action"] == "update_trade_config")
        #expect(body["trade_deadline"] == .null)
        #expect(body["trade_offer_expiry_min_hours"] == .null)
        #expect(body["trade_offer_expiry_default_hours"] == 72)
        #expect(body["trade_review_enabled"] == false)
    }

    @Test func membershipResultToleratesPartialSuccess() throws {
        let joined = try decodeJSON(LeagueMembershipResult.self, """
        {"participant":{"id":"p1","league_id":"l1","user_id":"u1"},
         "league":{"id":"l1","name":"Popcorn Syndicate"},
         "warning":"Joined league but failed to create team"}
        """)
        #expect(joined.leagueID == LeagueID("l1"))
        #expect(joined.team == nil)
        #expect(joined.warning != nil)
    }

    @Test func nextSeasonDecodes() throws {
        let next = try decodeJSON(NextSeason.self, #"{"league_id":"l2","season_year":2027}"#)
        #expect(next == NextSeason(leagueID: "l2", seasonYear: 2027, wasCreated: true))
    }
}
