import Foundation

/// A `league_participants` row. Per season: a user has a new participant (and
/// team) in every season they play.
///
/// `userID` may name an auth user that no longer exists (a deleted account
/// stays as a "Former member"); never assume it has a live account.
public struct LeagueParticipant: Codable, Sendable, Hashable, Identifiable {
    public var id: ParticipantID
    public var leagueID: LeagueID
    public var userID: UserID
    public var role: ParticipantRole
    public var status: ParticipantStatus
    /// One-based draft position; nil until the order is set.
    public var draftOrder: Int?
    public var joinedAt: Date?
    public var createdAt: Date?
    public var updatedAt: Date?

    public init(
        id: ParticipantID,
        leagueID: LeagueID,
        userID: UserID,
        role: ParticipantRole = .member,
        status: ParticipantStatus = .active,
        draftOrder: Int? = nil,
        joinedAt: Date? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.userID = userID
        self.role = role
        self.status = status
        self.draftOrder = draftOrder
        self.joinedAt = joinedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case userID = "user_id"
        case role
        case status
        case draftOrder = "draft_order"
        case joinedAt = "joined_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(ParticipantID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        userID = try c.decode(UserID.self, forKey: .userID)
        role = try c.decode(ParticipantRole.self, forKey: .role, default: .member)
        status = try c.decode(ParticipantStatus.self, forKey: .status, default: .active)
        draftOrder = try c.decodeInteger(forKey: .draftOrder)
        joinedAt = try c.decodeIfPresent(Date.self, forKey: .joinedAt)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
    }
}

/// A `teams` row: one per participant per season.
public struct Team: Codable, Sendable, Hashable, Identifiable {
    public var id: TeamID
    public var participantID: ParticipantID
    public var name: String
    public var avatarURL: String?
    public var createdAt: Date?
    public var updatedAt: Date?

    public init(
        id: TeamID,
        participantID: ParticipantID,
        name: String,
        avatarURL: String? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.participantID = participantID
        self.name = name
        self.avatarURL = avatarURL
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case participantID = "participant_id"
        case name
        case avatarURL = "avatar_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// A `profiles` row. A deleted account's profile remains as an anonymous
/// "Former member"; render `displayName` as given.
public struct Profile: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var userID: UserID
    public var displayName: String?
    public var avatarURL: String?
    /// Wishlists are private by default.
    public var wishlistPublic: Bool
    public var discordUsername: String?
    public var createdAt: Date?
    public var updatedAt: Date?

    public init(
        id: String,
        userID: UserID,
        displayName: String? = nil,
        avatarURL: String? = nil,
        wishlistPublic: Bool = false,
        discordUsername: String? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.userID = userID
        self.displayName = displayName
        self.avatarURL = avatarURL
        self.wishlistPublic = wishlistPublic
        self.discordUsername = discordUsername
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case displayName = "display_name"
        case avatarURL = "avatar_url"
        case wishlistPublic = "wishlist_public"
        case discordUsername = "discord_username"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userID = try c.decode(UserID.self, forKey: .userID)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        avatarURL = try c.decodeIfPresent(String.self, forKey: .avatarURL)
        wishlistPublic = try c.decode(Bool.self, forKey: .wishlistPublic, default: false)
        discordUsername = try c.decodeIfPresent(String.self, forKey: .discordUsername)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
    }
}
