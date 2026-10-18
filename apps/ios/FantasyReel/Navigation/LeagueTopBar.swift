import FantasyReelCore
import SwiftUI

/// The optional "+" in the league top bar (V2Trades "Propose trade", V2Bids
/// "Place bid"): the first trailing button, before the bell and `⋯`.
struct LeagueTopBarAction {
    let accessibilityLabel: String
    let systemImage: String
    let action: @MainActor () -> Void

    init(accessibilityLabel: String, systemImage: String = "plus", action: @escaping @MainActor () -> Void) {
        self.accessibilityLabel = accessibilityLabel
        self.systemImage = systemImage
        self.action = action
    }
}

extension View {
    /// The glass top bar on every league tab's root screen (mockup v2): the
    /// league pill on the left opens the menu sheet; on the right, an optional
    /// primary action ("+"), the notifications bell and the league `⋯` menu
    /// (V2Trades/V2Bids order: +, bell, ⋯).
    ///
    /// `LeagueTabStack` already applies this to every tab root; a tab that needs
    /// a "+" gets a case in `LeagueTabStack.primaryAction`. When five league tabs
    /// fill the tab bar, movie search is a button here too.
    func leagueTopBar(primaryAction: LeagueTopBarAction? = nil) -> some View {
        modifier(LeagueTopBarModifier(primaryAction: primaryAction))
    }
}

/// The "+" button and the fixed spacer that separates it from the bell.
private struct LeagueTopBarPrimaryItems: ToolbarContent {
    let action: LeagueTopBarAction

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                action.action()
            } label: {
                Image(systemName: action.systemImage)
            }
            .accessibilityLabel(action.accessibilityLabel)
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
    }
}

private struct LeagueTopBarModifier: ViewModifier {
    let primaryAction: LeagueTopBarAction?

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
                if let primaryAction {
                    LeagueTopBarPrimaryItems(action: primaryAction)
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
/// sheet. The badge sits at top −2 / right −2 of the 44pt button (V2Home).
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
