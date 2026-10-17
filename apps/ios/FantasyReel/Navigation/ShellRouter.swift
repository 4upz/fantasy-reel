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
    /// Reorder my pending bids (F-12).
    case bidPriorities
    /// Movie search pushed from the no-league screen, which has no search tab.
    case movieSearch
}

/// Screens inside the menu sheet's own stack.
enum MenuRoute: Hashable {
    case notifications
    case wishlist
    case account
    case howToPlay
    /// App administrators only (F-18); linked from Account.
    case growthDashboard
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

/// The one sheet that can be up at a time. Every sheet in the app goes through
/// here (feature threads add a case and map it in `ShellSheetView`); views
/// never attach their own `.sheet`. Sheets never stack (design rule: one sheet
/// per task), and a sheet with unsaved input is never silently replaced.
enum ShellSheet: Identifiable, Hashable {
    case menu
    case createLeague
    case joinLeague(JoinInput)
    /// Rename the team or change its image (F-10).
    case editTeam
    /// Confirm dropping one of my holdings (F-11).
    case dropMovie(HoldingID)
    /// Compose a trade offer, optionally to a chosen team (F-13).
    case proposeTrade(TeamID?)
    /// Place, raise or counter a pickup or counterpick bid (F-12).
    case placeBid(BidTarget)

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
    /// Stack for the league shell's search tab.
    var searchPath: [LeagueRoute] = []
    var sheet: ShellSheet? {
        didSet { if sheet != oldValue { sheetHasUnsavedInput = false } }
    }
    var menuPath: [MenuRoute] = []
    /// Set by a sheet's form while it holds input the user hasn't saved. A new
    /// sheet then waits for the user to confirm discarding it.
    var sheetHasUnsavedInput = false
    /// A sheet waiting on that confirmation (see `confirmReplacingSheet`).
    var pendingSheet: ShellSheet?
    /// The season the tab stacks currently belong to.
    private(set) var activeSeasonID: LeagueID?
    /// Shown when a link points at a league this account can't open.
    var unavailableLinkMessage: String?
    /// The open season's shared data, so sheets (which sit above the tabs)
    /// see the same store as the tabs. Set by `LeagueSeasonScope`.
    var seasonStore: LeagueSeasonStore?

    func path(for tab: LeagueTab) -> Binding<[LeagueRoute]> {
        Binding(
            get: { self.paths[tab] ?? [] },
            set: { self.paths[tab] = $0 }
        )
    }

    func select(_ tab: LeagueTab) {
        selectedTab = .league(tab)
    }

    /// Pushes onto whichever stack is on screen: the selected league tab, the
    /// search tab, or the no-league screen.
    func push(_ route: LeagueRoute) {
        guard activeSeasonID != nil else {
            standalonePath.append(route)
            return
        }
        switch selectedTab {
        case .league(let tab): paths[tab, default: []].append(route)
        case .search: searchPath.append(route)
        }
    }

    /// Opens the menu sheet, optionally already showing one of its screens.
    func presentMenu(_ route: MenuRoute? = nil) {
        if sheet == .menu, !sheetHasUnsavedInput {
            menuPath = route.map { [$0] } ?? []
            return
        }
        present(.menu, menuPath: route.map { [$0] } ?? [])
    }

    func present(_ newSheet: ShellSheet) {
        present(newSheet, menuPath: [])
    }

    private func present(_ newSheet: ShellSheet, menuPath newMenuPath: [MenuRoute]) {
        if sheet != nil, sheet != newSheet, sheetHasUnsavedInput {
            pendingSheet = newSheet
            pendingMenuPath = newMenuPath
            return
        }
        menuPath = newMenuPath
        sheet = newSheet
    }

    private var pendingMenuPath: [MenuRoute] = []

    /// The user chose to discard the open sheet's input for `pendingSheet`.
    func confirmReplacingSheet() {
        guard let next = pendingSheet else { return }
        pendingSheet = nil
        sheetHasUnsavedInput = false
        menuPath = pendingMenuPath
        sheet = next
    }

    /// The user chose to keep editing; the waiting sheet is dropped.
    func cancelReplacingSheet() {
        pendingSheet = nil
    }

    func dismissSheet() {
        sheet = nil
    }

    /// Points the tab stacks at a season. A different season clears every
    /// stack and lands on its default tab; the same season changes nothing.
    func showSeason(_ id: LeagueID?, defaultTab: LeagueTab) {
        guard id != activeSeasonID else { return }
        activeSeasonID = id
        resetTabs(defaultTab: defaultTab)
    }

    /// The season's phase changed (draft → active), which swaps the tab set.
    func phaseDidChange(defaultTab: LeagueTab) {
        resetTabs(defaultTab: defaultTab)
    }

    private func resetTabs(defaultTab: LeagueTab) {
        paths = [:]
        standalonePath = []
        searchPath = []
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
            if !sheetHasUnsavedInput { sheet = nil }
            // Reset here, before routing, so the season-change observer
            // doesn't wipe the section afterwards.
            showSeason(id, defaultTab: directory.selection?.defaultTab ?? .home)
            if let section, let status = directory.selection?.season.status {
                route(to: section, status: status)
            }
        case .movies:
            if !sheetHasUnsavedInput { sheet = nil }
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
