import Foundation
import Testing
@testable import FantasyReelCore

/// Fixtures from the "projected standings" block of
/// `scripts/tests/projections.test.cjs`, so both clients rank the same (F-19).
struct ProjectedStandingsTests {
    let now = ISO8601DateFormatter().date(from: "2026-10-06T12:00:00Z")!

    let teams = [
        ProjectedStandings.Team(teamID: "sharks", teamName: "Spielberg's Sharks", earned: 37, rank: 2),
        ProjectedStandings.Team(teamID: "paradox", teamName: "Nolan's Paradox", earned: 44, rank: 1),
        ProjectedStandings.Team(teamID: "cut", teamName: "Coppola Cut", earned: 29, rank: 3),
    ]

    func projection(_ id: TMDbID, expected: Double = 16, range80: [Double] = [64, 86], insufficient: Bool = false) -> MovieProjection {
        MovieProjection(
            tmdbID: id, projectedRT: 76, range50: [72, 80], range80: range80,
            insufficientHistory: insufficient, pRotten: 0.12, pFresh: 0.88, p90: 0.08,
            expectedPoints: expected, baselineRT: 61
        )
    }

    func released(_ team: TeamID, _ id: TMDbID, points: Double, counterpick: Bool = false) -> ProjectedStandings.Source {
        .init(teamID: team, tmdbID: id, title: "M\(id)", releaseDate: DateOnly("2026-06-01"), fantasyPoints: points, counterpick: counterpick)
    }

    func upcoming(_ team: TeamID, _ id: TMDbID, points: Double? = nil, date: String = "2026-11-14", counterpick: Bool = false) -> ProjectedStandings.Source {
        .init(teamID: team, tmdbID: id, title: "M\(id)", releaseDate: DateOnly(date), fantasyPoints: points, counterpick: counterpick)
    }

    func standings(_ sources: [ProjectedStandings.Source], _ projections: [MovieProjection], double: Bool = false) -> [ProjectedStandings.Standing] {
        ProjectedStandings.compute(
            teams: teams, sources: sources,
            projections: Dictionary(uniqueKeysWithValues: projections.map { ($0.tmdbID, $0) }),
            doublePointsOver90: double, now: now
        )
    }

    func team(_ id: TeamID, in table: [ProjectedStandings.Standing]) -> ProjectedStandings.Standing {
        table.first { $0.teamID == id }!
    }

    @Test func totalIsEarnedPlusExpectedPointsOfWhatHasNotCounted() {
        let table = standings(
            [released("sharks", 10, points: 23), upcoming("sharks", 11), upcoming("sharks", 12), upcoming("paradox", 20)],
            [projection(11, expected: 16), projection(12, expected: 7), projection(20, expected: -10)]
        )
        let sharks = team("sharks", in: table)
        // Earned is the server's total; the released movie is inside it, not added again.
        #expect(sharks.projected == 37 + 16 + 7)
        #expect(sharks.remaining == 2)
        #expect(team("paradox", in: table).projected == 34)
        #expect(table.map(\.teamID) == ["sharks", "paradox", "cut"])
        #expect(sharks.projectedRank == 1)
        #expect(sharks.rankChange == 1)
        #expect(team("paradox", in: table).rankChange == -1)
        // Real rank is untouched.
        #expect(team("paradox", in: table).currentRank == 1)
        #expect(ProjectedStandings.hasProjectedLegs(table))
        #expect(ProjectedStandings.moviesToRelease(table) == 3)
    }

    @Test func counterpickAddsTheNegationOfItsTarget() {
        let table = standings([upcoming("sharks", 11), upcoming("cut", 11, counterpick: true)], [projection(11, expected: 16)])
        let cut = team("cut", in: table)
        #expect(cut.projected == 29 - 16)
        #expect(cut.legs[0].counterpick)
        #expect(cut.legs[0].points == -16)
    }

    @Test func releasedCounterpickIsEarnedAndPreReleaseScoreStandsIn() {
        let table = standings(
            [upcoming("cut", 30, points: 10, date: "2026-12-05"), released("cut", 31, points: -4, counterpick: true)],
            []
        )
        let cut = team("cut", in: table)
        #expect(cut.legs.map(\.basis) == [.preRelease, .earned])
        #expect(cut.projected == 29 + 10)
        // No leg rests on a projection, so there is nothing to show.
        #expect(!ProjectedStandings.hasProjectedLegs(table))
    }

    @Test func noProjectionOrTooLittleHistoryAddsNothing() {
        let table = standings(
            [upcoming("cut", 40), upcoming("cut", 41)],
            [projection(41, expected: 30, insufficient: true)]
        )
        let cut = team("cut", in: table)
        #expect(cut.legs.map(\.basis) == [ProjectedStandings.Basis.none, .none])
        #expect(cut.projected == 29)
    }

    @Test func equalTotalsShareACompetitionRank() {
        let table = standings([upcoming("cut", 50)], [projection(50, expected: 8)])
        #expect(table.map(\.teamID) == ["paradox", "sharks", "cut"])
        #expect(table.map(\.projectedRank) == [1, 2, 2])
        #expect(table.map(\.isTied) == [false, true, true])
        #expect(ProjectedStandings.positionLabel(table[2]) == "T-2nd")
        #expect(ProjectedStandings.spokenPosition(table[2]) == "Tied for 2nd")
    }

    @Test func smallGapNextToTheUncertaintyIsATossUp() {
        let close = standings([upcoming("cut", 60)], [projection(60, expected: 6, range80: [40, 95])])
        let cut = team("cut", in: close)
        #expect(cut.projected == 35)
        #expect(cut.uncertainty > 10)
        #expect(cut.tossUp)

        let certain = standings([upcoming("cut", 60)], [projection(60, expected: 6, range80: [74, 76])])
        #expect(!team("cut", in: certain).tossUp)
    }

    @Test func uncertaintyIsMeasuredUnderTheSeasonRule() {
        func run(_ double: Bool) -> Double {
            team("cut", in: standings([upcoming("cut", 70)], [projection(70, range80: [80, 98])], double: double)).uncertainty
        }
        #expect(run(true) > run(false))
    }

    @Test func pendingLegsSortByReleaseDateUnknownLast() {
        let table = standings(
            [
                .init(teamID: "cut", tmdbID: 1, title: "Undated", releaseDate: nil, fantasyPoints: nil),
                upcoming("cut", 2, date: "2026-12-01"),
                upcoming("cut", 3, date: "2026-11-01"),
            ],
            []
        )
        #expect(team("cut", in: table).pendingLegs.map(\.tmdbID) == [3, 2, 1])
    }
}
