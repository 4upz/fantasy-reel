import Foundation
import Testing
@testable import FantasyReelCore

struct IdentifierTests {
    @Test func codesAsBareValues() throws {
        struct Row: Codable, Equatable {
            var team_id: TeamID
            var tmdb_id: TMDbID
        }
        let row = try decodeJSON(Row.self, #"{"team_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","tmdb_id":550}"#)
        #expect(row.team_id == TeamID("a1b2c3d4-e5f6-7890-abcd-ef1234567890"))
        #expect(row.tmdb_id == TMDbID(550))
        #expect(row.tmdb_id.description == "550")
        let encoded = try #require(String(data: try FRJSON.encode(row), encoding: .utf8))
        #expect(encoded.contains(#""team_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890""#))
        #expect(encoded.contains(#""tmdb_id":550"#))
    }

    @Test func hashesByRawValue() {
        let ids = Set(["a", "a", "b"].map { HoldingID($0) })
        #expect(ids.count == 2)
        let literal: LeagueID = "x"
        #expect(literal.description == "x")
    }
}

struct WireEnumTests {
    @Test func leagueStatusDecodesKnownAndUnknown() throws {
        let statuses = try decodeJSON([LeagueStatus].self, #"["setup","drafting","counterpicking","active","completed","paused"]"#)
        #expect(statuses == [.setup, .drafting, .counterpicking, .active, .completed, .unknown("paused")])
        #expect(statuses.last?.displayName == "Unknown")
        #expect(statuses.map(\.isPreseason) == [true, true, true, false, false, false])
        let encoded = try #require(String(data: try FRJSON.encode(statuses), encoding: .utf8))
        #expect(encoded == #"["setup","drafting","counterpicking","active","completed","paused"]"#)
    }

    @Test func displayNames() {
        #expect(LeagueStatus.knownCases.map(\.displayName) == ["Setup", "Drafting", "Counterpicking", "Active", "Completed"])
    }

    @Test func notificationTypeCoversDatabaseEnum() throws {
        let raw = ["outbid", "bid_won", "bid_lost", "pickup_available", "trade_proposed", "trade_countered",
                   "trade_accepted", "trade_rejected", "trade_cancelled", "trade_completed", "trade_vetoed",
                   "trade_review", "season_completed", "season_started", "league_ownership_transferred"]
        for value in raw {
            let type = NotificationType(rawValue: value)
            #expect(type != .unknown(value), "\(value)")
            #expect(type.rawValue == value)
        }
        #expect(NotificationType(rawValue: "draft_turn") == .unknown("draft_turn"))
    }
}

struct LeagueDecodingTests {
    @Test func decodesFullSelectStarRow() throws {
        let league = try decodeJSON(League.self, Fixtures.leagueRowJSON)
        #expect(league.id == LeagueID("6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6"))
        #expect(league.name == "League of Culture")
        #expect(league.status == .active)
        #expect(league.seriesID == SeriesID("5e0b1a6d-2c3b-4b4d-8e5f-60718293a4b5"))
        #expect(league.seasonYear == 2026)
        #expect(league.seasonEnd == DateOnly("2026-12-31"))
        #expect(league.tradeDeadline == DateOnly("2026-11-30"))
        #expect(approximatelyEqual(league.draftStartDate, instant("2026-01-10T20:00:00Z").timeIntervalSince1970))
        #expect(league.draftEndDate == nil)
        #expect(league.doublePointsOver90)
        #expect(league.customDraftOrder)
        #expect(league.tradeOfferExpiryMinHours == 12)
        #expect(league.tradeOfferExpiryDefaultHours == nil)
        #expect(league.joinCode == "CULT2026")
        #expect(league.finalStandings == nil)
        #expect(league.isOwned(by: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"))
        #expect(!league.isOwned(by: nil))
    }

    @Test func partialSelectFallsBackToSchemaDefaults() throws {
        let json = """
        {"id":"l1","name":"Old","owner_id":"u1","status":"setup","series_id":"s1",
         "season_year":2025,"season_end":"2025-12-31","created_at":"2025-01-01T00:00:00+00:00"}
        """
        let league = try decodeJSON(League.self, json)
        #expect(league.totalSlots == 8)
        #expect(league.draftSlots == 5)
        #expect(league.dropLimit == 2)
        #expect(league.counterbidHours == 24)
        #expect(league.newBidCutoffHours == 48)
        #expect(league.faabBudget == 100)
        #expect(league.draftCounterpickSlots == 1)
        #expect(league.biddingCounterpickSlots == 0)
        #expect(league.counterpicksBlockDrops)
        #expect(!league.doublePointsOver90)
        #expect(league.tradesEnabled)
        #expect(league.tradeReviewEnabled)
        #expect(league.tradeVetoHours == 24)
        #expect(league.maxParticipants == 8)
        #expect(league.updatedAt == league.createdAt)
    }

    @Test func decodesCompletedSeasonSnapshot() throws {
        let json = """
        {"id":"l1","name":"Done","owner_id":"u1","status":"completed","series_id":"s1",
         "season_year":2025,"season_end":"2025-12-31","created_at":"2025-01-01T00:00:00+00:00",
         "completed_at":"2026-01-01T09:00:01.25+00:00",
         "winner_team_ids":["t1","t2"],
         "final_standings":[
           {"team_id":"t1","team_name":"Aces","participant_id":"p1","user_id":"u1","total_points":87.5,"rank":1,"is_tied":true,"display_name":"Alice"},
           {"team_id":"t2","team_name":"Hunters","participant_id":"p2","user_id":"u2","total_points":"87.50","rank":1,"is_tied":true,"display_name":"Former member"},
           {"team_id":"t3","team_name":"Reels","participant_id":"p3","user_id":"u3","total_points":-16.25,"rank":3,"is_tied":false,"display_name":null}
         ]}
        """
        let league = try decodeJSON(League.self, json)
        #expect(league.isCompleted)
        #expect(league.winnerTeamIDs == ["t1", "t2"])
        let standings = try #require(league.finalStandings)
        #expect(standings.map(\.rank) == [1, 1, 3])
        #expect(standings[1].totalPoints == 87.5)
        #expect(standings[1].displayName == "Former member")
        #expect(standings[2].displayName == nil)
        #expect(standings[2].standing.totalPoints == -16.25)
        #expect(league.seasonSummary.winnerTeamIDs == ["t1", "t2"])
    }

    @Test func standingRowFromRPC() throws {
        let rows = try decodeJSON([StandingRow].self, """
        [{"team_id":"t1","team_name":"Aces","participant_id":"p1","user_id":"u1","total_points":0,"rank":1,"is_tied":false}]
        """)
        #expect(rows.first?.totalPoints == 0)
        #expect(rows.first?.id == TeamID("t1"))
    }
}

struct RosterDecodingTests {
    static let holdingsJSON = """
    [
      {"holding_id":"d1","source":"draft","league_id":"l1","team_id":"t1","movie_id":"m1",
       "acquired_at":"2026-01-10T20:05:11.000123+00:00","counterpicked_by_team_id":"t2",
       "counterpicked_by_name":"Hunters","round":1,"pick_number":3,"bid_id":null,"amount_paid":null,
       "team_name":"Aces","tmdb_id":550,"title":"The Long Take","release_date":"2026-10-16",
       "poster_url":"/abc.jpg","movie_status":"upcoming","imdb_id":"tt0000001",
       "combined_score":96.00,"fantasy_points":42.00,"overview":null,"backdrop_url":null,
       "vote_average":7.5,"vote_count":120,"popularity":33.125,"scoring_bonuses":{"double":6},
       "scores_updated_at":"2026-10-15T04:00:00+00:00"},
      {"holding_id":"p9","source":"pickup","league_id":"l1","team_id":"t1","movie_id":"m2",
       "acquired_at":"2026-03-02T20:00:00+00:00","counterpicked_by_team_id":null,
       "counterpicked_by_name":null,"round":null,"pick_number":null,"bid_id":"b7","amount_paid":14,
       "team_name":"Aces","tmdb_id":551,"title":"Pending Picture","release_date":null,
       "poster_url":null,"movie_status":"rescheduled","imdb_id":null,"combined_score":null,
       "fantasy_points":null,"overview":"Soon.","backdrop_url":null,"vote_average":null,
       "vote_count":null,"popularity":null,"scoring_bonuses":null,"scores_updated_at":null}
    ]
    """

    @Test func decodesBothLegsOfTheView() throws {
        let holdings = try decodeJSON([TeamHolding].self, Self.holdingsJSON)
        #expect(holdings.count == 2)

        let drafted = holdings[0]
        #expect(drafted.source == .draft)
        #expect(drafted.source.baseTableName == "draft_pick")
        #expect(drafted.id == HoldingID("d1"))
        #expect(drafted.round == 1 && drafted.pickNumber == 3)
        #expect(drafted.tmdbID == 550)
        #expect(drafted.releaseDate == DateOnly("2026-10-16"))
        #expect(drafted.fantasyPoints == 42)
        #expect(drafted.isCounterpicked)
        #expect(drafted.scoringBonuses?["double"]?.intValue == 6)
        #expect(drafted.isScoreLocked)
        #expect(drafted.isPreReleaseScore(now: instant("2026-10-15T12:00:00Z")))
        #expect(!drafted.isPreReleaseScore(now: instant("2026-10-16T00:00:00Z")))

        let pickup = holdings[1]
        #expect(pickup.source == .pickup)
        #expect(pickup.bidID == BidID("b7"))
        #expect(pickup.amountPaid == 14)
        #expect(pickup.movieStatus == .unknown("rescheduled"))
        #expect(pickup.fantasyPoints == nil)
        #expect(!pickup.isScoreLocked)
        #expect(!pickup.isPreReleaseScore(now: instant("2026-10-15T12:00:00Z")))
    }

    @Test func decodesMovieRow() throws {
        let movie = try decodeJSON(Movie.self, """
        {"id":"m1","tmdb_id":550,"imdb_id":null,"title":"X","overview":null,"release_date":"2026-05-01",
         "poster_url":null,"backdrop_url":null,"popularity":"12.500","vote_average":7.1,"vote_count":10,
         "status":"released","combined_score":60,"fantasy_points":0,"scores_updated_at":null,
         "last_synced_at":"2026-05-02T00:00:00Z","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-05-02T00:00:00Z"}
        """)
        #expect(movie.status == .released)
        #expect(movie.popularity == 12.5)
        // Zero is a real score (and locks the movie), not "pending".
        #expect(movie.fantasyPoints == 0)
        #expect(FantasyPoints.isScoreLocked(movie.fantasyPoints))
    }

    @Test func decodesParticipantTeamAndProfile() throws {
        let participant = try decodeJSON(LeagueParticipant.self, """
        {"id":"p1","league_id":"l1","user_id":"u1","role":"commissioner","status":"left","draft_order":null,
         "joined_at":"2026-01-01T00:00:00+00:00","created_at":"2026-01-01T00:00:00+00:00","updated_at":"2026-01-01T00:00:00+00:00"}
        """)
        #expect(participant.role == .unknown("commissioner"))
        #expect(participant.status == .left)
        #expect(participant.draftOrder == nil)

        let team = try decodeJSON(Team.self, #"{"id":"t1","participant_id":"p1","name":"Aces","avatar_url":null}"#)
        #expect(team.avatarURL == nil)

        let profile = try decodeJSON(Profile.self, #"{"id":"pr1","user_id":"u1","display_name":"Former member","avatar_url":null}"#)
        #expect(!profile.wishlistPublic)
        #expect(profile.displayName == "Former member")
    }
}

struct NotificationDecodingTests {
    @Test func unknownTypeStillDecodes() throws {
        let rows = try decodeJSON([AppNotification].self, """
        [{"id":"n1","user_id":"u1","league_id":"6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6","type":"draft_turn_reminder",
          "title":"Your pick","body":"You're up.","data":{"pick":4},"read_at":null,"created_at":"2026-10-16T01:00:00.123456+00:00"},
         {"id":"n2","user_id":"u1","league_id":null,"type":"outbid","title":"Outbid","body":"b","data":null,
          "read_at":"2026-10-16T02:00:00+00:00","created_at":"2026-10-16T01:00:00+00:00"}]
        """)
        #expect(rows[0].type == .unknown("draft_turn_reminder"))
        #expect(rows[0].isUnread)
        #expect(rows[0].data?["pick"]?.intValue == 4)
        #expect(rows[0].destination == .league("6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6", section: nil))
        #expect(rows[1].type == .outbid)
        #expect(!rows[1].isUnread)
        #expect(rows[1].data == nil)
        #expect(rows[1].destination == nil)
    }

    @Test func destinationsMatchTheWebBell() {
        let league: LeagueID = "l1"
        func destination(_ type: NotificationType) -> DeepLink? {
            AppNotification(id: "n", userID: "u", leagueID: league, type: type, title: "", body: "", createdAt: Date())
                .destination
        }
        #expect(destination(.outbid) == .league(league, section: .bidding))
        #expect(destination(.bidWon) == .league(league, section: .roster))
        #expect(destination(.seasonCompleted) == .league(league, section: .standings))
        #expect(destination(.seasonStarted) == .league(league, section: .overview))
        #expect(destination(.leagueOwnershipTransferred) == .league(league, section: .settings))
        #expect(destination(.tradeProposed) == .league(league, section: nil))
    }

    @Test func invitationWithEmbeddedLeague() throws {
        let invitations = try decodeJSON([Invitation].self, """
        [{"id":"i1","league_id":"l1","invited_by":"u2","email":"alice@fantasyreel.test","token":"tok-1",
          "status":"pending","sent_at":"2026-10-10T00:00:00+00:00","expires_at":"2026-10-17T00:00:00+00:00",
          "responded_at":null,"created_at":"2026-10-10T00:00:00+00:00","updated_at":"2026-10-10T00:00:00+00:00",
          "leagues":{"id":"l1","name":"League of Culture","status":"setup","owner_id":"u2"}},
         {"id":"i2","league_id":"l2","invited_by":"u2","email":"alice@fantasyreel.test","token":"tok-2",
          "status":"pending","sent_at":null,"expires_at":null,"responded_at":null,"leagues":null}]
        """)
        #expect(invitations[0].league?.name == "League of Culture")
        #expect(invitations[0].league?.status == .setup)
        #expect(invitations[0].isOpen(now: instant("2026-10-16T00:00:00Z")))
        #expect(!invitations[0].isOpen(now: instant("2026-10-18T00:00:00Z")))
        #expect(invitations[1].league == nil)
    }
}
