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
    /// A mark-read that failed; separate so it doesn't read as a failed load.
    private(set) var markError: String?
    private(set) var hasLoaded = false

    private let userID: UserID
    private let repository: any NotificationRepository
    /// Marked here, kept so a refresh that started before the mark can't
    /// bring the unread dot back.
    private var markedRead: [NotificationID: Date] = [:]

    init(userID: UserID, repository: any NotificationRepository) {
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
            var latest = try await repository.fetchLatest(for: userID)
            for index in latest.indices where latest[index].readAt == nil {
                latest[index].readAt = markedRead[latest[index].id]
            }
            notifications = latest
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
        let now = Date()
        do {
            try await repository.markRead([id], at: now)
            markLocally([id], at: now)
        } catch {
            markError = error.userMessage
        }
    }

    /// Marks every loaded unread notification read.
    func markAllRead() async {
        let unread = notifications.filter { $0.readAt == nil }.map(\.id)
        guard !unread.isEmpty else { return }
        let now = Date()
        do {
            try await repository.markRead(unread, at: now)
            markLocally(unread, at: now)
        } catch {
            markError = error.userMessage
        }
    }

    /// Updates in place; the next open re-reads the inbox anyway.
    private func markLocally(_ ids: [NotificationID], at date: Date) {
        markError = nil
        let marked = Set(ids)
        for id in marked { markedRead[id] = date }
        for index in notifications.indices where marked.contains(notifications[index].id) {
            notifications[index].readAt = date
        }
    }
}
