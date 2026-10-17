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

/// One person in a season: their `league_participants` row with the team and
/// profile embedded, as `league_participants.select('*, teams (*), profiles (*)')`
/// returns it (the web's `ParticipantWithProfile`).
///
/// Both embeds are one-to-one (`teams.participant_id` is unique, and
/// `profiles` joins through `league_participants_user_id_profiles_fkey`), so
/// PostgREST sends objects, not arrays. Either can be null: a team insert can
/// fail after a join (`warning`), and RLS can hide a profile.
public struct LeagueMember: Codable, Sendable, Hashable, Identifiable {
    public var participant: LeagueParticipant
    public var team: Team?
    public var profile: Profile?

    public var id: ParticipantID { participant.id }
    public var userID: UserID { participant.userID }

    /// The person's name as the web shows it. A deleted account's profile
    /// already reads "Former member"; a hidden profile falls back to that too.
    public var displayName: String {
        let name = profile?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Former member" : name
    }

    /// The team's name, or the person's when the team row is missing.
    public var teamName: String { team?.name ?? displayName }

    public init(participant: LeagueParticipant, team: Team? = nil, profile: Profile? = nil) {
        self.participant = participant
        self.team = team
        self.profile = profile
    }

    private enum EmbedKeys: String, CodingKey {
        case teams
        case profiles
    }

    public init(from decoder: any Decoder) throws {
        participant = try LeagueParticipant(from: decoder)
        let c = try decoder.container(keyedBy: EmbedKeys.self)
        team = try c.decodeIfPresent(Team.self, forKey: .teams)
        profile = try c.decodeIfPresent(Profile.self, forKey: .profiles)
    }

    public func encode(to encoder: any Encoder) throws {
        try participant.encode(to: encoder)
        var c = encoder.container(keyedBy: EmbedKeys.self)
        try c.encodeIfPresent(team, forKey: .teams)
        try c.encodeIfPresent(profile, forKey: .profiles)
    }
}

extension Array where Element == LeagueMember {
    /// Draft order first (one-based), unordered members after, then by join time:
    /// the order the web's settings and draft room list people in.
    public func sortedByDraftOrder() -> [LeagueMember] {
        sorted { lhs, rhs in
            switch (lhs.participant.draftOrder, rhs.participant.draftOrder) {
            case let (l?, r?) where l != r: return l < r
            case (.some, nil): return true
            case (nil, .some): return false
            default:
                let lhsJoined = lhs.participant.joinedAt ?? lhs.participant.createdAt ?? .distantPast
                let rhsJoined = rhs.participant.joinedAt ?? rhs.participant.createdAt ?? .distantPast
                if lhsJoined != rhsJoined { return lhsJoined < rhsJoined }
                return lhs.id.rawValue < rhs.id.rawValue
            }
        }
    }
}
