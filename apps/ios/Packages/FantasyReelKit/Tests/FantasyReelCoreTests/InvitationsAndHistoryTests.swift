import Foundation
import Testing
@testable import FantasyReelCore

struct JoinCodeTests {
    @Test func normalizesLikeTheWeb() {
        #expect(JoinCode.normalize(" k7mp-q2 xw ") == "K7MPQ2XW")
        #expect(JoinCode.normalize("abc0de") == "ABC0DE")
    }

    @Test func validatesLengthAndAlphabet() {
        #expect(JoinCode.isValid("K7MPQ2XW"))
        #expect(JoinCode.isValid("K7MPQ2"))
        #expect(!JoinCode.isValid("K7MPQ2X"))
        #expect(!JoinCode.isValid("K7MPQ2X0"))
        #expect(!JoinCode.isValid("ILO1ABCD"))
    }

    @Test func parsesPastedLinks() {
        #expect(JoinCode.parse("k7mp q2xw") == .code("K7MPQ2XW"))
        #expect(JoinCode.parse("https://fantasyreel.com/join?code=k7mpq2xw") == .code("K7MPQ2XW"))
        #expect(JoinCode.parse("fantasyreel.com/join?code=K7MPQ2XW") == .code("K7MPQ2XW"))
        #expect(JoinCode.parse("https://fantasyreel.com/join?token=abc-123") == .invitation(token: "abc-123"))
    }

    @Test func buildsShareLinks() {
        let site = URL(string: "https://fantasyreel.com")!
        #expect(JoinCode.shareURL(code: "K7MPQ2XW", siteURL: site).absoluteString == "https://fantasyreel.com/join?code=K7MPQ2XW")
        #expect(JoinCode.invitationURL(token: "t", siteURL: site).absoluteString == "https://fantasyreel.com/join?token=t")
    }
}

struct InvitationTests {
    @Test func decodesPendingWithLeague() throws {
        let invitation = try decodeJSON(PendingInvitation.self, """
        {"id":"i1","league_id":"l1","token":"tok","sent_at":"2026-10-01T00:00:00Z",
         "expires_at":"2026-10-08T00:00:00Z","leagues":{"id":"l1","name":"Film Twitter Refugees","status":"setup","owner_id":"u9"}}
        """)
        #expect(invitation.leagueName == "Film Twitter Refugees")
        // Rounded up, like the web's getDaysUntil.
        #expect(invitation.daysLeft(now: instant("2026-10-06T12:00:00Z")) == 2)
        #expect(invitation.daysLeft(now: instant("2026-10-07T12:00:00Z")) == 1)
        #expect(invitation.daysLeft(now: instant("2026-10-08T00:00:00Z")) == 0)
        #expect(invitation.daysLeft(now: instant("2026-10-09T00:00:00Z")) == 0)
    }

    @Test func ownerRowsHideUsernameEmails() throws {
        let rows = try decodeJSON([LeagueInvitation].self, """
        [{"id":"i1","league_id":"l1","email":null,"invitee_display_name":"Eve Lumet","token":"t1","status":"pending",
          "expires_at":"2026-10-01T00:00:00Z"},
         {"id":"i2","league_id":"l1","email":"eve@example.com","token":"t2","status":"accepted"},
         {"id":"i3","league_id":"l1","email":"x@example.com","token":"t3","status":"mystery"}]
        """)
        let now = instant("2026-10-02T00:00:00Z")
        #expect(rows[0].recipient == "Eve Lumet")
        #expect(rows[0].effectiveStatus(now: now) == .expired)
        #expect(rows[0].canResend(now: now))
        #expect(!rows[0].canCancel(now: now))
        // Still pending before it expires: cancel, not resend (web InvitationsList).
        let beforeExpiry = instant("2026-09-30T00:00:00Z")
        #expect(!rows[0].canResend(now: beforeExpiry))
        #expect(rows[0].canCancel(now: beforeExpiry))
        #expect(rows[1].recipient == "eve@example.com")
        #expect(!rows[1].canResend(now: now))
        #expect(rows[2].status == .unknown("mystery"))
        #expect(!rows[2].canResend(now: now))
        #expect(!rows[2].canCancel(now: now))
    }
}

struct SeasonHistoryTests {
    private func season(_ year: Int, status: LeagueStatus = .completed, table: [(team: String, user: String, rank: Int)]) -> League {
        League(
            id: LeagueID("l\(year)"),
            name: "Popcorn Syndicate",
            ownerID: "u1",
            status: status,
            seriesID: "s1",
            seasonYear: year,
            seasonEnd: DateOnly(year: year, month: 12, day: 31)!,
            finalStandings: status == .completed ? table.map { row in
                FinalStandingRow(
                    teamID: TeamID("\(row.team)-\(year)"), teamName: row.team, participantID: "p", userID: UserID(row.user),
                    totalPoints: 100, rank: row.rank, isTied: false, displayName: row.user.capitalized
                )
            } : nil,
            createdAt: instant("\(year)-01-01T00:00:00Z"),
            updatedAt: instant("\(year)-01-01T00:00:00Z")
        )
    }

    @Test func coChampionsShareTheTitle() {
        let tied = season(2023, table: [("Nolan's Notebook", "bob", 1), ("Kubrick's Cube", "dave", 1), ("Reel Deal", "alice", 3)])
        #expect(SeasonHistory.champions(of: tied).map(\.teamName) == ["Nolan's Notebook", "Kubrick's Cube"])
        let titles = SeasonHistory.titles(in: [tied])
        #expect(titles.count == 2)
        #expect(titles.allSatisfy { $0.wins == [SeasonHistory.Win(year: 2023, shared: true)] })
    }

    @Test func reigningChampionIsByUser() {
        let seasons = [
            season(2026, status: .setup, table: []),
            season(2025, table: [("Coppola Cut", "carol", 1), ("Reel Deal", "alice", 2)]),
            season(2024, table: [("Reel Deal", "alice", 1)]),
        ]
        #expect(SeasonHistory.reigningChampionUserIDs(before: seasons[0], in: seasons) == [UserID("carol")])
        #expect(SeasonHistory.reigningChampionUserIDs(before: seasons[2], in: seasons).isEmpty)
        let titles = SeasonHistory.titles(in: seasons)
        #expect(titles.map(\.userID.rawValue) == ["carol", "alice"])
        #expect(SeasonHistory.finish(of: "alice", in: seasons[1])?.rank == 2)
    }
}
