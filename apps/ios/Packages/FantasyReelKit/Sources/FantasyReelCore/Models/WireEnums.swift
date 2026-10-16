import Foundation

// String enums from the backend. Each has an `unknown(String)` case so a value
// added server-side later decodes instead of failing the whole response, and
// unknown values enable nothing (N-06).

private func decodeWireString(_ decoder: any Decoder) throws -> String {
    try decoder.singleValueContainer().decode(String.self)
}

private func encodeWireString(_ value: String, to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(value)
}

// MARK: - LeagueStatus

/// The lifecycle of one season (`leagues.status`).
public enum LeagueStatus: Codable, Sendable, Hashable, CustomStringConvertible {
    case setup
    case drafting
    case counterpicking
    case active
    case completed
    case unknown(String)

    public static let knownCases: [LeagueStatus] = [.setup, .drafting, .counterpicking, .active, .completed]

    public init(rawValue: String) {
        switch rawValue {
        case "setup": self = .setup
        case "drafting": self = .drafting
        case "counterpicking": self = .counterpicking
        case "active": self = .active
        case "completed": self = .completed
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .setup: "setup"
        case .drafting: "drafting"
        case .counterpicking: "counterpicking"
        case .active: "active"
        case .completed: "completed"
        case .unknown(let value): value
        }
    }

    public var displayName: String {
        switch self {
        case .setup: "Setup"
        case .drafting: "Drafting"
        case .counterpicking: "Counterpicking"
        case .active: "Active"
        case .completed: "Completed"
        case .unknown: "Unknown"
        }
    }

    /// Before the season proper: the draft is still the main event.
    public var isPreseason: Bool {
        switch self {
        case .setup, .drafting, .counterpicking: true
        case .active, .completed, .unknown: false
        }
    }

    public var description: String { rawValue }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decodeWireString(decoder)) }
    public func encode(to encoder: any Encoder) throws { try encodeWireString(rawValue, to: encoder) }
}

// MARK: - Participants

/// `league_participants.role`. Commissioner powers come from `leagues.owner_id`,
/// not from this role; don't build permissions on `admin`.
public enum ParticipantRole: Codable, Sendable, Hashable {
    case owner
    case admin
    case member
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "owner": self = .owner
        case "admin": self = .admin
        case "member": self = .member
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .owner: "owner"
        case .admin: "admin"
        case .member: "member"
        case .unknown(let value): value
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decodeWireString(decoder)) }
    public func encode(to encoder: any Encoder) throws { try encodeWireString(rawValue, to: encoder) }
}

/// `league_participants.status`. A deleted account's participant becomes `left`.
public enum ParticipantStatus: Codable, Sendable, Hashable {
    case pending
    case active
    case left
    case kicked
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "pending": self = .pending
        case "active": self = .active
        case "left": self = .left
        case "kicked": self = .kicked
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .pending: "pending"
        case .active: "active"
        case .left: "left"
        case .kicked: "kicked"
        case .unknown(let value): value
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decodeWireString(decoder)) }
    public func encode(to encoder: any Encoder) throws { try encodeWireString(rawValue, to: encoder) }
}

// MARK: - Movies and holdings

/// `movies.status`. Release timing for scoring uses `release_date`
/// (`DateOnly.hasReleased`), not this column.
public enum MovieStatus: Codable, Sendable, Hashable {
    case upcoming
    case released
    case canceled
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "upcoming": self = .upcoming
        case "released": self = .released
        case "canceled": self = .canceled
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .upcoming: "upcoming"
        case .released: "released"
        case .canceled: "canceled"
        case .unknown(let value): value
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decodeWireString(decoder)) }
    public func encode(to encoder: any Encoder) throws { try encodeWireString(rawValue, to: encoder) }
}

/// How a team came by a movie (`team_holdings.source`).
public enum HoldingSource: Codable, Sendable, Hashable {
    case draft
    case pickup
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "draft": self = .draft
        case "pickup": self = .pickup
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .draft: "draft"
        case .pickup: "pickup"
        case .unknown(let value): value
        }
    }

    /// The base-table name trades and drops speak (`draft_pick` / `pickup`);
    /// nil for an unknown source, which must not be sent anywhere.
    public var baseTableName: String? {
        switch self {
        case .draft: "draft_pick"
        case .pickup: "pickup"
        case .unknown: nil
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decodeWireString(decoder)) }
    public func encode(to encoder: any Encoder) throws { try encodeWireString(rawValue, to: encoder) }
}

// MARK: - Notifications and invitations

/// `notifications.type` (the `notification_type` Postgres enum).
public enum NotificationType: Codable, Sendable, Hashable {
    case outbid
    case bidWon
    case bidLost
    case pickupAvailable
    case tradeProposed
    case tradeCountered
    case tradeAccepted
    case tradeRejected
    case tradeCancelled
    case tradeCompleted
    case tradeVetoed
    /// In the database enum but not yet in the web's TypeScript union.
    case tradeReview
    case seasonCompleted
    case seasonStarted
    case leagueOwnershipTransferred
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "outbid": self = .outbid
        case "bid_won": self = .bidWon
        case "bid_lost": self = .bidLost
        case "pickup_available": self = .pickupAvailable
        case "trade_proposed": self = .tradeProposed
        case "trade_countered": self = .tradeCountered
        case "trade_accepted": self = .tradeAccepted
        case "trade_rejected": self = .tradeRejected
        case "trade_cancelled": self = .tradeCancelled
        case "trade_completed": self = .tradeCompleted
        case "trade_vetoed": self = .tradeVetoed
        case "trade_review": self = .tradeReview
        case "season_completed": self = .seasonCompleted
        case "season_started": self = .seasonStarted
        case "league_ownership_transferred": self = .leagueOwnershipTransferred
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .outbid: "outbid"
        case .bidWon: "bid_won"
        case .bidLost: "bid_lost"
        case .pickupAvailable: "pickup_available"
        case .tradeProposed: "trade_proposed"
        case .tradeCountered: "trade_countered"
        case .tradeAccepted: "trade_accepted"
        case .tradeRejected: "trade_rejected"
        case .tradeCancelled: "trade_cancelled"
        case .tradeCompleted: "trade_completed"
        case .tradeVetoed: "trade_vetoed"
        case .tradeReview: "trade_review"
        case .seasonCompleted: "season_completed"
        case .seasonStarted: "season_started"
        case .leagueOwnershipTransferred: "league_ownership_transferred"
        case .unknown(let value): value
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decodeWireString(decoder)) }
    public func encode(to encoder: any Encoder) throws { try encodeWireString(rawValue, to: encoder) }
}

/// `invitations.status`.
public enum InvitationStatus: Codable, Sendable, Hashable {
    case pending
    case accepted
    case declined
    case expired
    case cancelled
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "pending": self = .pending
        case "accepted": self = .accepted
        case "declined": self = .declined
        case "expired": self = .expired
        case "cancelled": self = .cancelled
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .pending: "pending"
        case .accepted: "accepted"
        case .declined: "declined"
        case .expired: "expired"
        case .cancelled: "cancelled"
        case .unknown(let value): value
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decodeWireString(decoder)) }
    public func encode(to encoder: any Encoder) throws { try encodeWireString(rawValue, to: encoder) }
}
