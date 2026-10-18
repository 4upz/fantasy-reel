import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// Title search with paging (`search-movies`), shared by the search tab and
/// any sheet that picks a movie (bids, the draft picker). The view drives it:
/// `.task(id: model.filter) { await model.run() }` debounces typing, and a
/// newer filter always wins over a slower older response.
@Observable
@MainActor
final class MovieSearchModel {
    struct Filter: Hashable {
        var query: String = ""
        var year: Int?
    }

    enum Phase: Equatable {
        /// No query yet: the screen shows its idle content.
        case idle
        case searching
        case results
        case noResults
        case failed(String)
    }

    var filter = Filter()
    private(set) var phase: Phase = .idle
    private(set) var results: [MovieSearchResult] = []
    private(set) var totalResults = 0
    private(set) var hasMore = false
    private(set) var isLoadingMore = false
    private(set) var loadMoreError: String?
    /// The query of the results on screen (for "No results for …" and history).
    private(set) var shownQuery: String?

    private let movies: any MovieRepository
    private let upcomingOnly: Bool
    private let seasonYear: Int?
    private var page = 0
    private var generation = 0
    /// Pages with nothing new (a fully filtered TMDb page) are skipped; stop
    /// after a few so a sparse query can't page forever.
    private let maxEmptyPagesSkipped = 3
    static let debounce: Duration = .milliseconds(300)

    /// - Parameters:
    ///   - upcomingOnly: only movies still acquirable in `seasonYear` (bid and
    ///     draft pickers). Research search leaves it off.
    init(movies: any MovieRepository, upcomingOnly: Bool = false, seasonYear: Int? = nil) {
        self.movies = movies
        self.upcomingOnly = upcomingOnly
        self.seasonYear = seasonYear
    }

    var normalizedQuery: String? { MovieSearchQuery.normalized(filter.query) }

    /// Searches for the current filter after a short pause. Call from
    /// `.task(id: filter)`, which cancels the previous call as the person types.
    func run() async {
        guard let query = normalizedQuery else {
            generation += 1
            reset(to: .idle)
            return
        }
        // Results for this exact filter are already on screen (a view
        // reappearing reruns its task).
        if lastFilter == filter, phase == .results || phase == .noResults { return }
        let token = generation
        do {
            try await Task.sleep(for: Self.debounce)
        } catch {
            return
        }
        // The Search key ran this filter while we waited.
        guard token == generation else { return }
        await search(query)
    }

    /// Runs the current filter now, skipping the debounce (the keyboard's
    /// Search key, Try Again).
    func submit() async {
        guard let query = normalizedQuery else { return }
        await search(query)
    }

    func loadMore() async {
        guard hasMore, !isLoadingMore, !isSearching, phase == .results,
              let query = shownQuery, let shownFilter = lastFilter else { return }
        let token = generation
        isLoadingMore = true
        loadMoreError = nil
        defer { if token == generation { isLoadingMore = false } }
        do {
            let found = try await fetch(query, year: shownFilter.year, from: page + 1, token: token)
            guard token == generation else { return }
            append(found)
        } catch {
            guard token == generation, !error.isCancellation else { return }
            loadMoreError = error.userMessage
        }
    }

    // MARK: - Private

    private var lastFilter: Filter?
    /// A new search is in flight; paging the old results would mix them in.
    private var isSearching = false

    private func search(_ query: String) async {
        generation += 1
        let token = generation
        let filterAtStart = filter
        isLoadingMore = false
        isSearching = true
        defer { if token == generation { isSearching = false } }
        if phase != .results { phase = .searching }
        loadMoreError = nil
        do {
            let found = try await fetch(query, year: filterAtStart.year, from: 1, token: token)
            guard token == generation else { return }
            results = []
            page = 0
            shownQuery = query
            lastFilter = filterAtStart
            append(found)
            phase = results.isEmpty ? .noResults : .results
        } catch {
            guard token == generation, !error.isCancellation else { return }
            results = []
            page = 0
            hasMore = false
            shownQuery = query
            lastFilter = nil
            phase = .failed(error.userMessage)
        }
    }

    private struct Fetched {
        var page: Int
        var hasMore: Bool
        var totalResults: Int
        var results: [MovieSearchResult]
    }

    /// Reads `start`, skipping ahead over pages that add nothing new.
    private func fetch(_ query: String, year: Int?, from start: Int, token: Int) async throws(APIError) -> Fetched {
        var number = start
        var skipped = 0
        while true {
            let request = MovieSearchRequest(
                query: query, page: number, year: year, upcomingOnly: upcomingOnly, seasonYear: seasonYear
            )
            let response = try await movies.search(request)
            let seen = start == 1 ? Set<TMDbID>() : Set(results.map(\.tmdbID))
            let fresh = response.results.filter { !seen.contains($0.tmdbID) }
            if !fresh.isEmpty || !response.hasMore || skipped >= maxEmptyPagesSkipped || token != generation {
                return Fetched(page: response.page, hasMore: response.hasMore, totalResults: response.totalResults, results: fresh)
            }
            skipped += 1
            number = response.page + 1
        }
    }

    private func append(_ fetched: Fetched) {
        var seen = Set(results.map(\.tmdbID))
        results += fetched.results.filter { seen.insert($0.tmdbID).inserted }
        page = fetched.page
        hasMore = fetched.hasMore
        totalResults = fetched.totalResults
    }

    private func reset(to phase: Phase) {
        self.phase = phase
        results = []
        page = 0
        hasMore = false
        totalResults = 0
        shownQuery = nil
        lastFilter = nil
        loadMoreError = nil
        isLoadingMore = false
        isSearching = false
    }
}
