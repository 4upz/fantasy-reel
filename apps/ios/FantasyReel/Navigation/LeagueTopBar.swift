import FantasyReelCore
import SwiftUI

extension View {
    /// The glass top bar on every league tab's root screen (mockup v2): the
    /// league pill on the left opens the menu sheet; on the right, the
    /// notifications bell and the league `⋯` menu.
    func leagueTopBar() -> some View {
        modifier(LeagueTopBarModifier())
    }
}

private struct LeagueTopBarModifier: ViewModifier {
    @Environment(\.leagueSelection) private var selection
    @Environment(ShellRouter.self) private var router

    func body(content: Content) -> some View {
        content
            .navigationTitle(selection?.season.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Roots draw their own large header (ScreenHeader); keep the
                // bar itself free of a duplicate centered title.
                ToolbarItem(placement: .principal) {
                    Text(verbatim: "").accessibilityHidden(true)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        router.presentMenu()
                    } label: {
                        LeaguePillLabel(name: selection?.season.name ?? "Leagues")
                    }
                    .accessibilityLabel("Open menu: leagues, wishlist, account")
                    .accessibilityValue(selection?.season.name ?? "")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NotificationsButton()
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    LeagueMenuButton()
                }
            }
    }
}

/// The league pill's content: the league's initials and a chevron. The toolbar
/// supplies the Liquid Glass capsule.
struct LeaguePillLabel: View {
    let name: String

    var body: some View {
        HStack(spacing: 6) {
            Avatar(name: name, size: .small)
            Image(systemName: "chevron.down")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.frTextSecondary)
                .accessibilityHidden(true)
        }
    }
}

/// The bell with an unread count ("9+" cap), opening Notifications in the menu sheet.
struct NotificationsButton: View {
    @Environment(ShellRouter.self) private var router
    @Environment(InboxStore.self) private var inbox

    var body: some View {
        Button {
            router.presentMenu(.notifications)
        } label: {
            Image(systemName: "bell")
                .overlay(alignment: .topTrailing) {
                    if inbox.unreadCount > 0 {
                        CountBadge(count: inbox.unreadCount)
                            .offset(x: 10, y: -10)
                    }
                }
        }
        .accessibilityLabel(inbox.unreadCount > 0 ? "Notifications, \(inbox.unreadCount) unread" : "Notifications")
    }
}

/// The league `⋯` menu: Rules for everyone, then what this phase and role allow.
private struct LeagueMenuButton: View {
    @Environment(\.leagueSelection) private var selection
    @Environment(ShellRouter.self) private var router

    var body: some View {
        Menu {
            ForEach(selection?.menuItems ?? [], id: \.self) { item in
                Button(item.title, systemImage: item.systemImage) {
                    router.push(item.route)
                }
            }
        } label: {
            Image(systemName: "ellipsis")
        }
        .accessibilityLabel("League menu")
    }
}

extension LeagueMenuItem {
    var route: LeagueRoute {
        switch self {
        case .rules: .rules
        case .draftResults: .draftResults
        case .history: .history
        case .settings: .settings
        case .shareInvite: .shareInvite
        }
    }
}
