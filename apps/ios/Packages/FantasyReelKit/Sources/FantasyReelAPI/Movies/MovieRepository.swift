import FantasyReelCore
import Foundation

/// Movie research through the TMDb-backed Edge Functions (F-06). Every call is
/// throttled per user on the server; a 429 arrives as `APIError.rateLimited`,
/// a "slow down" state rather than an empty result.
public protocol MovieRepository: Sendable {
    /// Title search (`search-movies`).
    func search(_ request: MovieSearchRequest) async throws(APIError) -> DiscoveryPage<MovieSearchResult>
    /// Discovery without a query (`browse-movies`), for the draft picker.
    func browse(_ request: MovieBrowseRequest) async throws(APIError) -> DiscoveryPage<MovieSearchResult>
    /// Full details (`get-movie-details`).
    func details(_ tmdbID: TMDbID) async throws(APIError) -> MovieDetails
    /// Franchise histories (`get-franchise-history`). A movie with no
    /// franchise maps to nil; batch the ids a screen shows.
    func franchiseHistories(_ tmdbIDs: [TMDbID]) async throws(APIError) -> [TMDbID: FranchiseHistory?]
    /// Projected scores, Beta (`get-movie-projections`). `.disabled` unless the
    /// server turns them on for this league's series (F-19).
    func projections(league: LeagueID, tmdbIDs: [TMDbID]) async throws(APIError) -> MovieProjectionsResponse
}

public struct MovieSearchRequest: Encodable, Sendable, Hashable {
    public var query: String
    public var page: Int
    public var year: Int?
    /// Only movies still acquirable in `seasonYear` (draft and bid contexts).
    public var upcomingOnly: Bool
    public var seasonYear: Int?

    public init(query: String, page: Int = 1, year: Int? = nil, upcomingOnly: Bool = false, seasonYear: Int? = nil) {
        self.query = query
        self.page = page
        self.year = year
        self.upcomingOnly = upcomingOnly
        self.seasonYear = seasonYear
    }

    public enum CodingKeys: String, CodingKey {
        case query
        case page
        case year
        case upcomingOnly = "upcoming_only"
        case seasonYear = "season_year"
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(query, forKey: .query)
        try c.encode(page, forKey: .page)
        try c.encodeIfPresent(year, forKey: .year)
        if upcomingOnly { try c.encode(true, forKey: .upcomingOnly) }
        try c.encodeIfPresent(seasonYear, forKey: .seasonYear)
    }
}

public struct MovieBrowseRequest: Encodable, Sendable, Hashable {
    /// `browse-movies` windows: next 30 days, next 90, this year, through
    /// the current year + 2.
    public enum ReleaseWindow: String, Encodable, Sendable, CaseIterable {
        case next30
        case quarter
        case year
        case all
    }

    public enum SortBy: String, Encodable, Sendable {
        case popularity
        case releaseDate = "release_date"
    }

    public var page: Int
    public var genres: [Int]
    public var releaseWindow: ReleaseWindow?
    public var sortBy: SortBy?
    public var trending: Bool
    public var seasonYear: Int?

    public init(
        page: Int = 1,
        genres: [Int] = [],
        releaseWindow: ReleaseWindow? = nil,
        sortBy: SortBy? = nil,
        trending: Bool = false,
        seasonYear: Int? = nil
    ) {
        self.page = page
        self.genres = genres
        self.releaseWindow = releaseWindow
        self.sortBy = sortBy
        self.trending = trending
        self.seasonYear = seasonYear
    }

    public enum CodingKeys: String, CodingKey {
        case page
        case genres
        case releaseWindow = "release_window"
        case sortBy = "sort_by"
        case trending
        case seasonYear = "season_year"
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(page, forKey: .page)
        if !genres.isEmpty { try c.encode(genres, forKey: .genres) }
        try c.encodeIfPresent(releaseWindow, forKey: .releaseWindow)
        try c.encodeIfPresent(sortBy, forKey: .sortBy)
        if trending { try c.encode(true, forKey: .trending) }
        try c.encodeIfPresent(seasonYear, forKey: .seasonYear)
    }
}

public struct EdgeMovieRepository: MovieRepository {
    /// `get-franchise-history` takes at most 40 ids per call.
    static let franchiseBatchSize = 40
    /// `get-movie-projections` takes 1–100 ids per call.
    static let projectionBatchSize = 100
    /// Research reads are cheap to repeat; don't hold a screen for the full
    /// mutation deadline.
    static let readTimeout: Duration = .seconds(20)

    private let functions: EdgeFunctionClient

    public init(functions: EdgeFunctionClient) {
        self.functions = functions
    }

    public func search(_ request: MovieSearchRequest) async throws(APIError) -> DiscoveryPage<MovieSearchResult> {
        try await functions.invoke("search-movies", body: request, timeout: Self.readTimeout)
    }

    public func browse(_ request: MovieBrowseRequest) async throws(APIError) -> DiscoveryPage<MovieSearchResult> {
        try await functions.invoke("browse-movies", body: request, timeout: Self.readTimeout)
    }

    public func details(_ tmdbID: TMDbID) async throws(APIError) -> MovieDetails {
        try await functions.invoke("get-movie-details", body: TMDbIDBody(tmdbID: tmdbID), timeout: Self.readTimeout)
    }

    public func franchiseHistories(_ tmdbIDs: [TMDbID]) async throws(APIError) -> [TMDbID: FranchiseHistory?] {
        var result: [TMDbID: FranchiseHistory?] = [:]
        for batch in Self.unique(tmdbIDs).chunked(into: Self.franchiseBatchSize) {
            let response: FranchiseHistoriesResponse = try await functions.invoke(
                "get-franchise-history", body: TMDbIDsBody(tmdbIDs: batch), timeout: Self.readTimeout
            )
            result.merge(response.byTMDbID) { _, new in new }
        }
        return result
    }

    public func projections(league: LeagueID, tmdbIDs: [TMDbID]) async throws(APIError) -> MovieProjectionsResponse {
        var merged: [TMDbID: MovieProjection] = [:]
        var version = 0
        for batch in Self.unique(tmdbIDs).chunked(into: Self.projectionBatchSize) {
            let response: MovieProjectionsResponse = try await functions.invoke(
                "get-movie-projections",
                body: ProjectionsBody(leagueID: league, tmdbIDs: batch),
                timeout: Self.readTimeout
            )
            // Off is decided by the server for the whole league: one "off"
            // answer means show nothing, never a partial set.
            guard case .enabled(let modelVersion, let projections) = response else { return .disabled }
            version = max(version, modelVersion)
            merged.merge(projections) { _, new in new }
        }
        return .enabled(modelVersion: version, projections: merged)
    }

    private static func unique(_ ids: [TMDbID]) -> [TMDbID] {
        var seen: Set<TMDbID> = []
        return ids.filter { $0.rawValue > 0 && seen.insert($0).inserted }
    }
}

private struct TMDbIDBody: Encodable, Sendable {
    let tmdbID: TMDbID
    enum CodingKeys: String, CodingKey { case tmdbID = "tmdb_id" }
}

private struct TMDbIDsBody: Encodable, Sendable {
    let tmdbIDs: [TMDbID]
    enum CodingKeys: String, CodingKey { case tmdbIDs = "tmdb_ids" }
}

private struct ProjectionsBody: Encodable, Sendable {
    let leagueID: LeagueID
    let tmdbIDs: [TMDbID]
    enum CodingKeys: String, CodingKey {
        case leagueID = "league_id"
        case tmdbIDs = "tmdb_ids"
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0, !isEmpty else { return isEmpty ? [] : [self] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
