import Foundation

/// JavaScript's `Math.round`, which the web uses for every displayed number.
///
/// Swift's `.rounded()` rounds halves away from zero (-2.5 → -3) where
/// JavaScript rounds them toward +∞ (-2.5 → -2), and `floor(x + 0.5)` gets
/// 0.49999999999999994 wrong. Display parity (F-14) depends on this.
public enum JSMath {
    public static func round(_ x: Double) -> Double {
        let floor = x.rounded(.down)
        let result = (x - floor) >= 0.5 ? floor + 1 : floor
        // JavaScript yields -0 for -0.5...-0; it prints as "0", so normalize.
        return result == 0 ? 0 : result
    }
}

/// Fantasy points display and rules, ported from `apps/frontend/utils/scoring.ts`.
///
/// Points come from the Rotten Tomatoes-only curve and can be negative and
/// fractional. Keep server precision for sums, comparisons and ties; round only
/// for display.
public enum FantasyPoints {
    /// The typographic minus (U+2212) the iOS design uses for negative points.
    /// The web prints an ASCII hyphen; VoiceOver uses `spokenLabel` either way.
    public static let minusSign = "\u{2212}"

    /// Whole-number points as the web's `formatFantasyPoints` prints them
    /// ("36", "-16"), with "--" for unscored. Use for plain numeric contexts;
    /// rows use `signed`.
    public static func whole(_ points: Double?) -> String {
        guard let points, points.isFinite else { return "--" }
        return integerString(JSMath.round(points))
    }

    /// Points with the sign spelled out: "+28", "0", "−4" (U+2212).
    public static func signed(_ points: Double) -> String {
        guard points.isFinite else { return "--" }
        let rounded = JSMath.round(points)
        if rounded > 0 { return "+" + integerString(rounded) }
        if rounded < 0 { return minusSign + integerString(-rounded) }
        return "0"
    }

    /// Display for an optional score: `signed`, or "--" when pending.
    public static func signed(_ points: Double?) -> String {
        guard let points else { return "--" }
        return signed(points)
    }

    /// What VoiceOver reads: "plus 28 points", "minus 4 points", "0 points",
    /// "pending", and "… at release" for a pre-release score.
    public static func spokenLabel(_ points: Double?, preRelease: Bool) -> String {
        guard let points, points.isFinite else { return "pending" }
        let rounded = JSMath.round(points)
        let magnitude = integerString(abs(rounded))
        let unit = abs(rounded) == 1 ? "point" : "points"
        let base: String
        if rounded > 0 {
            base = "plus \(magnitude) \(unit)"
        } else if rounded < 0 {
            base = "minus \(magnitude) \(unit)"
        } else {
            base = "0 points"
        }
        return preRelease ? base + " at release" : base
    }

    /// A score that exists but doesn't count yet because the movie hasn't
    /// released (UTC calendar date). For a counterpick, pass the counterpicked
    /// movie's release date.
    public static func isPreReleaseScore(points: Double?, releaseDate: DateOnly?, now: Date = Date()) -> Bool {
        points != nil && !DateOnly.hasReleased(releaseDate, now: now)
    }

    /// Scored movies are locked against bids and trades, released or not. The
    /// server enforces it; the UI says so up front.
    public static func isScoreLocked(_ points: Double?) -> Bool {
        points != nil
    }

    /// Points a Tomatometer would earn on the database's curve (baseline 60).
    /// For projections and explanations only: real points come from the server.
    public static func fantasyPointsForTomatometer(_ rt: Double, doublePointsOver90: Bool = false) -> Double {
        let points: Double
        if rt >= 50 {
            points = rt - 60
        } else if rt >= 40 {
            points = -10 - (50 - rt) * 0.5
        } else if rt >= 30 {
            points = -15 - (40 - rt) * 0.25
        } else if rt >= 20 {
            points = -17.5 - (30 - rt) * 0.125
        } else if rt >= 10 {
            points = -18.75 - (20 - rt) * 0.0625
        } else {
            points = -19.375 - (10 - rt) * 0.03125
        }
        return leagueFantasyPoints(points: JSMath.round(points * 100) / 100, rtScore: rt, doublePointsOver90: doublePointsOver90)
    }

    /// A raw `movies` row's points in one season, mirroring SQL
    /// `league_fantasy_points()`: plus (RT − 90) above 90 when the season pays
    /// double. `team_holdings`/`counterpicks` rows already include it.
    public static func leagueFantasyPoints(points: Double, rtScore: Double?, doublePointsOver90: Bool) -> Double {
        guard doublePointsOver90, let rtScore, rtScore > 90 else { return points }
        return points + (rtScore - 90)
    }

    /// The critic score of record, shown beside points: "93% RT".
    public static func criticScore(_ combinedScore: Double) -> String {
        integerString(JSMath.round(combinedScore)) + "% RT"
    }

    /// A whole, finite Double as digits ("28", "-4"); never "28.0".
    private static func integerString(_ value: Double) -> String {
        if let int = Int(exactly: value) { return String(int) }
        return String(format: "%.0f", value)
    }
}
