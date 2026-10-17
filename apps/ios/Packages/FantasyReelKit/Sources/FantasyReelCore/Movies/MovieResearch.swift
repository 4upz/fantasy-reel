import Foundation

/// One movie in a `search-movies` or `browse-movies` page (the web's
/// `TMDbSearchResult`). Not a `movies` row: most results were never drafted,
/// so there is no `MovieID` and no score.
public struct MovieSearchResult: Codable, Sendable, Hashable, Identifiable {
    public var tmdbID: TMDbID
    public var title: String
    public var overview: String?
    /// Nil when TMDb has no date (it sends "" for those).
    public var releaseDate: DateOnly?
    public var posterURL: String?
    public var genreIDs: [Int]

    public var id: TMDbID { tmdbID }

    public init(
        tmdbID: TMDbID,
        title: String,
        overview: String? = nil,
        releaseDate: DateOnly? = nil,
        posterURL: String? = nil,
        genreIDs: [Int] = []
    ) {
        self.tmdbID = tmdbID
        self.title = title
        self.overview = overview
        self.releaseDate = releaseDate
        self.posterURL = posterURL
        self.genreIDs = genreIDs
    }

    public enum CodingKeys: String, CodingKey {
        case tmdbID = "tmdb_id"
        case title
        case overview
        case releaseDate = "release_date"
        case posterURL = "poster_url"
        case genreIDs = "genre_ids"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        title = try c.decode(String.self, forKey: .title)
        overview = try c.decodeIfPresent(String.self, forKey: .overview)
        releaseDate = try c.decodeLenientDate(forKey: .releaseDate)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        genreIDs = try c.decode([Int].self, forKey: .genreIDs, default: [])
    }
}

/// A discovery page as `search-movies`/`browse-movies` return it
/// (`_shared/movie-discovery.ts` `discoveryPage`).
///
/// The page keeps its upstream identity even when eligibility filtering
/// empties it, so "is there more?" is `hasMore`, never `results.isEmpty`.
/// `totalResults` counts upstream matches, not eligible movies (F-06).
public struct DiscoveryPage<Item: Codable & Sendable & Hashable>: Codable, Sendable, Hashable {
    public var page: Int
    public var totalPages: Int
    public var totalResults: Int
    public var hasMore: Bool
    public var results: [Item]

    public init(page: Int, totalPages: Int, totalResults: Int, hasMore: Bool? = nil, results: [Item]) {
        self.page = page
        self.totalPages = totalPages
        self.totalResults = totalResults
        self.hasMore = hasMore ?? (page < totalPages)
        self.results = results
    }

    public enum CodingKeys: String, CodingKey {
        case page
        case totalPages = "total_pages"
        case totalResults = "total_results"
        case hasMore = "has_more"
        case results
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        page = try c.decodeInteger(forKey: .page) ?? 1
        totalPages = try c.decodeInteger(forKey: .totalPages) ?? page
        totalResults = try c.decodeInteger(forKey: .totalResults) ?? 0
        // Older responses had no `has_more`; the page count says the same thing.
        hasMore = try c.decodeIfPresent(Bool.self, forKey: .hasMore) ?? (page < totalPages)
        results = try c.decode([Item].self, forKey: .results, default: [])
    }
}

/// `get-movie-details` (`_shared/movie-details.ts` `MovieDetailsResponse`).
public struct MovieDetails: Codable, Sendable, Hashable, Identifiable {
    public var tmdbID: TMDbID
    public var imdbID: String?
    public var title: String
    public var tagline: String?
    public var overview: String?
    public var releaseDate: DateOnly?
    /// Minutes; nil or 0 when TMDb doesn't know.
    public var runtime: Int?
    /// TMDb's production status ("Released", "Post Production", "Canceled").
    public var status: String?
    public var posterURL: String?
    public var backdropURL: String?
    public var genres: [MovieGenre]
    /// Top billing, at most ten.
    public var cast: [CastMember]
    public var director: String?

    public var id: TMDbID { tmdbID }

    public init(
        tmdbID: TMDbID,
        imdbID: String? = nil,
        title: String,
        tagline: String? = nil,
        overview: String? = nil,
        releaseDate: DateOnly? = nil,
        runtime: Int? = nil,
        status: String? = nil,
        posterURL: String? = nil,
        backdropURL: String? = nil,
        genres: [MovieGenre] = [],
        cast: [CastMember] = [],
        director: String? = nil
    ) {
        self.tmdbID = tmdbID
        self.imdbID = imdbID
        self.title = title
        self.tagline = tagline
        self.overview = overview
        self.releaseDate = releaseDate
        self.runtime = runtime
        self.status = status
        self.posterURL = posterURL
        self.backdropURL = backdropURL
        self.genres = genres
        self.cast = cast
        self.director = director
    }

    public enum CodingKeys: String, CodingKey {
        case tmdbID = "tmdb_id"
        case imdbID = "imdb_id"
        case title
        case tagline
        case overview
        case releaseDate = "release_date"
        case runtime
        case status
        case posterURL = "poster_url"
        case backdropURL = "backdrop_url"
        case genres
        case cast
        case director
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        imdbID = try c.decodeIfPresent(String.self, forKey: .imdbID).flatMap { $0.isEmpty ? nil : $0 }
        title = try c.decode(String.self, forKey: .title)
        tagline = try c.decodeIfPresent(String.self, forKey: .tagline).flatMap { $0.isEmpty ? nil : $0 }
        overview = try c.decodeIfPresent(String.self, forKey: .overview).flatMap { $0.isEmpty ? nil : $0 }
        releaseDate = try c.decodeLenientDate(forKey: .releaseDate)
        runtime = try c.decodeInteger(forKey: .runtime)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        backdropURL = try c.decodeIfPresent(String.self, forKey: .backdropURL)
        genres = try c.decode([MovieGenre].self, forKey: .genres, default: [])
        cast = try c.decode([CastMember].self, forKey: .cast, default: [])
        director = try c.decodeIfPresent(String.self, forKey: .director).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The IMDb page, when TMDb links one.
    public var imdbURL: URL? {
        guard let imdbID, imdbID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else { return nil }
        return URL(string: "https://www.imdb.com/title/\(imdbID)")
    }
}

public struct MovieGenre: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String

    public init(id: Int, name: String) {
        self.id = id
        self.name = name
    }
}

public struct CastMember: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String
    public var character: String?
    public var profileURL: String?

    public init(id: Int, name: String, character: String? = nil, profileURL: String? = nil) {
        self.id = id
        self.name = name
        self.character = character
        self.profileURL = profileURL
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case name
        case character
        case profileURL = "profile_url"
    }
}

// MARK: - Display helpers

/// Movie facts as the iOS design writes them, with spoken forms for VoiceOver.
public enum MovieFacts {
    /// "1 hr 52 min", "2 hr", "45 min"; nil for an unknown or zero runtime.
    public static func runtime(_ minutes: Int?) -> String? {
        guard let minutes, minutes > 0 else { return nil }
        let hours = minutes / 60
        let mins = minutes % 60
        switch (hours, mins) {
        case (0, _): return "\(mins) min"
        case (_, 0): return "\(hours) hr"
        default: return "\(hours) hr \(mins) min"
        }
    }

    /// "1 hour 52 minutes": "hr" and "min" are read letter by letter.
    public static func spokenRuntime(_ minutes: Int?) -> String? {
        guard let minutes, minutes > 0 else { return nil }
        let hours = minutes / 60
        let mins = minutes % 60
        var parts: [String] = []
        if hours > 0 { parts.append("\(hours) \(hours == 1 ? "hour" : "hours")") }
        if mins > 0 { parts.append("\(mins) \(mins == 1 ? "minute" : "minutes")") }
        return parts.joined(separator: " ")
    }

    /// The release year as text ("2026"), or nil when the date is unknown.
    public static func year(_ date: DateOnly?) -> String? {
        date.map { String($0.year) }
    }

    /// The release line under a title: "Releases Oct 16", "Released Jul 17",
    /// or "Release date not announced" (F-06: unknown dates are explained).
    public static func releaseLine(_ date: DateOnly?, now: Date = Date()) -> String {
        guard let date else { return "Release date not announced" }
        let text = date.formatted(.full)
        return DateOnly.hasReleased(date, now: now) ? "Released \(text)" : "Releases \(text)"
    }
}

/// Title search input, normalized the way `search-movies` accepts it.
public enum MovieSearchQuery {
    /// `search-movies` refuses longer queries; a longer title is found by its first words.
    public static let maxLength = 100

    /// The trimmed query to send, or nil when there is nothing to search for.
    public static func normalized(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(maxLength)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The web's year filter: two years ahead through four years back,
    /// newest first (`MovieFilters.tsx`).
    public static func yearOptions(now: Date = Date()) -> [Int] {
        let current = DateOnly.today(now: now, timeZone: .gmt).year
        return Array((current - 4)...(current + 2)).reversed()
    }
}

// MARK: - Lenient decoding

extension KeyedDecodingContainer {
    /// A TMDb date: `YYYY-MM-DD`, or nil for null, "" and anything malformed.
    /// TMDb sends "" for unknown release dates; one bad date must not fail a
    /// whole page of results.
    func decodeLenientDate(forKey key: Key) throws -> DateOnly? {
        guard let string = try decodeIfPresent(String.self, forKey: key) else { return nil }
        return DateOnly(string)
    }
}
