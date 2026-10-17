import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// Everything the movie detail screen shows, read together: TMDb details
/// (required), then the parts that only add to it (our score of record, the
/// season's holding, franchise history, a Beta projection). A failed extra
/// leaves its section out with a note rather than failing the screen.
@Observable
@MainActor
final class LeagueMovieDetailModel {
    private(set) var state: LoadState<MovieDetails> = .idle
    /// Our `movies` row: the Rotten Tomatoes score and default-rule points.
    private(set) var movie: Movie?
    /// The season's holding of this movie (`team_holdings`), if any.
    private(set) var holding: TeamHolding?
    private(set) var franchise: FranchiseHistory?
    private(set) var projection: MovieProjection?
    /// Set when the league or score reads failed (the screen still shows TMDb data).
    private(set) var leagueError: String?
    private(set) var franchiseError: String?

    let tmdbID: TMDbID
    private let movies: any MovieRepository
    private let leagueMovies: any LeagueMovieRepository

    init(tmdbID: TMDbID, movies: any MovieRepository, leagueMovies: any LeagueMovieRepository) {
        self.tmdbID = tmdbID
        self.movies = movies
        self.leagueMovies = leagueMovies
    }

    /// Reads (or rereads) the movie in a season, or outside one when `league`
    /// is nil. Safe to call again after a bid, drop or trade elsewhere.
    func load(league: League?) async {
        if state.value == nil { state = .loading }
        let tmdbID = tmdbID
        let movies = movies
        let leagueMovies = leagueMovies

        async let details = Self.attempt { () async throws(APIError) in try await movies.details(tmdbID) }
        async let movieRow = Self.attempt { () async throws(APIError) in try await leagueMovies.fetchMovie(tmdbID) }
        async let holdingRow = Self.attempt { () async throws(APIError) -> TeamHolding? in
            guard let league else { return nil }
            return try await leagueMovies.fetchHolding(of: tmdbID, in: league.id)
        }
        async let history = Self.attempt { () async throws(APIError) in try await movies.franchiseHistories([tmdbID]) }
        async let projections = Self.attempt { () async throws(APIError) -> MovieProjectionsResponse in
            // Projections are for movies still to be decided in a live season.
            guard let league, league.status != .completed else { return .disabled }
            return try await movies.projections(league: league.id, tmdbIDs: [tmdbID])
        }

        let (detailsResult, movieResult, holdingResult, historyResult, projectionResult) =
            await (details, movieRow, holdingRow, history, projections)

        switch detailsResult {
        case .success(let loaded):
            state = .loaded(loaded)
        case .failure(let error):
            if error.isCancellation { return }
            // Keep a screen that already loaded; a refresh failure only notes it.
            if state.value == nil {
                state = .failed(message: error.status == 404
                    ? "TMDb doesn't have this movie any more."
                    : "Couldn't load this movie. \(error.userMessage)")
                return
            }
        }

        var leagueFailure: APIError?
        switch movieResult {
        case .success(let row): movie = row
        case .failure(let error): leagueFailure = error
        }
        switch holdingResult {
        case .success(let row): holding = row
        case .failure(let error): leagueFailure = leagueFailure ?? error
        }
        leagueError = leagueFailure.flatMap { $0.isCancellation ? nil : "Couldn't load the score and who holds it. \($0.userMessage)" }

        switch historyResult {
        case .success(let histories):
            franchise = histories[tmdbID] ?? nil
            franchiseError = nil
        case .failure(let error):
            franchiseError = error.isCancellation ? nil : "Couldn't load franchise history. \(error.userMessage)"
        }

        // A projection is a Beta extra: when it can't be read, the card is
        // simply absent, as it is when the feature is off.
        if case .success(let response) = projectionResult {
            projection = response.projection(for: tmdbID)
        }
    }

    private static func attempt<T: Sendable>(
        _ operation: @Sendable () async throws(APIError) -> T
    ) async -> Result<T, APIError> {
        do {
            return .success(try await operation())
        } catch {
            return .failure(error)
        }
    }
}
