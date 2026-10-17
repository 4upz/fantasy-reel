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
/// tab, search, filters, and paged results.
///
/// Movies already drafted when a page arrives are left out; a movie drafted
/// while the list is on screen stays in place, marked, so nothing shifts
/// under a tap. Up to three pages load on their own when a page brings no
/// eligible movie.
@Observable
@MainActor
final class DraftMoviePickerModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    var tab: CatalogTab = .all
    var query = ""
    var window: ReleaseWindow = .year
    var genres: Set<MovieGenre> = []

    private(set) var movies: [CatalogMovie] = []
    private(set) var phase: Phase = .loading
    private(set) var hasMore = false
    private(set) var isLoadingMore = false
    private(set) var loadMoreError: String?

    private let catalog: any DraftMovieCatalog
    private let userID: UserID
    private let seasonYear: Int
    private var wishlist: [WishlistedMovie]?
    private var pagesLoaded = 0
    /// Bumped by every reload so a slow page from an old query is dropped.
    private var generation = 0

    static let automaticPageLimit = 3

    init(catalog: any DraftMovieCatalog, userID: UserID, seasonYear: Int) {
        self.catalog = catalog
        self.userID = userID
        self.seasonYear = seasonYear
    }

    var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Filters apply to discover browsing only; a title search ignores them.
    var filtersApply: Bool { tab.supportsFilters && trimmedQuery.isEmpty }

    var activeFilterCount: Int {
        (tab == .all && window != .year ? 1 : 0) + genres.count
    }

    private var request: CatalogRequest? {
        if tab == .wishlist { return nil }
        if !trimmedQuery.isEmpty { return .search(trimmedQuery) }
        switch tab {
        case .trending: return .trending
        case .soon: return .browse(window: .next30, genres: genres.sorted { $0.rawValue < $1.rawValue })
        case .all, .wishlist: return .browse(window: window, genres: genres.sorted { $0.rawValue < $1.rawValue })
        }
    }

    /// Starts over for the current tab, search and filters.
    func reload(excluding drafted: Set<TMDbID>) async {
        generation += 1
        let current = generation
        movies = []
        pagesLoaded = 0
        hasMore = false
        loadMoreError = nil
        phase = .loading

        guard let request else {
            await loadWishlist(generation: current)
            return
        }
        do {
            let page = try await catalog.page(request, page: 1, seasonYear: seasonYear)
            guard current == generation else { return }
            append(page, excluding: drafted)
            phase = .loaded
            await autoAdvance(request, excluding: drafted, generation: current)
        } catch {
            guard current == generation, !error.isCancellation else { return }
            phase = .failed(error.userMessage)
        }
    }

    /// The next page, when the user reaches the end of the list.
    func loadMore(excluding drafted: Set<TMDbID>) async {
        guard let request, phase == .loaded, hasMore, !isLoadingMore else { return }
        let current = generation
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await catalog.page(request, page: pagesLoaded + 1, seasonYear: seasonYear)
            guard current == generation else { return }
            loadMoreError = nil
            append(page, excluding: drafted)
        } catch {
            guard current == generation, !error.isCancellation else { return }
            loadMoreError = error.userMessage
        }
    }

    private func autoAdvance(_ request: CatalogRequest, excluding drafted: Set<TMDbID>, generation current: Int) async {
        while movies.isEmpty, hasMore, pagesLoaded < Self.automaticPageLimit, current == generation {
            await loadMore(excluding: drafted)
            if loadMoreError != nil { return }
        }
    }

    private func append(_ page: CatalogPage, excluding drafted: Set<TMDbID>) {
        let known = Set(movies.map(\.tmdbID))
        movies += page.results.filter { !drafted.contains($0.tmdbID) && !known.contains($0.tmdbID) }
        pagesLoaded = page.page
        hasMore = page.hasMore
    }

    private func loadWishlist(generation current: Int) async {
        do {
            if wishlist == nil { wishlist = try await catalog.wishlist(for: userID) }
            guard current == generation else { return }
            let query = trimmedQuery
            movies = (wishlist ?? [])
                .filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
                .map(\.catalogMovie)
            phase = .loaded
        } catch {
            guard current == generation, !error.isCancellation else { return }
            phase = .failed(error.userMessage)
        }
    }
}
