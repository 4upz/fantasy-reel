import FantasyReelCore
import Foundation
import Supabase

/// Wishlist reads and writes (F-07), straight to `wishlisted_movies` and
/// `profiles` under RLS, as the web does.
///
/// RLS decides whose rows are readable: your own, plus a league-mate's when
/// they share (`profiles.wishlist_public`) and you are both active in a league.
public protocol WishlistRepository: Sendable {
    /// One person's wishlist, newest first. Someone else's comes back empty
    /// unless they share it with a league you're in.
    func fetchWishlist(of userID: UserID) async throws(APIError) -> [WishlistedMovie]
    /// Adds a movie (idempotent: adding twice keeps one row). A full wishlist
    /// fails with the database's "Your wishlist is full …" message.
    func add(_ movie: WishlistInsert, for userID: UserID) async throws(APIError) -> WishlistedMovie
    func remove(_ tmdbID: TMDbID, for userID: UserID) async throws(APIError)
    /// `profiles.wishlist_public`, off by default.
    func fetchSharing(for userID: UserID) async throws(APIError) -> Bool
    func setSharing(_ isShared: Bool, for userID: UserID) async throws(APIError)
    /// How many rows of each person's wishlist this account can read.
    func fetchVisibleCounts(of userIDs: [UserID]) async throws(APIError) -> [UserID: Int]
}

public struct SupabaseWishlistRepository: WishlistRepository {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchWishlist(of userID: UserID) async throws(APIError) -> [WishlistedMovie] {
        do {
            return try await client
                .from("wishlisted_movies")
                .select()
                .eq("user_id", value: userID.rawValue)
                .order("added_at", ascending: false)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func add(_ movie: WishlistInsert, for userID: UserID) async throws(APIError) -> WishlistedMovie {
        do {
            return try await client
                .from("wishlisted_movies")
                .upsert(WishlistRow(userID: userID, movie: movie), onConflict: "user_id,tmdb_id")
                .select()
                .single()
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func remove(_ tmdbID: TMDbID, for userID: UserID) async throws(APIError) {
        do {
            try await client
                .from("wishlisted_movies")
                .delete()
                .eq("user_id", value: userID.rawValue)
                .eq("tmdb_id", value: tmdbID.rawValue)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchSharing(for userID: UserID) async throws(APIError) -> Bool {
        do {
            let rows: [SharingRow] = try await client
                .from("profiles")
                .select("wishlist_public")
                .eq("user_id", value: userID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first?.wishlistPublic ?? false
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func setSharing(_ isShared: Bool, for userID: UserID) async throws(APIError) {
        do {
            try await client
                .from("profiles")
                .update(["wishlist_public": isShared])
                .eq("user_id", value: userID.rawValue)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func fetchVisibleCounts(of userIDs: [UserID]) async throws(APIError) -> [UserID: Int] {
        guard !userIDs.isEmpty else { return [:] }
        // One count per person: a single row read would stop at the API's
        // row cap once a few lists are long.
        let client = client
        do {
            return try await withThrowingTaskGroup(of: (UserID, Int).self) { group in
                for userID in Set(userIDs) {
                    group.addTask {
                        let response = try await client
                            .from("wishlisted_movies")
                            .select("id", head: true, count: .exact)
                            .eq("user_id", value: userID.rawValue)
                            .execute()
                        return (userID, response.count ?? 0)
                    }
                }
                var counts: [UserID: Int] = [:]
                for try await (userID, count) in group { counts[userID] = count }
                return counts
            }
        } catch {
            throw APIError.wrap(error)
        }
    }
}

private struct WishlistRow: Encodable, Sendable {
    let userID: UserID
    let movie: WishlistInsert

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case tmdbID = "tmdb_id"
        case title
        case posterURL = "poster_url"
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(userID, forKey: .userID)
        try c.encode(movie.tmdbID, forKey: .tmdbID)
        try c.encode(movie.title, forKey: .title)
        try c.encode(movie.posterURL, forKey: .posterURL)
    }
}

private struct SharingRow: Decodable, Sendable {
    let wishlistPublic: Bool?
    enum CodingKeys: String, CodingKey { case wishlistPublic = "wishlist_public" }
}

