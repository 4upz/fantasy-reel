import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// The latest notifications and the unread badge (F-17).
///
/// Like the web bell, it loads the latest 50 and counts unread among those, and
/// refetches when opened; the inbox is not live. The shell owns it because the
/// bell badge shows on every league screen; the Notifications screen reads and
/// marks through the same store so the badge and list never disagree.
@Observable
@MainActor
final class InboxStore {
    private(set) var notifications: [AppNotification] = []
    private(set) var loadError: String?
    private(set) var hasLoaded = false

    private let userID: UserID
    private let repository: NotificationRepository

    init(userID: UserID, repository: NotificationRepository) {
        self.userID = userID
        self.repository = repository
    }

    var unreadCount: Int {
        notifications.lazy.filter { $0.readAt == nil }.count
    }

    /// The badge text: capped at "9+" like the web bell.
    var badgeText: String? {
        switch unreadCount {
        case 0: nil
        case 1...9: String(unreadCount)
        default: "9+"
        }
    }

    func refresh() async {
        do {
            notifications = try await repository.fetchLatest(for: userID)
            loadError = nil
        } catch {
            loadError = error.userMessage
        }
        hasLoaded = true
    }

    /// Marks one notification read when it's opened.
    func markRead(_ id: NotificationID) async {
        guard let index = notifications.firstIndex(where: { $0.id == id }),
              notifications[index].readAt == nil
        else { return }
        do {
            try await repository.markRead([id])
            await refresh()
        } catch {
            loadError = error.userMessage
        }
    }

    /// Marks every loaded unread notification read.
    func markAllRead() async {
        let unread = notifications.filter { $0.readAt == nil }.map(\.id)
        do {
            try await repository.markRead(unread)
            await refresh()
        } catch {
            loadError = error.userMessage
        }
    }
}
