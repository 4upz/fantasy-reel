import Foundation
import Testing
@testable import FantasyReelCore

private enum Draft {
    static let leagueID: LeagueID = "l1"

    static func league(status: LeagueStatus, draftSlots: Int = 3, counterpickSlots: Int = 1) -> League {
        League(
            id: leagueID,
            name: "Office Movie Club",
            ownerID: "u1",
            status: status,
            draftSlots: draftSlots,
            draftCounterpickSlots: counterpickSlots,
            seriesID: "s1",
            seasonYear: 2027,
            seasonEnd: DateOnly(year: 2027, month: 12, day: 31) ?? DateOnly.today(),
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// Members u1…uN with teams t1…tN, in draft order 1…N.
    static func members(_ count: Int) -> [LeagueMember] {
        (1...count).map { position in
            LeagueMember(
                participant: LeagueParticipant(
                    id: ParticipantID("p\(position)"), leagueID: leagueID, userID: UserID("u\(position)"), draftOrder: position
                ),
                team: Team(id: TeamID("t\(position)"), participantID: ParticipantID("p\(position)"), name: "Team \(position)")
            )
        }
    }

    static func pick(_ overall: Int, teams: Int, team: Int, tmdb: Int) -> DraftPickRecord {
        DraftPickRecord(
            id: HoldingID("dp\(overall)"),
            leagueID: leagueID,
            teamID: TeamID("t\(team)"),
            movieID: MovieID("m\(tmdb)"),
            round: (overall - 1) / teams + 1,
            pickNumber: (overall - 1) % teams + 1,
            movie: Movie(id: MovieID("m\(tmdb)"), tmdbID: TMDbID(rawValue: tmdb), title: "Movie \(tmdb)")
        )
    }

    static func counterpick(_ order: Int, by team: Int, against target: Int, movie: Int, phase: CounterpickPhase = .draft) -> DraftCounterpick {
        DraftCounterpick(
            id: CounterpickID("c\(order)"),
            leagueID: leagueID,
            counterpickerTeamID: TeamID("t\(team)"),
            targetTeamID: TeamID("t\(target)"),
            movieID: MovieID("m\(movie)"),
            pickOrder: order,
            phase: phase
        )
    }

    static func snapshot(
        status: LeagueStatus,
        teams: Int = 3,
        draftSlots: Int = 3,
        counterpickSlots: Int = 1,
        picks: [DraftPickRecord] = [],
        counterpicks: [DraftCounterpick] = []
    ) -> DraftSnapshot {
        DraftSnapshot(
            league: league(status: status, draftSlots: draftSlots, counterpickSlots: counterpickSlots),
            participants: members(teams),
            picks: picks,
            counterpicks: counterpicks
        )
    }
}

struct DraftTurnOrderTests {
    @Test func draftSnakesEachRound() {
        let snapshot = Draft.snapshot(status: .drafting, teams: 3, draftSlots: 3)
        let order = (0..<9).compactMap { snapshot.draftTurn(at: $0)?.participant.participant.draftOrder }
        #expect(order == [1, 2, 3, 3, 2, 1, 1, 2, 3])
        #expect(snapshot.draftTurn(at: 9) == nil)
    }

    @Test func counterpickRoundRunsReverseSnake() {
        let snapshot = Draft.snapshot(status: .counterpicking, teams: 3, counterpickSlots: 2)
        let order = (0..<6).compactMap { snapshot.turn(at: $0, rounds: 2, kind: .counterpick)?.participant.participant.draftOrder }
        #expect(order == [3, 2, 1, 1, 2, 3])
    }

    @Test func currentTurnFollowsPicksMade() throws {
        let picks = (1...4).map { Draft.pick($0, teams: 3, team: [1, 2, 3, 3][$0 - 1], tmdb: $0) }
        let snapshot = Draft.snapshot(status: .drafting, picks: picks)
        let turn = try #require(snapshot.currentDraftTurn)
        #expect(turn.overallPick == 5)
        #expect(turn.round == 2)
        #expect(turn.pickNumber == 2)
        #expect(turn.participant.userID == "u2")
        #expect(turn.label == "2.2")
        #expect(snapshot.upcomingDraftTurns(limit: 2).map(\.participant.userID) == ["u1", "u1"])
    }

    @Test func noTurnOutsideTheDraftOrOnAFullBoard() {
        #expect(Draft.snapshot(status: .setup).currentTurn == nil)
        let full = (1...9).map { Draft.pick($0, teams: 3, team: 1, tmdb: $0) }
        let snapshot = Draft.snapshot(status: .drafting, picks: full)
        #expect(snapshot.isDraftBoardFull)
        #expect(snapshot.currentDraftTurn == nil)
        #expect(snapshot.upcomingDraftTurns(limit: 3).isEmpty)
    }

    @Test func seasonBidCounterpicksDontUseDraftSlots() throws {
        let counterpicks = [
            Draft.counterpick(1, by: 3, against: 1, movie: 1),
            Draft.counterpick(1, by: 2, against: 1, movie: 4, phase: .bidding),
        ]
        let snapshot = Draft.snapshot(status: .counterpicking, counterpickSlots: 1, counterpicks: counterpicks)
        #expect(snapshot.counterpicksMade == 1)
        #expect(try #require(snapshot.currentCounterpickTurn).participant.userID == "u2")
        #expect(snapshot.counterpicksRemaining(for: "t3") == 0)
        #expect(snapshot.counterpicksRemaining(for: "t2") == 1)
    }

    @Test func membersWithoutAnOrderSortLast() {
        var members = Draft.members(3)
        members[0].participant.draftOrder = nil
        let snapshot = DraftSnapshot(league: Draft.league(status: .setup), participants: members, picks: [], counterpicks: [])
        #expect(snapshot.orderedParticipants.map(\.userID) == ["u2", "u3", "u1"])
    }
}

struct DraftBoardTests {
    @Test func currentRoundShowsOpenSlotsNewestFirst() throws {
        let picks = (1...4).map { Draft.pick($0, teams: 3, team: 1, tmdb: $0) }
        let rounds = Draft.snapshot(status: .drafting, picks: picks).draftBoardRounds
        #expect(rounds.map(\.round) == [2, 1])
        let current = try #require(rounds.first)
        #expect(current.pickRange == 4...6)
        #expect(current.slots.map { $0.pick != nil } == [true, false, false])
        #expect(current.slots[1].turn?.participant.userID == "u2")
    }

    @Test func afterTheDraftOnlyFilledRoundsShow() {
        let picks = (1...9).map { Draft.pick($0, teams: 3, team: 1, tmdb: $0) }
        let rounds = Draft.snapshot(status: .active, picks: picks).draftBoardRounds
        #expect(rounds.map(\.round) == [3, 2, 1])
    }

    @Test func drafterIsFoundByTMDbID() {
        let snapshot = Draft.snapshot(status: .drafting, picks: [Draft.pick(1, teams: 3, team: 1, tmdb: 42)])
        #expect(snapshot.draftedTMDbIDs == [TMDbID(rawValue: 42)])
        #expect(snapshot.drafter(of: TMDbID(rawValue: 42))?.userID == "u1")
        #expect(snapshot.drafter(of: TMDbID(rawValue: 7)) == nil)
    }
}

struct DraftOwnerActionTests {
    @Test func actionsFollowPhaseAndBoard() {
        #expect(Draft.snapshot(status: .setup).ownerActions(isOwner: true) == [.startDraft, .editOrder])
        #expect(Draft.snapshot(status: .setup).ownerActions(isOwner: false) == [])
        #expect(Draft.snapshot(status: .drafting).ownerActions(isOwner: true) == [])

        let full = (1...9).map { Draft.pick($0, teams: 3, team: 1, tmdb: $0) }
        #expect(Draft.snapshot(status: .drafting, picks: full).ownerActions(isOwner: true) == [.startCounterpicks, .skipCounterpicks])
        #expect(Draft.snapshot(status: .drafting, counterpickSlots: 0, picks: full).ownerActions(isOwner: true) == [.skipCounterpicks])
        #expect(Draft.snapshot(status: .counterpicking).ownerActions(isOwner: true) == [.endCounterpicks])
        #expect(Draft.snapshot(status: .active).ownerActions(isOwner: true) == [])
    }
}

struct DraftAttemptTests {
    private func attempt(_ selection: DraftSelection, at slot: Int) -> DraftAttempt {
        DraftAttempt(leagueID: Draft.leagueID, selection: selection, expectedPick: slot, title: "Movie")
    }

    @Test func retryReusesTheRequestIDOnlyForTheSameSelectionAndSlot() {
        let first = attempt(.movie(TMDbID(rawValue: 1)), at: 4)
        #expect(first.reused(for: .movie(TMDbID(rawValue: 1)), at: 4, title: "Movie").requestID == first.requestID)
        #expect(first.reused(for: .movie(TMDbID(rawValue: 2)), at: 4, title: "Other").requestID != first.requestID)
        #expect(first.reused(for: .movie(TMDbID(rawValue: 1)), at: 5, title: "Movie").requestID != first.requestID)
    }

    @Test func lostDraftPickResolvesAgainstTheBoard() {
        let picks = (1...3).map { Draft.pick($0, teams: 3, team: $0, tmdb: $0) }
        let savedMine = Draft.snapshot(status: .drafting, picks: picks + [Draft.pick(4, teams: 3, team: 3, tmdb: 9)])
        let lost = attempt(.movie(TMDbID(rawValue: 9)), at: 4)
        #expect(lost.resolve(in: savedMine, teamID: "t3") == .saved)

        let takenByOther = Draft.snapshot(status: .drafting, picks: picks + [Draft.pick(4, teams: 3, team: 3, tmdb: 8)])
        #expect(lost.resolve(in: takenByOther, teamID: "t3") == .superseded)

        let stillOpen = Draft.snapshot(status: .drafting, picks: picks)
        #expect(lost.resolve(in: stillOpen, teamID: "t3") == .stillOpen)

        let phaseEnded = Draft.snapshot(status: .active, picks: picks)
        #expect(lost.resolve(in: phaseEnded, teamID: "t3") == .superseded)
    }

    @Test func lostCounterpickResolvesAgainstPickOrder() {
        let mine = Draft.snapshot(status: .counterpicking, counterpicks: [Draft.counterpick(1, by: 3, against: 1, movie: 5)])
        #expect(attempt(.counterpick("m5"), at: 1).resolve(in: mine, teamID: "t3") == .saved)
        #expect(attempt(.counterpick("m6"), at: 1).resolve(in: mine, teamID: "t3") == .superseded)
        #expect(attempt(.counterpick("m6"), at: 2).resolve(in: mine, teamID: "t2") == .stillOpen)
    }

    @Test func requestEncodesTheDraftContract() throws {
        let id = try #require(UUID(uuidString: "E621E1F8-C36C-495A-93FC-0C247A3E6E5F"))
        let pick = DraftAttempt(leagueID: "l1", selection: .movie(TMDbID(rawValue: 550)), expectedPick: 9, requestID: id, title: "X")
        let body = try #require(try FRJSON.decode(JSONValue.self, from: FRJSON.encode(DraftSubmissionRequest(pick))).objectValue)
        #expect(DraftSubmissionRequest(pick).function == "draft-pick")
        #expect(body["league_id"]?.stringValue == "l1")
        #expect(body["tmdb_id"]?.intValue == 550)
        #expect(body["expected_pick"]?.intValue == 9)
        #expect(body["request_id"]?.stringValue == "e621e1f8-c36c-495a-93fc-0c247a3e6e5f")
        #expect(body["movie_id"] == nil)

        let counterpick = DraftAttempt(leagueID: "l1", selection: .counterpick("m1"), expectedPick: 2, requestID: id, title: "X")
        let counterBody = try #require(try FRJSON.decode(JSONValue.self, from: FRJSON.encode(DraftSubmissionRequest(counterpick))).objectValue)
        #expect(DraftSubmissionRequest(counterpick).function == "make-counterpick")
        #expect(counterBody["movie_id"]?.stringValue == "m1")
        #expect(counterBody["tmdb_id"] == nil)
    }
}

struct DraftDecodingTests {
    @Test func decodesPickWithEmbeddedMovie() throws {
        let pick = try decodeJSON(DraftPickRecord.self, """
        {"id":"dp1","league_id":"l1","team_id":"t1","movie_id":"m1","round":2,"pick_number":3,
         "picked_at":"2027-01-10T20:00:00+00:00","dropped_at":null,"counterpicked_by_team_id":null,
         "movies":{"id":"m1","tmdb_id":550,"title":"Fight Club","release_date":"2027-05-07","status":"upcoming"}}
        """)
        #expect(pick.overallPick(teamCount: 4) == 7)
        #expect(pick.movie?.tmdbID == TMDbID(rawValue: 550))
    }

    @Test func decodesCounterpickOptionRPCRow() throws {
        let option = try decodeJSON(CounterpickOption.self, """
        {"draft_pick_id":"dp1","movie_id":"m1","movie_title":"Michael","poster_url":"/p.jpg",
         "release_date":"2026-04-24","owner_team_id":"t2","owner_team_name":"Kubrick's Cube",
         "fantasy_points":null,"source":"draft","pickup_id":null}
        """)
        #expect(option.title == "Michael")
        #expect(option.ownerTeamName == "Kubrick's Cube")
        #expect(option.draftPickID == "dp1")
        #expect(option.fantasyPoints == nil)
    }

    @Test func catalogPageHonoursHasMore() throws {
        let page = try decodeJSON(CatalogPage.self, """
        {"page":2,"total_pages":500,"total_results":10000,"has_more":false,
         "results":[{"tmdb_id":1,"title":"A","release_date":"","poster_url":null,"genre_ids":[16,12]}]}
        """)
        #expect(!page.hasMore)
        #expect(page.results.first?.releaseDate == nil)
        #expect(page.results.first?.primaryGenre == "Animation")
    }
}

struct DraftAnnouncementTests {
    @Test func announcesPickAndTurnChange() {
        let before = Draft.snapshot(status: .drafting)
        let after = Draft.snapshot(status: .drafting, picks: [Draft.pick(1, teams: 3, team: 1, tmdb: 7)])
        #expect(after.changeAnnouncement(since: before, userID: "u2") == "Team 1 drafted Movie 7. It's your turn.")
        #expect(after.changeAnnouncement(since: after, userID: "u2") == nil)
    }

    @Test func announcesPhaseChange() {
        let before = Draft.snapshot(status: .setup)
        #expect(Draft.snapshot(status: .drafting).changeAnnouncement(since: before, userID: "u1") == "The draft has started.")
    }
}
