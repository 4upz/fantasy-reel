import FantasyReelCore
import SwiftUI

/// The notification inbox (mockup v2 "Notifications", F-17): the latest 50,
/// newest first. Opening one marks it read and goes where the web bell goes;
/// Mark All Read clears the rest. Reads and marks through `InboxStore`, so the
/// menu's unread count always agrees. Refreshed on open and by pulling down;
/// the inbox isn't live, like the web's.
struct NotificationsView: View {
    @Environment(InboxStore.self) private var inbox
    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory
    @State private var markAll = AsyncAction()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Notifications", eyebrow: inbox.unreadCount > 0 ? "\(inbox.unreadCount) unread" : nil)
                    .padding(.bottom, 4)
                content
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 32)
        }
        .background(Color.frBackground)
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "").accessibilityHidden(true)
            }
            if inbox.unreadCount > 0 {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Mark All Read") {
                        markAll.run {
                            await inbox.markAllRead()
                            if inbox.unreadCount == 0 { Announcer.announce("All notifications marked as read.") }
                        }
                    }
                    .disabled(markAll.isRunning)
                }
            }
        }
        .task { await inbox.refresh() }
        .refreshable { await inbox.refresh() }
        .announcesError(inbox.hasLoaded ? inbox.loadError : nil)
    }

    @ViewBuilder
    private var content: some View {
        if !inbox.hasLoaded && inbox.notifications.isEmpty {
            LoadingView(label: "Loading notifications…")
                .padding(.top, 40)
        } else if let error = inbox.loadError, inbox.notifications.isEmpty {
            ErrorStateView(title: "Couldn't load notifications", message: error) {
                Task { await inbox.refresh() }
            }
            .padding(.top, 24)
        } else if inbox.notifications.isEmpty {
            EmptyStateView(
                title: "No notifications yet",
                message: "Bids, trades and season news land here.",
                systemImage: "bell"
            )
            .padding(.top, 24)
        } else {
            if let error = inbox.loadError ?? inbox.markError {
                InlineBanner(tone: .error, title: error)
            }
            LazyVStack(spacing: 0) {
                ForEach(inbox.notifications) { notification in
                    Button {
                        open(notification)
                    } label: {
                        NotificationRow(notification: notification, leagueName: leagueName(for: notification))
                    }
                    .buttonStyle(.frRow)
                    .overlay(alignment: .top) {
                        if notification.id != inbox.notifications.first?.id {
                            Rectangle()
                                .fill(Color.frSeparator)
                                .frame(height: 0.5)
                                .padding(.leading, 72)
                                .accessibilityHidden(true)
                        }
                    }
                }
            }
            .background(Color.frSurface)
            .clipShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
            GroupFootnote("Showing your latest 50 notifications.")
        }
    }

    private func leagueName(for notification: AppNotification) -> String? {
        guard let leagueID = notification.leagueID else { return nil }
        return directory.entries.first { entry in entry.seasons.contains { $0.id == leagueID } }?.name
    }

    private func open(_ notification: AppNotification) {
        if notification.isUnread {
            Task { await inbox.markRead(notification.id) }
        }
        if let destination = notification.destination {
            router.open(destination, directory: directory)
        } else {
            router.dismissSheet()
        }
    }
}

/// One notification: unread dot, type icon, title, body, then league and time.
/// Unread rows have the gold dot and a bolder title, and say "Unread" to
/// VoiceOver, so the state never rests on color or weight alone.
private struct NotificationRow: View {
    let notification: AppNotification
    let leagueName: String?

    var body: some View {
        let time = NotificationTime.describe(notification.createdAt)
        let style = NotificationStyle(notification.type)
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: style.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(style.tone.foreground)
                .frame(width: 36, height: 36)
                .background(style.tone.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(notification.title)
                    .frFont(notification.isUnread ? .rowTitle : .rowLabel)
                    .foregroundStyle(Color.frText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(notification.body)
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                    .lineLimit(3)
                Text([leagueName, time.short].compactMap(\.self).joined(separator: " · "))
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .lineLimit(2)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 24)
        .padding(.trailing, FRMetrics.rowPadding)
        .padding(.vertical, 12)
        // The dot sits in the leading gutter, level with the icon's center.
        .overlay(alignment: .topLeading) {
            if notification.isUnread {
                Circle()
                    .fill(Color.frGold)
                    .frame(width: 8, height: 8)
                    .offset(x: 8, y: 26)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(spokenTime: time.spoken))
    }

    private func accessibilityText(spokenTime: String) -> String {
        [
            notification.isUnread ? "Unread" : nil,
            notification.title,
            notification.body,
            leagueName,
            spokenTime,
        ].compactMap(\.self).joined(separator: ", ")
    }
}

/// The icon and tone for each type, matching the web bell's icons.
struct NotificationStyle {
    let systemImage: String
    let tone: FRTone

    init(_ type: NotificationType) {
        switch type {
        case .outbid: (systemImage, tone) = ("dollarsign", .error)
        case .bidWon: (systemImage, tone) = ("checkmark", .success)
        case .bidLost: (systemImage, tone) = ("chart.line.downtrend.xyaxis", .error)
        case .pickupAvailable: (systemImage, tone) = ("gift.fill", .gold)
        case .seasonCompleted: (systemImage, tone) = ("trophy.fill", .gold)
        case .seasonStarted: (systemImage, tone) = ("movieclapper.fill", .gold)
        case .leagueOwnershipTransferred: (systemImage, tone) = ("crown.fill", .gold)
        case .tradeProposed, .tradeCountered, .tradeAccepted, .tradeRejected, .tradeCancelled,
             .tradeCompleted, .tradeVetoed, .tradeReview:
            (systemImage, tone) = ("arrow.left.arrow.right", .gold)
        case .unknown:
            (systemImage, tone) = ("bell.fill", .neutral)
        }
    }
}
