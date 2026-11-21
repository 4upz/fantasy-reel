import Foundation

/// A league page a link can point at. Mirrors the web's `/league/<id>/<section>`
/// routes, plus `rules`, which only the app has.
public enum LeagueSection: String, CaseIterable, Sendable, Hashable {
    case overview
    case draft
    case roster
    case standings
    case bidding
    case trading
    case history
    case settings
    case rules

    /// The shell tab that shows this section, when it is a tab at all. Whether
    /// the season's status shows that tab is `LeagueNavigation.resolvedTab`'s call.
    public var tab: LeagueTab? {
        switch self {
        case .overview: .home
        case .draft: .draft
        case .roster: .roster
        case .standings: .standings
        case .bidding: .bids
        case .trading: .trades
        case .history, .settings, .rules: nil
        }
    }

    /// The `⋯` menu destination for sections that are not tabs.
    public var menuItem: LeagueMenuItem? {
        switch self {
        case .history: .history
        case .settings: .settings
        case .rules: .rules
        case .overview, .draft, .roster, .standings, .bidding, .trading: nil
        }
    }

    /// Reads a web path segment or a legacy `?tab=` value.
    init?(webName: String) {
        switch webName.lowercased() {
        case "dashboard", "overview", "home": self = .overview
        case "draft": self = .draft
        case "roster": self = .roster
        case "standings": self = .standings
        case "bidding", "bids": self = .bidding
        case "trading", "trades": self = .trading
        case "history": self = .history
        case "settings": self = .settings
        case "rules": self = .rules
        default: return nil
        }
    }
}

/// Every place an incoming URL can take the app: Universal Links on the site's
/// hosts, the app's own URL scheme, and notification taps (N-02).
///
/// Parsing only checks shape (host, path, id format). The destination must
/// still be authorized after sign-in: a valid-looking league id the user can't
/// read is a recoverable "not available" screen, never cached data.
public enum DeepLink: Hashable, Sendable {
    /// `/join?code=X`. The code is passed through raw; the join flow normalizes it.
    case joinCode(String)
    /// `/join?token=T`, the emailed invitation link (`send-invite`).
    case invitation(token: String)
    /// `/league/<uuid>[/<section>]`. Nil section: open on the status's default tab.
    case league(LeagueID, section: LeagueSection?)
    /// `/dashboard`, the web's signed-in home: opening the app is the destination.
    case home
    case movies
    case wishlist
    case settings
    case help
    case notifications
    /// `<appScheme>://auth/callback…`: hand the whole URL to the auth SDK.
    case authCallback(URL)

    /// Whether the destination needs a signed-in session. Signed-out links are
    /// held and replayed after sign-in.
    public var requiresAuthentication: Bool {
        switch self {
        case .help, .authCallback: false
        case .joinCode, .invitation, .league, .home, .movies, .wishlist, .settings, .notifications: true
        }
    }

    /// Parses `url`, or returns nil when the app should not handle it.
    ///
    /// - `https` links must be on one of `siteHosts` (no port or credentials);
    ///   plain `http` site links are refused.
    /// - `appScheme://` links use the same paths with the first one as the host
    ///   (`fantasyreel://league/<uuid>/roster`). Only the app scheme carries the
    ///   auth callback: the site's `/auth/callback` and `/auth/confirm` are web
    ///   implementations, not native callbacks.
    /// - Web-only token pages such as `/unsubscribe`, unknown paths, and league
    ///   ids that aren't UUIDs return nil.
    public static func parse(_ url: URL, siteHosts: Set<String>, appScheme: String) -> DeepLink? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              components.user == nil, components.password == nil
        else { return nil }

        let pathSegments = components.path.split(separator: "/").map(String.init)
        let segments: [String]

        if !appScheme.isEmpty, scheme == appScheme.lowercased() {
            segments = ([components.host ?? ""] + pathSegments).filter { !$0.isEmpty }
            if segments.count == 2, segments[0].lowercased() == "auth", segments[1].lowercased() == "callback" {
                return .authCallback(url)
            }
        } else if scheme == "https" {
            let hosts = Set(siteHosts.map { $0.lowercased() })
            guard let host = components.host?.lowercased(), hosts.contains(host), components.port == nil else {
                return nil
            }
            segments = pathSegments
        } else {
            return nil
        }

        var query: [String: String] = [:]
        for item in components.queryItems ?? [] {
            guard let value = item.value, !value.isEmpty, query[item.name] == nil else { continue }
            query[item.name] = value
        }

        return route(segments, query: query)
    }

    private static func route(_ segments: [String], query: [String: String]) -> DeepLink? {
        guard let first = segments.first?.lowercased() else { return nil }

        switch first {
        case "join":
            guard segments.count == 1 else { return nil }
            // The web join page prefers the token when both are present.
            if let token = query["token"] { return .invitation(token: token) }
            if let code = query["code"] { return .joinCode(code) }
            return nil

        case "league":
            guard segments.count >= 2, UUID(uuidString: segments[1]) != nil else { return nil }
            let leagueID = LeagueID(segments[1].lowercased())
            let rest = Array(segments.dropFirst(2))

            // Legacy `?tab=bidding` (outbid emails and notifications) wins when present.
            if let tab = query["tab"], let section = LeagueSection(webName: tab) {
                return .league(leagueID, section: section)
            }

            let section: LeagueSection?
            if rest.count == 1 {
                section = LeagueSection(webName: rest[0])
            } else if rest.count == 2, rest[0].lowercased() == "bidding", rest[1].lowercased() == "history" {
                section = .bidding
            } else {
                section = nil
            }
            return .league(leagueID, section: section)

        case "dashboard" where segments.count == 1: return .home
        case "movies" where segments.count == 1: return .movies
        case "wishlist" where segments.count == 1: return .wishlist
        case "settings" where segments.count == 1: return .settings
        case "help" where segments.count == 1, "how-to-play" where segments.count == 1: return .help
        case "notifications" where segments.count == 1: return .notifications
        default: return nil
        }
    }
}
