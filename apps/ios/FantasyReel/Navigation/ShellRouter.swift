import FantasyReelCore
import Observation
import SwiftUI

/// Screens pushed onto a league tab's stack. Add a case when a feature needs a
/// new pushed screen, and map it in `LeagueDestinationView`.
enum LeagueRoute: Hashable {
    case rules
    case draftResults
    case history
    case settings
    case shareInvite
    case movie(TMDbID)
    case team(TeamID)
    /// Movie search pushed from the no-league screen, which has no search tab.
    case movieSearch
}

/// Screens inside the menu sheet's own stack.
enum MenuRoute: Hashable {
    case notifications
    case wishlist
    case account
    case howToPlay
}

/// The bottom bar's selection: a league tab, or the search button beside it.
enum ShellTab: Hashable {
    case league(LeagueTab)
    case search
}

/// How the join sheet was opened.
enum JoinInput: Hashable {
    case manual
    case code(String)
    case invitation(token: String)
}

/// The one sheet that can be up at a time. Presenting another replaces it;
/// sheets never stack (design rule: one sheet per task).
enum ShellSheet: Identifiable, Hashable {
    case menu
    case createLeague
    case joinLeague(JoinInput)

    var id: Self { self }
}

/// Navigation state for the signed-in app: the selected tab, each tab's stack,
/// the sheet, and the menu sheet's stack. Lives as long as one account's session.
@Observable
@MainActor
final class ShellRouter {
    var selectedTab: ShellTab = .league(.home)
    var paths: [LeagueTab: [LeagueRoute]] = [:]
    /// Stack for the no-league screen, which has no tabs.
    var standalonePath: [LeagueRoute] = []
    var sheet: ShellSheet?
    var menuPath: [MenuRoute] = []
    /// Shown when a link points at a league this account can't open.
    var unavailableLinkMessage: String?

    func path(for tab: LeagueTab) -> Binding<[LeagueRoute]> {
        Binding(
            get: { self.paths[tab] ?? [] },
            set: { self.paths[tab] = $0 }
        )
    }

    func select(_ tab: LeagueTab) {
        selectedTab = .league(tab)
    }

    /// Pushes onto the selected league tab's stack (or the no-league stack).
    func push(_ route: LeagueRoute) {
        guard case .league(let tab) = selectedTab else {
            standalonePath.append(route)
            return
        }
        paths[tab, default: []].append(route)
    }

    /// Opens the menu sheet, optionally already showing one of its screens.
    func presentMenu(_ route: MenuRoute? = nil) {
        menuPath = route.map { [$0] } ?? []
        sheet = .menu
    }

    func present(_ sheet: ShellSheet) {
        if sheet != .menu { menuPath = [] }
        self.sheet = sheet
    }

    func dismissSheet() {
        sheet = nil
    }

    /// Called when the league (or its phase) changes: tab stacks from the old
    /// season must not survive into the new one.
    func resetForSeason(defaultTab: LeagueTab) {
        paths = [:]
        standalonePath = []
        selectedTab = .league(defaultTab)
    }

    /// Routes a shared link or notification destination. League links are
    /// resolved by `SignedInRootView`, which knows which seasons are visible.
    func open(_ link: DeepLink, directory: LeagueDirectoryStore) {
        switch link {
        case .joinCode(let code):
            present(.joinLeague(.code(code)))
        case .invitation(let token):
            present(.joinLeague(.invitation(token: token)))
        case .league(let id, let section):
            guard directory.select(id) else {
                unavailableLinkMessage = "That league isn't available on this account. You may need an invitation, or it may have been deleted."
                return
            }
            sheet = nil
            if let section, let status = directory.selection?.season.status {
                route(to: section, status: status)
            }
        case .movies:
            sheet = nil
            if directory.selection != nil {
                selectedTab = .search
            } else {
                standalonePath = [.movieSearch]
            }
        case .wishlist:
            presentMenu(.wishlist)
        case .settings:
            presentMenu(.account)
        case .help:
            presentMenu(.howToPlay)
        case .notifications:
            presentMenu(.notifications)
        case .authCallback:
            // Handled by SessionStore before routing.
            break
        }
    }

    /// Maps a web league section onto this season's tabs. A section that isn't a
    /// tab in this phase (Draft once the season is active, History, Settings)
    /// is pushed onto the default tab instead.
    private func route(to section: LeagueSection, status: LeagueStatus) {
        let tabs = LeagueNavigation.tabs(for: status)
        let defaultTab = LeagueNavigation.defaultTab(for: status)
        func show(_ tab: LeagueTab, orPush fallback: LeagueRoute? = nil) {
            if tabs.contains(tab) {
                select(tab)
            } else {
                select(defaultTab)
                if let fallback { push(fallback) }
            }
        }
        switch section {
        case .overview: show(.home)
        case .draft: show(.draft, orPush: .draftResults)
        case .roster: show(.roster)
        case .standings: show(.standings)
        case .bidding: show(.bids)
        case .trading: show(.trades)
        case .history: select(defaultTab); push(.history)
        case .settings: select(defaultTab); push(.settings)
        case .rules: select(defaultTab); push(.rules)
        }
    }
}
