import FantasyReelCore
import Foundation

// Fakes for movie research and the wishlist, for SwiftUI previews,
// screenshots and tests. `failure` makes every call throw.

public actor InMemoryMovieRepository: MovieRepository {
    public var catalog: [MovieSearchResult]
    public var details: [TMDbID: MovieDetails]
    public var histories: [TMDbID: FranchiseHistory]
    public var projectionsResponse: MovieProjectionsResponse
    public var pageSize: Int
    public var failure: APIError?
    /// Requests seen, newest last (tests check what was sent).
    public private(set) var searches: [MovieSearchRequest] = []

    public init(
        catalog: [MovieSearchResult] = [],
        details: [TMDbID: MovieDetails] = [:],
        histories: [TMDbID: FranchiseHistory] = [:],
        projections: MovieProjectionsResponse = .disabled,
        pageSize: Int = 20,
        failure: APIError? = nil
    ) {
        self.catalog = catalog
        self.details = details
        self.histories = histories
        self.projectionsResponse = projections
        self.pageSize = pageSize
        self.failure = failure
    }

    public func setFailure(_ failure: APIError?) { self.failure = failure }

    public func search(_ request: MovieSearchRequest) async throws(APIError) -> DiscoveryPage<MovieSearchResult> {
        searches.append(request)
        if let failure { throw failure }
        let matches = catalog.filter { movie in
            movie.title.localizedCaseInsensitiveContains(request.query)
                && (request.year == nil || movie.releaseDate?.year == request.year)
        }
        return page(matches, number: request.page)
    }

    public func browse(_ request: MovieBrowseRequest) async throws(APIError) -> DiscoveryPage<MovieSearchResult> {
        if let failure { throw failure }
        return page(catalog, number: request.page)
    }

    public func details(_ tmdbID: TMDbID) async throws(APIError) -> MovieDetails {
        if let failure { throw failure }
        if let found = details[tmdbID] { return found }
        if let result = catalog.first(where: { $0.tmdbID == tmdbID }) {
            return MovieDetails(
                tmdbID: tmdbID, title: result.title, overview: result.overview,
                releaseDate: result.releaseDate, posterURL: result.posterURL
            )
        }
        throw .server(.init(status: 404, message: "Movie not found"))
    }

    public func franchiseHistories(_ tmdbIDs: [TMDbID]) async throws(APIError) -> [TMDbID: FranchiseHistory?] {
        if let failure { throw failure }
        var result: [TMDbID: FranchiseHistory?] = [:]
        for id in tmdbIDs { result[id] = .some(histories[id]) }
        return result
    }

    public func projections(league: LeagueID, tmdbIDs: [TMDbID]) async throws(APIError) -> MovieProjectionsResponse {
        if let failure { throw failure }
        return projectionsResponse
    }

    private func page(_ items: [MovieSearchResult], number: Int) -> DiscoveryPage<MovieSearchResult> {
        let size = max(pageSize, 1)
        let totalPages = max(1, (items.count + size - 1) / size)
        let start = min((number - 1) * size, items.count)
        let slice = Array(items[start..<min(start + size, items.count)])
        return DiscoveryPage(page: number, totalPages: totalPages, totalResults: items.count, results: slice)
    }
}

public actor InMemoryWishlistRepository: WishlistRepository {
    public var rows: [WishlistedMovie]
    /// Users whose wishlists are shared.
    public var sharing: Set<UserID>
    public var failure: APIError?
    /// When set, only writes fail (a failed toggle must roll back).
    public var writeFailure: APIError?

    public init(rows: [WishlistedMovie] = [], sharing: Set<UserID> = [], failure: APIError? = nil, writeFailure: APIError? = nil) {
        self.rows = rows
        self.sharing = sharing
        self.failure = failure
        self.writeFailure = writeFailure
    }

    public func setWriteFailure(_ failure: APIError?) { writeFailure = failure }

    public func fetchWishlist(of userID: UserID) async throws(APIError) -> [WishlistedMovie] {
        if let failure { throw failure }
        return WishlistSort.dateAdded.sorted(rows.filter { $0.userID == userID })
    }

    public func add(_ movie: WishlistInsert, for userID: UserID) async throws(APIError) -> WishlistedMovie {
        if let failure = writeFailure ?? failure { throw failure }
        if let existing = rows.first(where: { $0.userID == userID && $0.tmdbID == movie.tmdbID }) { return existing }
        guard rows.filter({ $0.userID == userID }).count < WishlistLimits.maxCount else {
            throw .server(.init(status: nil, message: WishlistLimits.fullMessage, code: "23514"))
        }
        let row = WishlistedMovie(
            id: WishlistItemID(UUID().uuidString.lowercased()), userID: userID, tmdbID: movie.tmdbID,
            title: movie.title, posterURL: movie.posterURL, addedAt: Date()
        )
        rows.append(row)
        return row
    }

    public func remove(_ tmdbID: TMDbID, for userID: UserID) async throws(APIError) {
        if let failure = writeFailure ?? failure { throw failure }
        rows.removeAll { $0.userID == userID && $0.tmdbID == tmdbID }
    }

    public func fetchSharing(for userID: UserID) async throws(APIError) -> Bool {
        if let failure { throw failure }
        return sharing.contains(userID)
    }

    public func setSharing(_ isShared: Bool, for userID: UserID) async throws(APIError) {
        if let failure = writeFailure ?? failure { throw failure }
        if isShared { sharing.insert(userID) } else { sharing.remove(userID) }
    }

    public func fetchVisibleCounts(of userIDs: [UserID]) async throws(APIError) -> [UserID: Int] {
        if let failure { throw failure }
        var counts: [UserID: Int] = [:]
        for row in rows where userIDs.contains(row.userID) { counts[row.userID, default: 0] += 1 }
        return counts
    }
}

public actor InMemoryLeagueMovieRepository: LeagueMovieRepository {
    public var holdings: [TeamHolding]
    public var movies: [Movie]
    public var failure: APIError?

    public init(holdings: [TeamHolding] = [], movies: [Movie] = [], failure: APIError? = nil) {
        self.holdings = holdings
        self.movies = movies
        self.failure = failure
    }

    public func fetchHolders(in leagueID: LeagueID) async throws(APIError) -> [HoldingSummary] {
        if let failure { throw failure }
        return holdings
            .filter { $0.leagueID == leagueID }
            .map { HoldingSummary(tmdbID: $0.tmdbID, teamID: $0.teamID, teamName: $0.teamName, source: $0.source) }
    }

    public func fetchHolding(of tmdbID: TMDbID, in leagueID: LeagueID) async throws(APIError) -> TeamHolding? {
        if let failure { throw failure }
        return holdings.first { $0.leagueID == leagueID && $0.tmdbID == tmdbID }
    }

    public func fetchMovie(_ tmdbID: TMDbID) async throws(APIError) -> Movie? {
        if let failure { throw failure }
        return movies.first { $0.tmdbID == tmdbID }
    }
}
