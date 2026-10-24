import Foundation

/// A `notifications` row (the in-app inbox). `data` is free-form per type
/// (e.g. `tmdb_id`, `bid_id`), so it stays `JSONValue`.
public struct AppNotification: Codable, Sendable, Hashable, Identifiable {
    public var id: NotificationID
    public var userID: UserID
    public var leagueID: LeagueID?
    public var type: NotificationType
    public var title: String
    public var body: String
    public var data: JSONValue?
    public var readAt: Date?
    public var createdAt: Date

    public init(
        id: NotificationID,
        userID: UserID,
        leagueID: LeagueID? = nil,
        type: NotificationType,
        title: String,
        body: String,
        data: JSONValue? = nil,
        readAt: Date? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.userID = userID
        self.leagueID = leagueID
        self.type = type
        self.title = title
        self.body = body
        self.data = data
        self.readAt = readAt
        self.createdAt = createdAt
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case leagueID = "league_id"
        case type
        case title
        case body
        case data
        case readAt = "read_at"
        case createdAt = "created_at"
    }

    public var isUnread: Bool { readAt == nil }

    /// Where tapping the notification goes, in the inbox or as a push, matching
    /// the web bell's links (`NotificationBell.tsx`). Nil means the user's home.
    public var destination: DeepLink? {
        Self.destination(for: type, leagueID: leagueID)
    }

    public static func destination(for type: NotificationType, leagueID: LeagueID?) -> DeepLink? {
        guard let leagueID else { return nil }
        let section: LeagueSection? = switch type {
        case .outbid, .bidLost, .pickupAvailable: .bidding
        case .bidWon, .movieScored, .movieReleased: .roster
        case .tradeProposed, .tradeCountered, .tradeAccepted, .tradeRejected, .tradeCancelled,
             .tradeCompleted, .tradeVetoed, .tradeReview:
            .trading
        case .draftTurn: .draft
        case .seasonCompleted, .leagueMovieScored: .standings
        // The row carries the NEW season's id, so this opens the season that just started.
        case .seasonStarted: .overview
        case .leagueOwnershipTransferred: .settings
        case .unknown: nil
        }
        return .league(leagueID, section: section)
    }
}

/// An `invitations` row as the invitee reads it, with the embedded league from
/// `invitations.select('*, leagues(id, name, status, owner_id)')`.
public struct Invitation: Codable, Sendable, Hashable, Identifiable {
    public var id: InvitationID
    public var leagueID: LeagueID
    public var invitedBy: UserID
    /// Nil in the owner's view of a username invite, which must not reveal it.
    public var email: String?
    public var token: String
    public var status: InvitationStatus
    public var sentAt: Date?
    public var expiresAt: Date?
    public var respondedAt: Date?
    public var createdAt: Date?
    public var updatedAt: Date?
    /// Nil when the league was deleted or is no longer readable; the web drops
    /// those invitations from the list.
    public var league: InvitationLeague?

    public init(
        id: InvitationID,
        leagueID: LeagueID,
        invitedBy: UserID,
        email: String? = nil,
        token: String,
        status: InvitationStatus = .pending,
        sentAt: Date? = nil,
        expiresAt: Date? = nil,
        respondedAt: Date? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil,
        league: InvitationLeague? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.invitedBy = invitedBy
        self.email = email
        self.token = token
        self.status = status
        self.sentAt = sentAt
        self.expiresAt = expiresAt
        self.respondedAt = respondedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.league = league
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case invitedBy = "invited_by"
        case email
        case token
        case status
        case sentAt = "sent_at"
        case expiresAt = "expires_at"
        case respondedAt = "responded_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case league = "leagues"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(InvitationID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        invitedBy = try c.decode(UserID.self, forKey: .invitedBy)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        token = try c.decode(String.self, forKey: .token)
        status = try c.decode(InvitationStatus.self, forKey: .status, default: .pending)
        sentAt = try c.decodeIfPresent(Date.self, forKey: .sentAt)
        expiresAt = try c.decodeIfPresent(Date.self, forKey: .expiresAt)
        respondedAt = try c.decodeIfPresent(Date.self, forKey: .respondedAt)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
        league = try c.decodeIfPresent(InvitationLeague.self, forKey: .league)
    }

    /// Still answerable at `now`: pending and not past `expires_at`.
    public func isOpen(now: Date = Date()) -> Bool {
        guard status == .pending else { return false }
        guard let expiresAt else { return true }
        return expiresAt >= now
    }
}

/// The league summary embedded in an invitation.
public struct InvitationLeague: Codable, Sendable, Hashable, Identifiable {
    public var id: LeagueID
    public var name: String
    public var status: LeagueStatus
    public var ownerID: UserID

    public init(id: LeagueID, name: String, status: LeagueStatus, ownerID: UserID) {
        self.id = id
        self.name = name
        self.status = status
        self.ownerID = ownerID
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case name
        case status
        case ownerID = "owner_id"
    }
}
