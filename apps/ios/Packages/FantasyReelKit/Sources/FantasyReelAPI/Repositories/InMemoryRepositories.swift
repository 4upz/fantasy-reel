import FantasyReelCore
import Foundation

// Fakes for SwiftUI previews and tests. They hold their data in memory and
// never touch the network. `failure` makes every call throw, to exercise
// error states.

public actor InMemoryLeagueRepository: LeagueRepository {
    public var seasons: [League]
    public var failure: APIError?

    public init(seasons: [League] = [], failure: APIError? = nil) {
        self.seasons = seasons
        self.failure = failure
    }

    public func setSeasons(_ seasons: [League]) { self.seasons = seasons }

    public func fetchVisibleSeasons() async throws(APIError) -> [League] {
        if let failure { throw failure }
        return seasons.sorted { $0.createdAt > $1.createdAt }
    }

    public func fetchSeason(_ id: LeagueID) async throws(APIError) -> League? {
        if let failure { throw failure }
        return seasons.first { $0.id == id }
    }
}

public actor InMemoryProfileRepository: ProfileRepository {
    public var profiles: [Profile]

    public init(profiles: [Profile] = []) {
        self.profiles = profiles
    }

    public func fetchProfile(for userID: UserID) async throws(APIError) -> Profile? {
        profiles.first { $0.userID == userID }
    }
}

public actor InMemoryNotificationRepository: NotificationRepository {
    public var notifications: [AppNotification]

    public init(notifications: [AppNotification] = []) {
        self.notifications = notifications
    }

    public func fetchLatest(for userID: UserID) async throws(APIError) -> [AppNotification] {
        Array(
            notifications
                .filter { $0.userID == userID }
                .sorted { $0.createdAt > $1.createdAt }
                .prefix(SupabaseNotificationRepository.pageSize)
        )
    }

    public func markRead(_ ids: [NotificationID], at date: Date) async throws(APIError) {
        for index in notifications.indices where ids.contains(notifications[index].id) {
            notifications[index].readAt = date
        }
    }
}
