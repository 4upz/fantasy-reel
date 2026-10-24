import Foundation
import Testing
@testable import FantasyReelCore

struct TradeDecodingTests {
    @Test func getTradesRowDecodesBudgetAndEmbeds() throws {
        let json = """
        {"id":"t1","league_id":"l1","initiator_team_id":"a","recipient_team_id":"b",
         "initiator_items":{"movies":[{"movie_id":"m1","source":"draft_pick","source_id":"h1","title":"Dune","poster_url":null,"release_date":"2026-12-18"}],"faab":5},
         "recipient_items":{"movies":[{"movie_id":"m2","source":"counterpick","source_id":"c1"}],"faab":0},
         "status":"countered","proposed_at":"2026-10-15T12:00:00+00:00","responded_at":null,"accepted_at":null,
         "review_ends_at":null,"completed_at":null,"initiator_message":"Swap?","response_message":null,
         "veto_reason":null,"expires_at":"2026-10-18T12:00:00Z","expiry_anchor":"fixed","expired_reason":null,
         "created_at":"2026-10-15T12:00:00Z","updated_at":"2026-10-15T12:00:00Z",
         "initiator_team":{"id":"a","name":"Popcorn Syndicate","avatar_url":null},
         "recipient_team":{"id":"b","name":"Nolan's Notebook","avatar_url":null},
         "contested_source_ids":["h1"],"anchor_movie_title":null}
        """
        let offer = try FRJSON.decode(TradeOffer.self, from: Data(json.utf8))
        #expect(offer.status == .countered)
        #expect(offer.initiatorItems.budget == 5)
        #expect(offer.initiatorItems.movies.first?.releaseDate == DateOnly(year: 2026, month: 12, day: 18))
        #expect(offer.recipientItems.movies.first?.isCounterpick == true)
        #expect(offer.recipientItems.movies.first?.displayTitle == "Unknown Movie")
        #expect(offer.isContested)
        #expect(offer.initiatorName == "Popcorn Syndicate")
    }

    @Test func requestItemsSendOnlyIdsAndCallBudgetFaab() throws {
        let items = TradeItems(movies: [TradeMovieItem(movieID: "m1", source: .pickup, sourceID: "h1", title: "Dune")], budget: 3)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(items)) as? [String: Any]
        #expect(object?["faab"] as? Int == 3)
        let movie = (object?["movies"] as? [[String: Any]])?.first
        #expect(movie?.keys.sorted() == ["movie_id", "source", "source_id"])
    }

    @Test func expiredReasonCopyFallsBackToTheVetoReason() {
        #expect(TradeExpiredReason.movieReleased.copy(anchorMovieTitle: "Dune") == "Dune released")
        #expect(TradeExpiredReason.movieReleased.copy(anchorMovieTitle: nil) == "Its first movie released")
        #expect(TradeExpiredReason.unknown("x").copy(anchorMovieTitle: nil) == nil)
    }
}

struct TradeRuleTests {
    private func offer(_ status: TradeStatus, from: TeamID = "a", to: TeamID = "b", expires: Date? = nil) -> TradeOffer {
        TradeOffer(
            id: TradeOfferID(UUID().uuidString), leagueID: "l", initiatorTeamID: from, recipientTeamID: to,
            initiatorItems: TradeItems(budget: 1), recipientItems: TradeItems(), status: status,
            proposedAt: Date(), expiresAt: expires
        )
    }

    @Test func permissionsFollowTheCurrentRow() {
        let proposed = offer(.proposed, expires: Date())
        #expect(TradePermissions(offer: proposed, myTeamID: "b", isCommissioner: false).canRespond)
        #expect(!TradePermissions(offer: proposed, myTeamID: "b", isCommissioner: false).canCancel)
        #expect(TradePermissions(offer: proposed, myTeamID: "a", isCommissioner: false).canCancel)
        #expect(TradePermissions(offer: proposed, myTeamID: "a", isCommissioner: false).canExtend)
        #expect(!TradePermissions(offer: offer(.proposed), myTeamID: "a", isCommissioner: false).canExtend)
        #expect(TradePermissions(offer: offer(.review), myTeamID: "z", isCommissioner: true).canReview)
        #expect(!TradePermissions(offer: offer(.accepted), myTeamID: "z", isCommissioner: true).hasAny)
    }

    @Test func listsSplitOpenMineAndHistory() {
        let trades = [offer(.proposed), offer(.review, from: "c", to: "d"), offer(.accepted), offer(.completed), offer(.expired)]
        #expect(TradeLists.pending(trades).count == 2, "accepted waits on the cron and is in no list")
        #expect(TradeLists.history(trades).count == 2)
        #expect(TradeLists.needingResponse(trades, teamID: "b").count == 1)
    }

    @Test func pendingIncludesMyOwnOffersGroupedByWhoActsNext() {
        let incoming = offer(.proposed, from: "b", to: "a")
        let outgoing = offer(.proposed, from: "a", to: "c")
        let myReview = offer(.review, from: "a", to: "d")
        let othersReview = offer(.review, from: "c", to: "d")
        let trades = [incoming, outgoing, myReview, othersReview, offer(.accepted, from: "a"), offer(.completed, from: "a")]

        let player = TradeLists.pendingForViewer(trades, teamID: "a", isCommissioner: false)
        #expect(player.needsAnswer == [incoming])
        #expect(player.needsReview.isEmpty)
        #expect(player.waiting == [outgoing, myReview], "a new offer I sent shows while it waits")
        #expect(player.actionCount == 1)

        let commissioner = TradeLists.pendingForViewer(trades, teamID: "a", isCommissioner: true)
        #expect(commissioner.needsReview == [myReview, othersReview])
        #expect(commissioner.waiting == [outgoing])
        #expect(commissioner.actionCount == 3)

        #expect(TradeLists.pendingForViewer(trades, teamID: nil, isCommissioner: false).isEmpty)
    }
}

struct TradeExpiryTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func presetsStayInsideTheLeagueWindow() {
        #expect(TradeExpiryBounds().presets == [24, 48, 72, 168])
        #expect(TradeExpiryBounds(defaultHours: 12, maxDays: 2).presets == [12, 24, 48])
        #expect(TradeExpiryBounds.label(hours: 72) == "3 days")
        #expect(TradeExpiryBounds.label(hours: 48) == "48h")
    }

    @Test func extendPresetsStopAtTheMaximumFromNow() {
        let bounds = TradeExpiryBounds(maxDays: 3)
        let current = now.addingTimeInterval(36 * 3600)
        #expect(bounds.extendPresets(currentExpiry: current, now: now) == [12, 24])
    }

    @Test func releaseAnchorWaitsForTheDayAfterReleaseUTC() throws {
        let release = try #require(DateOnly(year: 2027, month: 1, day: 10))
        let boundary = TradeExpiry.releaseBoundary(release)
        #expect(boundary == DateOnly(year: 2027, month: 1, day: 11)?.date(in: .gmt))
        let movies: [(movieID: MovieID, title: String, releaseDate: DateOnly?)] = [("m1", "Far", DateOnly(year: 2027, month: 6, day: 1))]
        let result = TradeExpiry.releaseCandidates(movies, bounds: TradeExpiryBounds(), now: boundary.addingTimeInterval(-3 * 86_400))
        #expect(throws: TradeExpiry.ReleaseUnavailable.tooFar("14 days")) { try result.get() }
    }

    @Test func aReleaseChoiceThatLeftTheTradeIsRefused() throws {
        let release = try #require(DateOnly(year: 2027, month: 1, day: 10))
        let bounds = TradeExpiryBounds(maxDays: 30)
        let now = TradeExpiry.releaseBoundary(release).addingTimeInterval(-5 * 86_400)
        let movies: [(movieID: MovieID, title: String, releaseDate: DateOnly?)] = [("m1", "Dune", release)]
        let candidates = TradeExpiry.releaseCandidates(movies, bounds: bounds, now: now)
        let gone = TradeExpiry.resolve(.release(movieID: "m2"), candidates: candidates, bounds: bounds, now: now)
        #expect(throws: TradeExpiry.ResolveError.release(.choiceUnavailable)) { try gone.get() }
        let soonest = TradeExpiry.resolve(.release(movieID: nil), candidates: candidates, bounds: bounds, now: now)
        #expect((try? soonest.get())?.anchorMovieID == "m1")
    }

    @Test func customTimesMustRespectTheMinimumWindow() {
        let bounds = TradeExpiryBounds()
        let tooSoon = TradeExpiry.resolve(.custom(now.addingTimeInterval(30 * 60)), candidates: .failure(.noMovies), bounds: bounds, now: now)
        #expect((try? tooSoon.get()) == nil)
        let fine = TradeExpiry.resolve(.preset(hours: 48), candidates: .failure(.noMovies), bounds: bounds, now: now)
        #expect((try? fine.get())?.anchor == "fixed")
        #expect((try? TradeExpiry.resolve(.none, candidates: .failure(.noMovies), bounds: bounds, now: now).get()) == .noExpiry)
    }

    @Test func theMinimumWindowAllowsTheServersMinuteOfGrace() {
        let bounds = TradeExpiryBounds()
        let chosen = now.addingTimeInterval(60 * 60)
        // Picked at exactly the minimum, sent 30 seconds later: the server still takes it.
        let sentLater = TradeExpiry.resolve(.custom(chosen), candidates: .failure(.noMovies), bounds: bounds, now: now.addingTimeInterval(30))
        #expect((try? sentLater.get())?.expiresAt == chosen)
        let tooLate = TradeExpiry.resolve(.custom(chosen), candidates: .failure(.noMovies), bounds: bounds, now: now.addingTimeInterval(120))
        #expect(throws: TradeExpiry.ResolveError.tooSoon(bounds.minWindowText)) { try tooLate.get() }
    }
}
