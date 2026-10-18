import Foundation

/// A tab in the league shell's `TabView` (mockup v2).
///
/// The web shows a moving strip of tabs per phase (`leagueNav.ts`). iOS keeps a
/// short native tab bar per phase and moves the secondary destinations (Rules,
/// Draft results, History, Settings, Share invite) into the league `⋯` menu, so
/// every capability stays reachable without a "More" tab.
public enum LeagueTab: String, CaseIterable, Sendable, Hashable {
    case home
    case draft
    case roster
    case bids
    case trades
    case standings

    public var title: String {
        switch self {
        case .home: "Home"
        case .draft: "Draft"
        case .roster: "Roster"
        case .bids: "Bids"
        case .trades: "Trades"
        case .standings: "Standings"
        }
    }

    /// SF Symbol name. The tab bar fills it when selected.
    public var systemImage: String {
        switch self {
        case .home: "house"
        case .draft: "list.number"
        case .roster: "film"
        case .bids: "dollarsign.circle"
        case .trades: "arrow.left.arrow.right"
        case .standings: "trophy"
        }
    }
}

/// A secondary league destination in the top bar's `⋯` menu. Each pushes onto
/// the current tab's stack.
public enum LeagueMenuItem: String, CaseIterable, Sendable, Hashable {
    case rules
    case draftResults
    case history
    case settings
    case shareInvite

    public var title: String {
        switch self {
        case .rules: "Rules"
        case .draftResults: "Draft results"
        case .history: "History"
        case .settings: "Settings"
        case .shareInvite: "Share invite"
        }
    }

    public var systemImage: String {
        switch self {
        case .rules: "book.closed"
        case .draftResults: "list.number"
        case .history: "clock.arrow.circlepath"
        case .settings: "gearshape"
        case .shareInvite: "square.and.arrow.up"
        }
    }
}

/// Which league destinations a season's status makes reachable (requirements §2).
public enum LeagueNavigation {
    /// The tab bar for a season in `status`.
    ///
    /// - Preseason (setup, drafting, counterpicking): Home, Draft, Roster. The
    ///   board still runs the counterpick round, so Draft stays a tab.
    /// - Active: Home, Roster, Bids, Trades, Standings. Draft becomes a record
    ///   (menu: Draft Results).
    /// - Completed: Home, Standings, Roster, Draft (V2SeasonComplete). Gameplay
    ///   is frozen; the board is a read-only record, so Draft is a tab again
    ///   and Draft Results leaves the `⋯` menu.
    /// - Unknown: Home and Roster only; an unknown phase enables nothing.
    public static func tabs(for status: LeagueStatus) -> [LeagueTab] {
        switch status {
        case .setup, .drafting, .counterpicking: [.home, .draft, .roster]
        case .active: [.home, .roster, .bids, .trades, .standings]
        case .completed: [.home, .standings, .roster, .draft]
        case .unknown: [.home, .roster]
        }
    }

    /// Whether movie search can be its own tab beside `tabs`. An iPhone tab bar
    /// holds five items and the search tab counts as one, so a sixth item would
    /// push tabs into a system "More" list. With five league tabs, search moves
    /// to the top bar instead.
    public static func showsSearchTab(beside tabs: [LeagueTab]) -> Bool {
        tabs.count < 5
    }

    /// The tab a league opens on: Draft before the season (the main event),
    /// otherwise Home. Matches the web's `/league/[id]` redirect.
    public static func defaultTab(for status: LeagueStatus) -> LeagueTab {
        status.isPreseason ? .draft : .home
    }

    /// `tab` when the status shows it, otherwise the status's default tab. Use
    /// when a deep link or a phase change asks for a tab that may be gone.
    public static func resolvedTab(_ tab: LeagueTab?, for status: LeagueStatus) -> LeagueTab {
        if let tab, tabs(for: status).contains(tab) { return tab }
        return defaultTab(for: status)
    }

    /// The `⋯` menu, in display order.
    ///
    /// - Rules: everyone, always (iOS v1 adds a read-only rules view, D-09).
    /// - Draft Results: during the active season. Once it's completed the
    ///   Draft tab shows the board instead (V2SeasonComplete).
    /// - History: only once the series has a second season, as on the web.
    /// - Settings: the owner (`leagues.owner_id`), in every phase.
    /// - Share Invite: the owner during setup, when people can still join.
    public static func menuItems(status: LeagueStatus, isOwner: Bool, seasonCount: Int) -> [LeagueMenuItem] {
        var items: [LeagueMenuItem] = [.rules]
        switch status {
        case .active: items.append(.draftResults)
        case .setup, .drafting, .counterpicking, .completed, .unknown: break
        }
        if seasonCount >= 2 { items.append(.history) }
        if isOwner { items.append(.settings) }
        if isOwner, status == .setup { items.append(.shareInvite) }
        return items
    }
}
