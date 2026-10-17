import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// The signed-in person's wishlist, shared by every screen that shows a
/// bookmark (search, movie detail, the draft picker, the wishlist itself), so
/// a toggle anywhere shows everywhere at once (F-07).
///
/// Lives under the signed-in tree, which is rebuilt per account, so nothing
/// from one account's wishlist survives into another's. Nothing is cached on
/// disk.
///
/// Toggles are optimistic: the bookmark flips at once and flips back if the
/// server refuses, with the reason kept in `failure` for the screen that made
/// the change to show inline. A second tap on a movie that is still saving is
/// ignored.
@Observable
@MainActor
final class WishlistStore {
    /// A toggle the server refused, shown beside the control that made it.
    struct Failure: Equatable {
        let tmdbID: TMDbID
        let message: String
    }

    private(set) var movies: [WishlistedMovie] = [] {
        didSet { ids = Set(movies.map(\.tmdbID)) }
    }
    private(set) var state: LoadState<Void> = .idle
    private(set) var isShared = false
    private(set) var isSavingSharing = false
    private(set) var sharingError: String?
    private(set) var failure: Failure?

    let userID: UserID
    private let repository: any WishlistRepository
    private var ids: Set<TMDbID> = []
    private var saving: Set<TMDbID> = []
    /// Bumped whenever a change starts. A read that began before the latest
    /// change can't tell whether it saw it, so its list and sharing are dropped.
    private var changeEpoch = 0
    /// A read was dropped; read again once nothing is saving.
    private var needsReload = false

    init(userID: UserID, repository: any WishlistRepository) {
        self.userID = userID
        self.repository = repository
    }

    var count: Int { movies.count }

    func contains(_ tmdbID: TMDbID) -> Bool { ids.contains(tmdbID) }

    func isSaving(_ tmdbID: TMDbID) -> Bool { saving.contains(tmdbID) }

    /// Loads the wishlist and sharing setting. Safe to call again (pull to
    /// refresh, Try Again); a read that overlaps a change keeps what's on screen.
    func load() async {
        if case .idle = state { state = .loading }
        if case .failed = state { state = .loading }
        let epoch = changeEpoch
        do {
            async let rows = repository.fetchWishlist(of: userID)
            async let shared = repository.fetchSharing(for: userID)
            let (loaded, sharing) = try await (rows, shared)
            if epoch == changeEpoch {
                movies = loaded
                isShared = sharing
                needsReload = false
            } else {
                needsReload = true
            }
            state = .loaded(())
        } catch {
            let apiError = APIError.wrap(error)
            if apiError.isCancellation { return }
            // Keep a list that already loaded rather than blanking it.
            if case .loaded = state { return }
            state = .failed(message: "Couldn't load your wishlist. \(apiError.userMessage)")
        }
    }

    /// Adds the movie, or removes it when it's already saved.
    func toggle(_ candidate: WishlistCandidate) async {
        if contains(candidate.tmdbID) {
            await remove(candidate.tmdbID, title: candidate.title)
        } else {
            await add(candidate)
        }
    }

    func add(_ candidate: WishlistCandidate) async {
        let tmdbID = candidate.tmdbID
        guard !saving.contains(tmdbID), !contains(tmdbID) else { return }
        guard movies.count < WishlistLimits.maxCount else {
            report(tmdbID, WishlistLimits.fullMessage)
            return
        }
        guard let insert = candidate.row else { return }
        changeEpoch += 1
        saving.insert(tmdbID)
        defer { finishChange(tmdbID) }
        clearFailure(for: tmdbID)

        let placeholder = WishlistedMovie(
            id: WishlistItemID("pending-\(tmdbID.rawValue)"), userID: userID, tmdbID: tmdbID,
            title: insert.title, posterURL: insert.posterURL, addedAt: Date()
        )
        movies.insert(placeholder, at: 0)
        do {
            let saved = try await repository.add(insert, for: userID)
            if let index = movies.firstIndex(where: { $0.tmdbID == tmdbID }) { movies[index] = saved }
            Announcer.announce("Saved \(insert.title) to your wishlist")
        } catch {
            movies.removeAll { $0.tmdbID == tmdbID }
            report(tmdbID, message(for: error, fallback: "Couldn't save \(insert.title) to your wishlist."))
        }
    }

    func remove(_ tmdbID: TMDbID, title: String? = nil) async {
        guard !saving.contains(tmdbID), let index = movies.firstIndex(where: { $0.tmdbID == tmdbID }) else { return }
        changeEpoch += 1
        saving.insert(tmdbID)
        defer { finishChange(tmdbID) }
        clearFailure(for: tmdbID)

        let removed = movies.remove(at: index)
        let name = title ?? removed.title
        do {
            try await repository.remove(tmdbID, for: userID)
            Announcer.announce("Removed \(name) from your wishlist")
        } catch {
            // Put it back where it was.
            movies.insert(removed, at: min(index, movies.count))
            report(tmdbID, message(for: error, fallback: "Couldn't remove \(name) from your wishlist."))
        }
    }

    /// Turns sharing with league-mates on or off. The switch moves at once and
    /// moves back if the save fails.
    func setSharing(_ shared: Bool) async {
        guard !isSavingSharing, shared != isShared else { return }
        changeEpoch += 1
        isSavingSharing = true
        sharingError = nil
        isShared = shared
        defer {
            isSavingSharing = false
            finishChange(nil)
        }
        do {
            try await repository.setSharing(shared, for: userID)
            Announcer.announce(shared ? "Wishlist shared with league-mates" : "Wishlist no longer shared")
        } catch {
            isShared = !shared
            sharingError = message(for: error, fallback: "Couldn't update wishlist sharing.")
        }
    }

    func clearFailure(for tmdbID: TMDbID? = nil) {
        if tmdbID == nil || failure?.tmdbID == tmdbID { failure = nil }
    }

    // MARK: - Private

    private func finishChange(_ tmdbID: TMDbID?) {
        if let tmdbID { saving.remove(tmdbID) }
        guard needsReload, saving.isEmpty, !isSavingSharing else { return }
        needsReload = false
        Task { await load() }
    }

    private func report(_ tmdbID: TMDbID, _ message: String) {
        failure = Failure(tmdbID: tmdbID, message: message)
        Announcer.announce(message)
    }

    /// The server's own sentence when it has one (the 500-movie limit), else
    /// what we tried plus why it failed.
    private func message(for error: any Error, fallback: String) -> String {
        let apiError = APIError.wrap(error)
        if case .server(let server) = apiError, server.message == WishlistLimits.fullMessage {
            return server.message
        }
        if case .rateLimited = apiError { return apiError.userMessage }
        return "\(fallback) \(apiError.userMessage)"
    }
}

/// Searches typed this session, newest first, for the search tab's "Recent"
/// chips. Memory only: nothing is written to the device, and signing out or
/// switching accounts drops it with the rest of the signed-in tree.
@Observable
@MainActor
final class MovieSearchHistory {
    static let limit = 8
    private(set) var queries: [String] = []

    func record(_ query: String) {
        guard let normalized = MovieSearchQuery.normalized(query) else { return }
        queries.removeAll { $0.caseInsensitiveCompare(normalized) == .orderedSame }
        queries.insert(normalized, at: 0)
        if queries.count > Self.limit { queries.removeLast(queries.count - Self.limit) }
    }

    func clear() {
        queries = []
    }
}
