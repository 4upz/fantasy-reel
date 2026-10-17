import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// A draft room as a `ShellSheet` payload: equal by identity, so presenting
/// the picker twice for the same room is the same sheet.
struct DraftRoomHandle: Hashable {
    let model: DraftRoomModel

    init(_ model: DraftRoomModel) {
        self.model = model
    }

    static func == (lhs: DraftRoomHandle, rhs: DraftRoomHandle) -> Bool {
        lhs.model === rhs.model
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(ObjectIdentifier(model))
    }
}

/// The picker's catalog state (the web's `MoviePicker` + `useDraftMovies`):
/// tab, search, filters, and paged results from `MovieRepository`.
///
/// Movies already drafted when a page arrives are left out; a movie drafted
/// while the list is on screen stays in place, marked, so nothing shifts
/// under a tap. Up to three pages load on their own when a page brings no
/// eligible movie.
@Observable
@MainActor
final class DraftMoviePickerModel {
    typealias ReleaseWindow = MovieBrowseRequest.ReleaseWindow

    enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    var tab: CatalogTab = .all
    var query = ""
    var window: ReleaseWindow = .year
    var genres: Set<Int> = []

    private(set) var movies: [MovieSearchResult] = []
    private(set) var phase: Phase = .loading
    private(set) var hasMore = false
    private(set) var isLoadingMore = false
    private(set) var loadMoreError: String?

    private let repository: any MovieRepository
    private let wishlist: WishlistStore
    private let seasonYear: Int
    private var pagesLoaded = 0
    /// Bumped by every reload so a slow page from an old query is dropped.
    private var generation = 0

    static let automaticPageLimit = 3

    init(movies: any MovieRepository, wishlist: WishlistStore, seasonYear: Int) {
        self.repository = movies
        self.wishlist = wishlist
        self.seasonYear = seasonYear
    }

    var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Filters apply to discover browsing only; a title search ignores them.
    var filtersApply: Bool { tab.supportsFilters && trimmedQuery.isEmpty }

    var activeFilterCount: Int {
        (tab == .all && window != .year ? 1 : 0) + genres.count
    }

    /// Starts over for the current tab, search and filters.
    func reload(excluding drafted: Set<TMDbID>) async {
        generation += 1
        let current = generation
        movies = []
        pagesLoaded = 0
        hasMore = false
        isLoadingMore = false
        loadMoreError = nil
        phase = .loading

        if tab == .wishlist {
            await loadWishlist(generation: current)
            return
        }
        do {
            let page = try await fetch(page: 1)
            guard current == generation else { return }
            append(page, excluding: drafted)
            phase = .loaded
        } catch {
            guard current == generation, !error.isCancellation else { return }
            phase = .failed(error.userMessage)
            return
        }
        // A page of only drafted movies moves on by itself, a few pages at most.
        while movies.isEmpty, hasMore, pagesLoaded < Self.automaticPageLimit, current == generation {
            guard await loadMore(excluding: drafted) else { return }
        }
    }

    /// The next page, when the user reaches the end of the list. Returns
    /// false when nothing was loaded (already loading, no more, or failed).
    @discardableResult
    func loadMore(excluding drafted: Set<TMDbID>) async -> Bool {
        guard tab != .wishlist, phase == .loaded, hasMore, !isLoadingMore else { return false }
        let current = generation
        isLoadingMore = true
        defer { if current == generation { isLoadingMore = false } }
        do {
            let page = try await fetch(page: pagesLoaded + 1)
            guard current == generation else { return false }
            loadMoreError = nil
            append(page, excluding: drafted)
            return true
        } catch {
            guard current == generation, !error.isCancellation else { return false }
            loadMoreError = error.userMessage
            return false
        }
    }

    private func fetch(page: Int) async throws(APIError) -> DiscoveryPage<MovieSearchResult> {
        if !trimmedQuery.isEmpty {
            return try await repository.search(MovieSearchRequest(
                query: trimmedQuery, page: page, upcomingOnly: true, seasonYear: seasonYear
            ))
        }
        let genreIDs = genres.sorted()
        let request = switch tab {
        case .trending:
            MovieBrowseRequest(page: page, trending: true, seasonYear: seasonYear)
        case .soon:
            MovieBrowseRequest(page: page, genres: genreIDs, releaseWindow: .next30, sortBy: .popularity, seasonYear: seasonYear)
        case .all, .wishlist:
            MovieBrowseRequest(page: page, genres: genreIDs, releaseWindow: window, sortBy: .popularity, seasonYear: seasonYear)
        }
        return try await repository.browse(request)
    }

    private func append(_ page: DiscoveryPage<MovieSearchResult>, excluding drafted: Set<TMDbID>) {
        let known = Set(movies.map(\.tmdbID))
        movies += page.results.filter { !drafted.contains($0.tmdbID) && !known.contains($0.tmdbID) }
        pagesLoaded = page.page
        hasMore = page.hasMore
    }

    /// The shared wishlist, searched locally like the web.
    private func loadWishlist(generation current: Int) async {
        if wishlist.state.value == nil { await wishlist.load() }
        guard current == generation else { return }
        if case .failed(let message) = wishlist.state {
            phase = .failed(message)
            return
        }
        let query = trimmedQuery
        movies = wishlist.movies
            .filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
            .map { MovieSearchResult(tmdbID: $0.tmdbID, title: $0.title, posterURL: $0.posterURL) }
        phase = .loaded
    }
}

extension MovieBrowseRequest.ReleaseWindow {
    /// The web's labels; "all" reads as the eligibility horizon.
    func title(seasonYear: Int) -> String {
        switch self {
        case .year: "This Year"
        case .next30: "Next 30 Days"
        case .quarter: "Next 90 Days"
        case .all: "Through \(seasonYear + 2)"
        }
    }
}
