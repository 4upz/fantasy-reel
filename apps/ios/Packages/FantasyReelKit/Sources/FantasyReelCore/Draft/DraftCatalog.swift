import Foundation

// The draft picker's lists and filters, as the web's `MoviePicker` offers them.
// Results come from `MovieRepository` (browse and search) and the wishlist.

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

extension MovieGenre {
    /// TMDb's movie genres, in the web filter's order.
    public static let tmdbMovieGenres: [MovieGenre] = [
        .init(id: 28, name: "Action"),
        .init(id: 12, name: "Adventure"),
        .init(id: 16, name: "Animation"),
        .init(id: 35, name: "Comedy"),
        .init(id: 80, name: "Crime"),
        .init(id: 99, name: "Documentary"),
        .init(id: 18, name: "Drama"),
        .init(id: 10751, name: "Family"),
        .init(id: 14, name: "Fantasy"),
        .init(id: 36, name: "History"),
        .init(id: 27, name: "Horror"),
        .init(id: 10402, name: "Music"),
        .init(id: 9648, name: "Mystery"),
        .init(id: 10749, name: "Romance"),
        .init(id: 878, name: "Science Fiction"),
        .init(id: 10770, name: "TV Movie"),
        .init(id: 53, name: "Thriller"),
        .init(id: 10752, name: "War"),
        .init(id: 37, name: "Western"),
    ]

    private static let namesByID = Dictionary(uniqueKeysWithValues: tmdbMovieGenres.map { ($0.id, $0.name) })

    /// The first known genre's name, for a row's meta line.
    public static func primaryName(of genreIDs: [Int]) -> String? {
        genreIDs.lazy.compactMap { namesByID[$0] }.first
    }
}
