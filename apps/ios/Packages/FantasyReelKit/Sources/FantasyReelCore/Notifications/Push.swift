import Foundation

/// A Settings switch for push notifications (O-01, D-10). Each is a column of
/// `push_preferences`; the server's `push_category()` decides which
/// notification types it covers, and `category(for:)` mirrors it.
public enum PushCategory: String, CaseIterable, Sendable, Hashable, Identifiable {
    case draft
    case bids
    case trades
    case myMovies = "my_movies"
    case leagueActivity = "league_activity"
    case season

    public var id: Self { self }

    public var title: String {
        switch self {
        case .draft: "Draft"
        case .bids: "Bids"
        case .trades: "Trades"
        case .myMovies: "Your Movies"
        case .leagueActivity: "League Activity"
        case .season: "Season"
        }
    }

    /// What it sends, for the row's subtitle.
    public var detail: String {
        switch self {
        case .draft: "When it's your pick"
        case .bids: "Outbid, won or lost, and movies up for pickup"
        case .trades: "Offers waiting on you, and how trades end"
        case .myMovies: "Scores and release days for your movies"
        case .leagueActivity: "Other teams' movies getting scored"
        case .season: "Seasons starting and ending"
        }
    }

    public static func category(for type: NotificationType) -> PushCategory? {
        switch type {
        case .draftTurn: .draft
        case .outbid, .bidWon, .bidLost, .pickupAvailable: .bids
        case .tradeProposed, .tradeCountered, .tradeAccepted, .tradeRejected, .tradeCancelled,
             .tradeCompleted, .tradeVetoed, .tradeReview:
            .trades
        case .movieScored, .movieReleased: .myMovies
        case .leagueMovieScored: .leagueActivity
        case .seasonStarted, .seasonCompleted, .leagueOwnershipTransferred: .season
        case .unknown: nil
        }
    }
}

/// A `push_preferences` row. No row on the server means every category is on.
public struct PushPreferences: Codable, Sendable, Hashable {
    public var draft: Bool
    public var bids: Bool
    public var trades: Bool
    public var myMovies: Bool
    public var leagueActivity: Bool
    public var season: Bool

    public static let allOn = PushPreferences(draft: true, bids: true, trades: true, myMovies: true, leagueActivity: true, season: true)

    public init(draft: Bool, bids: Bool, trades: Bool, myMovies: Bool, leagueActivity: Bool, season: Bool) {
        self.draft = draft
        self.bids = bids
        self.trades = trades
        self.myMovies = myMovies
        self.leagueActivity = leagueActivity
        self.season = season
    }

    public subscript(category: PushCategory) -> Bool {
        get {
            switch category {
            case .draft: draft
            case .bids: bids
            case .trades: trades
            case .myMovies: myMovies
            case .leagueActivity: leagueActivity
            case .season: season
            }
        }
        set {
            switch category {
            case .draft: draft = newValue
            case .bids: bids = newValue
            case .trades: trades = newValue
            case .myMovies: myMovies = newValue
            case .leagueActivity: leagueActivity = newValue
            case .season: season = newValue
            }
        }
    }

    public enum CodingKeys: String, CodingKey {
        case draft, bids, trades, season
        case myMovies = "my_movies"
        case leagueActivity = "league_activity"
    }
}

/// What a push carries besides its alert (`buildPayload` in the Edge
/// Function `_shared/push-notifications.ts`).
public struct PushPayload: Sendable, Hashable {
    public var notificationID: NotificationID?
    public var type: NotificationType
    public var leagueID: LeagueID?

    public init(notificationID: NotificationID?, type: NotificationType, leagueID: LeagueID?) {
        self.notificationID = notificationID
        self.type = type
        self.leagueID = leagueID
    }

    /// Reads `UNNotificationContent.userInfo`. Nil when the push isn't ours.
    public init?(userInfo: [AnyHashable: Any]) {
        guard let type = userInfo["type"] as? String, !type.isEmpty else { return nil }
        self.type = NotificationType(rawValue: type)
        self.notificationID = (userInfo["notification_id"] as? String).map { NotificationID($0) }
        // A league id that isn't a UUID would only open a "not available" screen.
        self.leagueID = (userInfo["league_id"] as? String)
            .flatMap(UUID.init(uuidString:))
            .map { LeagueID($0.uuidString.lowercased()) }
    }

    /// Where a tap goes: the same place as tapping it in the inbox, or the
    /// inbox itself for a notification with no league.
    public var destination: DeepLink {
        AppNotification.destination(for: type, leagueID: leagueID) ?? .notifications
    }
}

/// APNs device tokens travel as lowercase hex, as `register_push_device` stores them.
public enum PushToken {
    public static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }
}
