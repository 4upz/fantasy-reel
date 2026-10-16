import Foundation

/// One league in the user's directory: a series and the seasons of it they can
/// read. The app lists leagues, not seasons; four years of history are one entry.
public struct LeagueDirectoryEntry: Sendable, Hashable, Identifiable {
    public var seriesID: SeriesID
    /// Newest first (`season_year` descending). Never empty.
    public var seasons: [League]
    /// The season the entry opens on: the newest one still being played, else
    /// the newest completed one (the web's `currentSeasonOf`).
    public var entrySeason: League

    public var id: SeriesID { seriesID }

    /// The newest season's name. Names sync down from the series on rename, so
    /// all seasons agree; the newest is the safest pick if one lags.
    public var name: String { seasons.first?.name ?? entrySeason.name }

    /// Whether any season of this league is still running.
    public var isRunning: Bool { entrySeason.status != .completed }

    public init(seriesID: SeriesID, seasons: [League], entrySeason: League) {
        self.seriesID = seriesID
        self.seasons = seasons
        self.entrySeason = entrySeason
    }

    public func season(_ id: LeagueID) -> League? {
        seasons.first { $0.id == id }
    }
}

/// Folds the flat `leagues` list (one row per season the user can read under
/// RLS) back into leagues, as the web's `groupLeaguesIntoSeries` does.
public enum LeagueDirectory {
    /// Groups seasons by `series_id`.
    ///
    /// Entry order matches the web dashboard, which loads leagues newest
    /// `created_at` first and keeps the order groups first appear in: a league
    /// sorts by its most recently created season. Ties fall back to series id
    /// so the order is stable.
    public static func entries(from leagues: [League]) -> [LeagueDirectoryEntry] {
        var bySeries: [SeriesID: [League]] = [:]
        for league in leagues {
            bySeries[league.seriesID, default: []].append(league)
        }

        let entries: [LeagueDirectoryEntry] = bySeries.compactMap { seriesID, group in
            let seasons = group.sorted { lhs, rhs in
                if lhs.seasonYear != rhs.seasonYear { return lhs.seasonYear > rhs.seasonYear }
                return lhs.createdAt > rhs.createdAt
            }
            guard let entrySeason = currentSeason(of: seasons) else { return nil }
            return LeagueDirectoryEntry(seriesID: seriesID, seasons: seasons, entrySeason: entrySeason)
        }

        return entries.sorted { lhs, rhs in
            let lhsNewest = newestCreatedAt(lhs.seasons)
            let rhsNewest = newestCreatedAt(rhs.seasons)
            if lhsNewest != rhsNewest { return lhsNewest > rhsNewest }
            return lhs.seriesID.rawValue < rhs.seriesID.rawValue
        }
    }

    /// The season a league opens on: the newest still being played, or the
    /// newest if all are completed. Nil for an empty list.
    public static func currentSeason(of seasons: [League]) -> League? {
        let running = seasons.filter { $0.status != .completed }
        let pool = running.isEmpty ? seasons : running
        return pool.max { lhs, rhs in
            if lhs.seasonYear != rhs.seasonYear { return lhs.seasonYear < rhs.seasonYear }
            return lhs.createdAt < rhs.createdAt
        }
    }

    /// The entry holding the season `leagueID`, e.g. to resolve a deep link.
    public static func entry(containing leagueID: LeagueID, in entries: [LeagueDirectoryEntry]) -> LeagueDirectoryEntry? {
        entries.first { $0.season(leagueID) != nil }
    }

    private static func newestCreatedAt(_ seasons: [League]) -> Date {
        seasons.map(\.createdAt).max() ?? .distantPast
    }
}

extension Array where Element == LeagueDirectoryEntry {
    /// The entry holding the season `leagueID`.
    public func entry(containing leagueID: LeagueID) -> LeagueDirectoryEntry? {
        LeagueDirectory.entry(containing: leagueID, in: self)
    }
}
