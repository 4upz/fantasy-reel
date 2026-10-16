import Foundation
import Testing
@testable import FantasyReelCore

struct JSMathTests {
    @Test func matchesJavaScriptMathRound() {
        // Expected values are what `Math.round` returns in JavaScript.
        let cases: [(Double, Double)] = [
            (2.5, 3), (-2.5, -2), (1.5, 2), (-1.5, -1), (0.5, 1), (-0.5, 0),
            (0.49999999999999994, 0), (-0.49999999999999994, 0), (2.4, 2), (-2.6, -3),
            (-16.25, -16), (16.5, 17), (-16.5, -16), (0, 0), (4_503_599_627_370_497, 4_503_599_627_370_497),
        ]
        for (input, expected) in cases {
            #expect(JSMath.round(input) == expected, "Math.round(\(input))")
        }
        // -0 is normalized so it never prints as "-0".
        #expect(JSMath.round(-0.4).sign == .plus)
    }
}

struct FantasyPointsTests {
    @Test func curveMatchesTheDatabase() {
        #expect(FantasyPoints.fantasyPointsForTomatometer(96) == 36)
        #expect(FantasyPoints.fantasyPointsForTomatometer(84) == 24)
        #expect(FantasyPoints.fantasyPointsForTomatometer(60) == 0)
        #expect(FantasyPoints.fantasyPointsForTomatometer(50) == -10)
        #expect(FantasyPoints.fantasyPointsForTomatometer(45) == -12.5)
        #expect(FantasyPoints.fantasyPointsForTomatometer(35) == -16.25)
        #expect(FantasyPoints.fantasyPointsForTomatometer(25) == -18.12) // Math.round(-1812.5) is -1812 in JavaScript
        #expect(FantasyPoints.fantasyPointsForTomatometer(0) == -19.69)
        #expect(FantasyPoints.fantasyPointsForTomatometer(96, doublePointsOver90: true) == 42)
        #expect(FantasyPoints.fantasyPointsForTomatometer(90, doublePointsOver90: true) == 30)
        #expect(FantasyPoints.fantasyPointsForTomatometer(100, doublePointsOver90: true) == 50)
    }

    @Test func leagueRuleAddsOnlyAbove90() {
        #expect(FantasyPoints.leagueFantasyPoints(points: 36, rtScore: 96, doublePointsOver90: true) == 42)
        #expect(FantasyPoints.leagueFantasyPoints(points: 36, rtScore: 96, doublePointsOver90: false) == 36)
        #expect(FantasyPoints.leagueFantasyPoints(points: 30, rtScore: 90, doublePointsOver90: true) == 30)
        #expect(FantasyPoints.leagueFantasyPoints(points: 5, rtScore: nil, doublePointsOver90: true) == 5)
    }

    @Test func wholeMatchesFormatFantasyPoints() {
        #expect(FantasyPoints.whole(nil) == "--")
        #expect(FantasyPoints.whole(36) == "36")
        #expect(FantasyPoints.whole(-16.25) == "-16")
        #expect(FantasyPoints.whole(-0.5) == "0")
        #expect(FantasyPoints.whole(2.5) == "3")
        #expect(FantasyPoints.whole(0) == "0")
    }

    @Test func signedUsesTypographicMinus() {
        #expect(FantasyPoints.signed(28) == "+28")
        #expect(FantasyPoints.signed(0) == "0")
        #expect(FantasyPoints.signed(-4) == "\u{2212}4")
        #expect(FantasyPoints.signed(-16.25) == "\u{2212}16")
        #expect(FantasyPoints.signed(-0.5) == "0")
        #expect(FantasyPoints.signed(2.5) == "+3")
        #expect(FantasyPoints.signed(-2.5) == "\u{2212}2")
        #expect(FantasyPoints.signed(0.4) == "0")
        let pending: Double? = nil
        #expect(FantasyPoints.signed(pending) == "--")
    }

    @Test func spokenLabels() {
        #expect(FantasyPoints.spokenLabel(28, preRelease: false) == "plus 28 points")
        #expect(FantasyPoints.spokenLabel(-4, preRelease: false) == "minus 4 points")
        #expect(FantasyPoints.spokenLabel(0, preRelease: false) == "0 points")
        #expect(FantasyPoints.spokenLabel(1, preRelease: false) == "plus 1 point")
        #expect(FantasyPoints.spokenLabel(nil, preRelease: false) == "pending")
        #expect(FantasyPoints.spokenLabel(nil, preRelease: true) == "pending")
        #expect(FantasyPoints.spokenLabel(14, preRelease: true) == "plus 14 points at release")
        #expect(FantasyPoints.spokenLabel(-16.25, preRelease: false) == "minus 16 points")
    }

    @Test func preReleaseAndLockAreIndependent() throws {
        let release = try #require(DateOnly("2026-10-16"))
        let before = instant("2026-10-15T23:00:00Z")
        let after = instant("2026-10-16T00:00:00Z")
        #expect(FantasyPoints.isPreReleaseScore(points: 24, releaseDate: release, now: before))
        #expect(!FantasyPoints.isPreReleaseScore(points: 24, releaseDate: release, now: after))
        #expect(!FantasyPoints.isPreReleaseScore(points: nil, releaseDate: release, now: before))
        // No release date: a score is pre-release (it cannot have released).
        #expect(FantasyPoints.isPreReleaseScore(points: 0, releaseDate: nil, now: after))
        #expect(FantasyPoints.isScoreLocked(0))
        #expect(!FantasyPoints.isScoreLocked(nil))
    }

    @Test func criticScore() {
        #expect(FantasyPoints.criticScore(93) == "93% RT")
        #expect(FantasyPoints.criticScore(92.5) == "93% RT")
    }
}
