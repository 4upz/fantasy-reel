import FantasyReelCore
import Foundation

/// Wording shared by the completed-season home and League History (F-16), so
/// the two screens describe ranks, totals and champions the same way.
enum SeasonText {
    /// "2025 Season". Built as a `String` so the year never picks up a
    /// thousands separator the way a localized `Text` interpolation would.
    static func seasonTitle(_ year: Int) -> String {
        "\(year) Season"
    }

    /// "A", "A and B", "A, B and C": every name, read as a sentence (the web's
    /// `joinNames` in `ChampionBanner`).
    static func sentenceList(_ names: [String]) -> String {
        guard let last = names.last else { return "" }
        if names.count == 1 { return last }
        return names.dropLast().joined(separator: ", ") + " and " + last
    }

    /// "Nolan's Notebook & Kubrick's Cube" (the History mockup's champion line).
    static func ampersandList(_ names: [String]) -> String {
        names.joined(separator: " & ")
    }

    /// "1st", "2nd", "3rd", "4th", "11th", "22nd". Ranks, not positions: a
    /// shared first place pushes the next team to 3rd, as in the standings.
    static func ordinal(_ number: Int) -> String {
        let lastTwo = number % 100
        let suffix: String
        if (11...13).contains(lastTwo) {
            suffix = "th"
        } else {
            switch number % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(number)\(suffix)"
    }

    /// The rank column: "2", or "T-2" when the rank is shared.
    static func rankLabel(_ row: FinalStandingRow) -> String {
        row.isTied ? "T-\(row.rank)" : "\(row.rank)"
    }

    /// What VoiceOver reads for the rank column.
    static func spokenRank(_ row: FinalStandingRow) -> String {
        row.isTied ? "Tied for rank \(row.rank)" : "Rank \(row.rank)"
    }

    /// A team total as a whole number ("147", "−16" with U+2212).
    static func total(_ points: Double) -> String {
        let whole = FantasyPoints.whole(points)
        guard whole.hasPrefix("-") else { return whole }
        return FantasyPoints.minusSign + String(whole.dropFirst())
    }

    /// "147 points", "1 point", "minus 16 points".
    static func spokenTotal(_ points: Double) -> String {
        guard points.isFinite else { return "no points" }
        let rounded = Int(JSMath.round(points))
        let magnitude = abs(rounded)
        let unit = magnitude == 1 ? "point" : "points"
        return rounded < 0 ? "minus \(magnitude) \(unit)" : "\(magnitude) \(unit)"
    }

    /// The frozen owner name; a deleted account (or a missing name) reads
    /// "Former member", as on the web.
    static func ownerName(_ row: FinalStandingRow) -> String {
        let name = row.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Former member" : name
    }

    /// "you were 2nd" / "you tied for 2nd" for a finish that wasn't a title.
    static func yourFinish(_ row: FinalStandingRow) -> String {
        row.isTied ? "you tied for \(ordinal(row.rank))" : "you were \(ordinal(row.rank))"
    }
}
