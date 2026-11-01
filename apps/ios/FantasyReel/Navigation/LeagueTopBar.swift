import FantasyReelCore
import SwiftUI

extension View {
    /// The glass top bar on every league tab's root screen (mockup v2): the
    /// league pill on the left opens the menu sheet; on the right, the
    /// notifications bell and the league `⋯` menu. When five league tabs fill
    /// the tab bar, movie search is a button here too.
    ///
    /// `LeagueTabStack` already applies this to every tab root. A tab's main
    /// action ("Place Bid") goes in `bottomActionBar`, not here.
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
                        GlassPillLabel(title: selection?.season.name ?? "Leagues")
                    }
                    .accessibilityLabel("Open menu: leagues, wishlist, account")
                    .accessibilityValue(selection?.season.name ?? "")
                }
                if selection?.showsSearchTab == false {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            router.pushMovieSearch()
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }
                        .accessibilityLabel("Search movies")
                    }
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

/// The bell with an unread count ("9+" cap), opening Notifications in the menu
/// sheet. This is the only way into Notifications; the menu has no row for it. The badge sits at top −2 / right −2 of the 44pt button (V2Home).
struct NotificationsButton: View {
    @Environment(ShellRouter.self) private var router
    @Environment(InboxStore.self) private var inbox

    var body: some View {
        Button {
            router.presentMenu(.notifications)
        } label: {
            Image(systemName: "bell")
                .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                .iconButtonBadge(inbox.unreadCount)
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
