import FantasyReelCore
import Foundation
import Supabase

// Repositories are protocols so view models, previews and tests can swap in
// fakes (see `InMemoryRepositories.swift`). Each has one live Supabase type.
// Feature threads add their own repository pairs beside these rather than
// growing them.

/// League and season reads the shell needs.
public protocol LeagueRepository: Sendable {
    /// Every season the signed-in user can see, newest first.
    func fetchVisibleSeasons() async throws(APIError) -> [League]
    /// One season. Nil when the user can no longer see it.
    func fetchSeason(_ id: LeagueID) async throws(APIError) -> League?
}

/// The signed-in user's own profile row.
public protocol ProfileRepository: Sendable {
    func fetchProfile(for userID: UserID) async throws(APIError) -> Profile?
}

/// The notification inbox reads (F-17).
public protocol NotificationRepository: Sendable {
    func fetchLatest(for userID: UserID) async throws(APIError) -> [AppNotification]
    func markRead(_ ids: [NotificationID], at date: Date) async throws(APIError)
}

public struct SupabaseLeagueRepository: LeagueRepository {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    /// Every season the signed-in user can see, newest first.
    ///
    /// RLS decides visibility, exactly like the web dashboard's
    /// `leagues.select('*')`; group the result with `LeagueDirectory`.
    public func fetchVisibleSeasons() async throws(APIError) -> [League] {
        do {
            return try await client
                .from("leagues")
                .select()
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    /// One season, re-read after a phase change. Nil when the user can no
    /// longer see it (left, removed, or deleted).
    public func fetchSeason(_ id: LeagueID) async throws(APIError) -> League? {
        do {
            let rows: [League] = try await client
                .from("leagues")
                .select()
                .eq("id", value: id.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first
        } catch {
            throw APIError.wrap(error)
        }
    }
}

public struct SupabaseProfileRepository: ProfileRepository {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchProfile(for userID: UserID) async throws(APIError) -> Profile? {
        do {
            let rows: [Profile] = try await client
                .from("profiles")
                .select()
                .eq("user_id", value: userID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first
        } catch {
            throw APIError.wrap(error)
        }
    }
}

/// The web loads the latest 50 notifications and counts unread among those;
/// this matches it rather than promising an exact total.
public struct SupabaseNotificationRepository: NotificationRepository {
    public static let pageSize = 50
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchLatest(for userID: UserID) async throws(APIError) -> [AppNotification] {
        do {
            return try await client
                .from("notifications")
                .select()
                .eq("user_id", value: userID.rawValue)
                .order("created_at", ascending: false)
                .limit(Self.pageSize)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    /// Marks notifications read. RLS lets a user update only `read_at` on their own rows.
    public func markRead(_ ids: [NotificationID], at date: Date) async throws(APIError) {
        guard !ids.isEmpty else { return }
        do {
            try await client
                .from("notifications")
                .update(["read_at": date])
                .in("id", values: ids.map(\.rawValue))
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }
}
