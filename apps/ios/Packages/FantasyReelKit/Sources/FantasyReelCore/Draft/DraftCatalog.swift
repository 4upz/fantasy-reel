import Foundation

// The draft's movie picker catalog: `browse-movies`, `search-movies` and the
// signed-in user's wishlist, as the web's `useDraftMovies` reads them.

/// One movie in a browse or search page. TMDb data, not a `movies` row: most
/// of these have never been drafted, so there is no `movies.id` yet.
public struct CatalogMovie: Codable, Sendable, Hashable, Identifiable {
    public var tmdbID: TMDbID
    public var title: String
    public var overview: String?
    public var releaseDate: DateOnly?
    /// A bare TMDb path; resolve with `TMDbImage.posterURL`.
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
        // TMDb sends "" for an unknown date.
        releaseDate = try? c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        genreIDs = try c.decode([Int].self, forKey: .genreIDs, default: [])
    }

    /// The first genre's name, for the row's meta line.
    public var primaryGenre: String? {
        genreIDs.lazy.compactMap(MovieGenre.init(rawValue:)).first?.title
    }
}

/// One page of `browse-movies` or `search-movies`.
public struct CatalogPage: Decodable, Sendable, Hashable {
    public var page: Int
    public var totalPages: Int
    public var results: [CatalogMovie]

    public init(page: Int, totalPages: Int, results: [CatalogMovie]) {
        self.page = page
        self.totalPages = totalPages
        self.results = results
    }

    public var hasMore: Bool { page < totalPages }

    private enum CodingKeys: String, CodingKey {
        case page
        case totalPages = "total_pages"
        case hasMore = "has_more"
        case results
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        page = try c.decodeInteger(forKey: .page) ?? 1
        let pages = try c.decodeInteger(forKey: .totalPages) ?? page
        // `has_more` wins when present: trending caps its pages below TMDb's count.
        if let hasMore = try c.decodeIfPresent(Bool.self, forKey: .hasMore) {
            totalPages = hasMore ? max(pages, page + 1) : page
        } else {
            totalPages = pages
        }
        results = try c.decode([CatalogMovie].self, forKey: .results, default: [])
    }
}

/// `browse-movies` `release_window`.
public enum ReleaseWindow: String, Codable, Sendable, Hashable, CaseIterable, Identifiable {
    case year
    case next30
    case quarter
    case all

    public var id: Self { self }

    /// The web's labels; "all" reads as the eligibility horizon.
    public func title(seasonYear: Int) -> String {
        switch self {
        case .year: "This Year"
        case .next30: "Next 30 Days"
        case .quarter: "Next 90 Days"
        case .all: "Through \(seasonYear + 2)"
        }
    }
}

/// TMDb's movie genres, in the web filter's order.
public enum MovieGenre: Int, Codable, Sendable, Hashable, CaseIterable, Identifiable {
    case action = 28
    case adventure = 12
    case animation = 16
    case comedy = 35
    case crime = 80
    case documentary = 99
    case drama = 18
    case family = 10751
    case fantasy = 14
    case history = 36
    case horror = 27
    case music = 10402
    case mystery = 9648
    case romance = 10749
    case scienceFiction = 878
    case tvMovie = 10770
    case thriller = 53
    case war = 10752
    case western = 37

    public var id: Int { rawValue }

    public var title: String {
        switch self {
        case .action: "Action"
        case .adventure: "Adventure"
        case .animation: "Animation"
        case .comedy: "Comedy"
        case .crime: "Crime"
        case .documentary: "Documentary"
        case .drama: "Drama"
        case .family: "Family"
        case .fantasy: "Fantasy"
        case .history: "History"
        case .horror: "Horror"
        case .music: "Music"
        case .mystery: "Mystery"
        case .romance: "Romance"
        case .scienceFiction: "Science Fiction"
        case .tvMovie: "TV Movie"
        case .thriller: "Thriller"
        case .war: "War"
        case .western: "Western"
        }
    }
}

/// The picker's tabs (mockup V2MoviePicker: All, Trending, Soon, Wishlist).
public enum CatalogTab: String, Sendable, Hashable, CaseIterable, Identifiable {
    case all
    case trending
    case soon
    case wishlist

    public var id: Self { self }

    public var title: String {
        switch self {
        case .all: "All"
        case .trending: "Trending"
        case .soon: "Soon"
        case .wishlist: "Wishlist"
        }
    }

    /// Genre and window filters apply to TMDb discover only: not to trending,
    /// a title search, or the wishlist.
    public var supportsFilters: Bool { self == .all || self == .soon }
}

/// What to fetch for one catalog page.
public enum CatalogRequest: Sendable, Hashable {
    case browse(window: ReleaseWindow, genres: [MovieGenre])
    case trending
    case search(String)
}

/// A wishlist row (`wishlisted_movies`), the picker's Wishlist tab.
public struct WishlistedMovie: Codable, Sendable, Hashable, Identifiable {
    public var tmdbID: TMDbID
    public var title: String
    public var posterURL: String?
    public var addedAt: Date?

    public var id: TMDbID { tmdbID }

    public init(tmdbID: TMDbID, title: String, posterURL: String? = nil, addedAt: Date? = nil) {
        self.tmdbID = tmdbID
        self.title = title
        self.posterURL = posterURL
        self.addedAt = addedAt
    }

    public enum CodingKeys: String, CodingKey {
        case tmdbID = "tmdb_id"
        case title
        case posterURL = "poster_url"
        case addedAt = "added_at"
    }

    public var catalogMovie: CatalogMovie {
        CatalogMovie(tmdbID: tmdbID, title: title, posterURL: posterURL)
    }
}
