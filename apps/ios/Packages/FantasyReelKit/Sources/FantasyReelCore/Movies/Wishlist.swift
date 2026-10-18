import Foundation

public enum WishlistItemTag: Sendable {}
/// `wishlisted_movies.id`.
public typealias WishlistItemID = Identifier<WishlistItemTag>

/// A `wishlisted_movies` row (F-07). A wishlist belongs to the person across
/// every league; it is not a draft-local favorites list.
public struct WishlistedMovie: Codable, Sendable, Hashable, Identifiable {
    public var id: WishlistItemID
    public var userID: UserID
    public var tmdbID: TMDbID
    public var title: String
    /// A TMDb path or TMDb image URL (the database refuses other hosts).
    public var posterURL: String?
    public var addedAt: Date

    public init(id: WishlistItemID, userID: UserID, tmdbID: TMDbID, title: String, posterURL: String? = nil, addedAt: Date) {
        self.id = id
        self.userID = userID
        self.tmdbID = tmdbID
        self.title = title
        self.posterURL = posterURL
        self.addedAt = addedAt
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case tmdbID = "tmdb_id"
        case title
        case posterURL = "poster_url"
        case addedAt = "added_at"
    }
}

/// What a wishlist write sends: the movie as research surfaces know it.
public struct WishlistCandidate: Sendable, Hashable {
    public var tmdbID: TMDbID
    public var title: String
    public var posterURL: String?

    public init(tmdbID: TMDbID, title: String, posterURL: String?) {
        self.tmdbID = tmdbID
        self.title = title
        self.posterURL = posterURL
    }

    /// The row to upsert. Titles are capped at 500 characters and posters are
    /// written as the bare TMDb path, as the database's checks require (F-07).
    public var row: WishlistInsert? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return WishlistInsert(
            tmdbID: tmdbID,
            title: String(trimmed.prefix(WishlistLimits.maxTitleLength)),
            posterURL: WishlistLimits.storablePosterPath(posterURL)
        )
    }
}

/// The insert body for `wishlisted_movies` (user id is added by the repository).
public struct WishlistInsert: Sendable, Hashable {
    public var tmdbID: TMDbID
    public var title: String
    public var posterURL: String?

    public init(tmdbID: TMDbID, title: String, posterURL: String?) {
        self.tmdbID = tmdbID
        self.title = title
        self.posterURL = posterURL
    }
}

public enum WishlistLimits {
    /// The database refuses a 501st movie with this message.
    public static let maxCount = 500
    public static let fullMessage = "Your wishlist is full (500 movies). Remove some to add more."
    public static let maxTitleLength = 500

    /// `poster_url` as the database accepts it: the bare TMDb path
    /// (`/abc.jpg`). A TMDb image URL at any size is reduced to its path;
    /// anything else is dropped rather than stored, since a re-hosted URL
    /// would fail the column's check and lose the whole add.
    public static func storablePosterPath(_ poster: String?) -> String? {
        guard let source = poster?.trimmingCharacters(in: .whitespacesAndNewlines), !source.isEmpty else { return nil }
        if TMDbImage.isPosterPath(source) { return source }
        guard let url = TMDbImage.posterURL(source, size: .original),
              url.host?.lowercased() == "image.tmdb.org"
        else { return nil }
        let file = "/" + url.lastPathComponent
        return TMDbImage.isPosterPath(file) ? file : nil
    }
}

public enum WishlistSort: String, CaseIterable, Sendable, Hashable {
    case dateAdded
    case title

    public var title: String {
        switch self {
        case .dateAdded: "Date Added"
        case .title: "Title A–Z"
        }
    }

    /// Newest first, or by title with the locale's ordering (ties by date).
    public func sorted(_ movies: [WishlistedMovie]) -> [WishlistedMovie] {
        switch self {
        case .dateAdded:
            return movies.sorted { lhs, rhs in
                if lhs.addedAt != rhs.addedAt { return lhs.addedAt > rhs.addedAt }
                return lhs.tmdbID.rawValue < rhs.tmdbID.rawValue
            }
        case .title:
            return movies.sorted { lhs, rhs in
                let order = lhs.title.localizedStandardCompare(rhs.title)
                if order != .orderedSame { return order == .orderedAscending }
                return lhs.addedAt > rhs.addedAt
            }
        }
    }
}

/// Who holds a movie in one season, for wishlist and search labels (F-07).
/// Built from every active `team_holdings` row, pickups included.
public enum LeagueMovieStatus: Sendable, Hashable {
    case available
    case yours(source: HoldingSource)
    case heldBy(teamName: String, source: HoldingSource)

    /// "Available", "On your roster", "Drafted by Reel Deal", "Picked up by Reel Deal".
    public var label: String {
        switch self {
        case .available:
            return "Available"
        case .yours:
            return "On your roster"
        case .heldBy(let team, let source):
            switch source {
            case .pickup: return "Picked up by \(team)"
            default: return "Drafted by \(team)"
            }
        }
    }
}

/// One season's holdings by TMDb id, for labelling research results.
public struct LeagueHoldingsIndex: Sendable, Hashable {
    public struct Holder: Sendable, Hashable {
        public var teamID: TeamID
        public var teamName: String
        public var source: HoldingSource

        public init(teamID: TeamID, teamName: String, source: HoldingSource) {
            self.teamID = teamID
            self.teamName = teamName
            self.source = source
        }
    }

    public var myTeamID: TeamID?
    public var holders: [TMDbID: Holder]

    public init(myTeamID: TeamID?, holders: [TMDbID: Holder]) {
        self.myTeamID = myTeamID
        self.holders = holders
    }

    public init(myTeamID: TeamID?, holdings: [TeamHolding]) {
        var holders: [TMDbID: Holder] = [:]
        for holding in holdings {
            holders[holding.tmdbID] = Holder(teamID: holding.teamID, teamName: holding.teamName, source: holding.source)
        }
        self.init(myTeamID: myTeamID, holders: holders)
    }

    public static let empty = LeagueHoldingsIndex(myTeamID: nil, holders: [:])

    public func status(of tmdbID: TMDbID) -> LeagueMovieStatus {
        guard let holder = holders[tmdbID] else { return .available }
        if holder.teamID == myTeamID { return .yours(source: holder.source) }
        return .heldBy(teamName: holder.teamName, source: holder.source)
    }
}

/// A league-mate who shares their wishlist with this league (F-07).
public struct SharedWishlistOwner: Sendable, Hashable, Identifiable {
    public var userID: UserID
    public var displayName: String
    public var avatarURL: String?
    /// Rows visible to the viewer; the server decides visibility.
    public var movieCount: Int

    public var id: UserID { userID }

    public init(userID: UserID, displayName: String, avatarURL: String? = nil, movieCount: Int) {
        self.userID = userID
        self.displayName = displayName
        self.avatarURL = avatarURL
        self.movieCount = movieCount
    }

    /// "12 movies"; "1 movie".
    public var countText: String {
        "\(movieCount) \(movieCount == 1 ? "movie" : "movies")"
    }
}

/// When a movie was wishlisted, compact for the row and spelled out for
/// VoiceOver (the web's `AddedDate`): "today", "yesterday", "3d ago" /
/// "3 days ago", "2w ago" / "2 weeks ago", then a date ("Mar 4").
public struct AddedDateText: Sendable, Hashable {
    public var compact: String
    public var spoken: String

    public init(_ added: Date, now: Date = Date(), locale: Locale = .autoupdatingCurrent, timeZone: TimeZone = .autoupdatingCurrent) {
        let days = max(0, Int((now.timeIntervalSince(added) / 86_400).rounded(.down)))
        let weeks = days / 7
        func plural(_ n: Int, _ unit: String) -> String { "\(n) \(unit)\(n == 1 ? "" : "s") ago" }
        switch days {
        case 0:
            compact = "today"; spoken = "today"
        case 1:
            compact = "yesterday"; spoken = "yesterday"
        case 2..<7:
            compact = "\(days)d ago"; spoken = plural(days, "day")
        case 7..<30:
            compact = "\(weeks)w ago"; spoken = plural(weeks, "week")
        default:
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = timeZone
            let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: timeZone).month(.abbreviated).day()
            let text = added.formatted(style)
            compact = text; spoken = text
        }
    }
}
