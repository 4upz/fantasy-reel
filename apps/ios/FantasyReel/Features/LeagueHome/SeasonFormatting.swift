import FantasyReelCore
import Foundation

/// Display helpers shared by the league tabs.
enum SeasonFormat {
    /// "$64": whole-dollar Fantasy Budget.
    static func budget(_ amount: Int) -> String { "$\(amount)" }

    /// A holding's meta line: "Releases Oct 16 · RT 74%", "Released Jul 17 · RT 88%",
    /// "Release date TBA", with an optional suffix (" · Pickup").
    static func releaseMeta(_ date: DateOnly?, rt: Double?, suffix: String? = nil, now: Date = Date()) -> String {
        var parts: [String] = []
        if let date {
            parts.append(DateOnly.hasReleased(date, now: now) ? "Released \(date.formattedShort)" : "Releases \(date.formattedShort)")
        } else {
            parts.append("Release date TBA")
        }
        if let rt { parts.append("RT \(Int(JSMath.round(rt)))%") }
        if let suffix { parts.append(suffix) }
        return parts.joined(separator: " · ")
    }

    /// Compact meta for roster rows: "R1 · Jul 17 · RT 88%", "Nov 20 · Won for $18".
    static func rosterMeta(_ holding: TeamHolding) -> String {
        var parts: [String] = []
        switch holding.source {
        case .draft:
            if let round = holding.round { parts.append("R\(round)") }
        case .pickup, .unknown:
            break
        }
        parts.append(DateOnly.display(holding.releaseDate, style: .short))
        if holding.source == .pickup, let paid = holding.amountPaid { parts.append("Won for \(budget(paid))") }
        if let rt = holding.combinedScore { parts.append("RT \(Int(JSMath.round(rt)))%") }
        return parts.joined(separator: " · ")
    }
}
