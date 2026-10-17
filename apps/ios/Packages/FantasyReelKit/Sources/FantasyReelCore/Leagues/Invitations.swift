import Foundation

/// `invitations.status` as stored. A pending row past `expires_at` is
/// expired even before anything rewrites it; use `effectiveStatus(now:)`.
public enum InvitationStatus: String, Codable, Sendable, Hashable, CaseIterable {
    case pending
    case accepted
    case declined
    case expired
    case cancelled

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        // An unknown status enables nothing: treat it like a closed invitation.
        self = InvitationStatus(rawValue: raw) ?? .cancelled
    }

    public var displayName: String {
        switch self {
        case .pending: "Pending"
        case .accepted: "Accepted"
        case .declined: "Declined"
        case .expired: "Expired"
        case .cancelled: "Cancelled"
        }
    }
}

/// An invitation addressed to the signed-in person, with its league, as the
/// web dashboard reads it: `invitations.select('*, leagues(id, name, status, owner_id)')`
/// filtered to their own (lowercased) email, pending and unexpired.
public struct PendingInvitation: Decodable, Sendable, Hashable, Identifiable {
    public var id: InvitationID
    public var token: String
    public var sentAt: Date?
    public var expiresAt: Date
    public var leagueID: LeagueID
    public var leagueName: String

    public init(id: InvitationID, token: String, sentAt: Date?, expiresAt: Date, leagueID: LeagueID, leagueName: String) {
        self.id = id
        self.token = token
        self.sentAt = sentAt
        self.expiresAt = expiresAt
        self.leagueID = leagueID
        self.leagueName = leagueName
    }

    private enum CodingKeys: String, CodingKey {
        case id, token
        case sentAt = "sent_at"
        case expiresAt = "expires_at"
        case leagueID = "league_id"
        case leagues
    }

    private struct LeagueEmbed: Decodable {
        let id: LeagueID
        let name: String
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(InvitationID.self, forKey: .id)
        token = try c.decode(String.self, forKey: .token)
        sentAt = try c.decodeIfPresent(Date.self, forKey: .sentAt)
        expiresAt = try c.decode(Date.self, forKey: .expiresAt)
        // A deleted or hidden league leaves the embed null; the repository
        // drops those rows, like the web does.
        let league = try c.decodeIfPresent(LeagueEmbed.self, forKey: .leagues)
        leagueID = try league?.id ?? c.decode(LeagueID.self, forKey: .leagueID)
        leagueName = league?.name ?? ""
    }

    /// Whole days until expiry, 0 on the last day (the web's "Expires today").
    public func daysLeft(now: Date = Date()) -> Int {
        max(0, Int((expiresAt.timeIntervalSince(now) / 86_400).rounded(.up)) - 1)
    }
}

/// One row of `get_league_invitations(p_league_id)`, the owner's list. For an
/// invitation sent by username the email is withheld and the invitee's display
/// name is given instead.
public struct LeagueInvitation: Decodable, Sendable, Hashable, Identifiable {
    public var id: InvitationID
    public var leagueID: LeagueID
    public var email: String?
    public var inviteeDisplayName: String?
    public var token: String
    public var status: InvitationStatus
    public var sentAt: Date?
    public var expiresAt: Date?
    public var respondedAt: Date?

    public init(
        id: InvitationID,
        leagueID: LeagueID,
        email: String? = nil,
        inviteeDisplayName: String? = nil,
        token: String,
        status: InvitationStatus,
        sentAt: Date? = nil,
        expiresAt: Date? = nil,
        respondedAt: Date? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.email = email
        self.inviteeDisplayName = inviteeDisplayName
        self.token = token
        self.status = status
        self.sentAt = sentAt
        self.expiresAt = expiresAt
        self.respondedAt = respondedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, email, token, status
        case leagueID = "league_id"
        case inviteeDisplayName = "invitee_display_name"
        case sentAt = "sent_at"
        case expiresAt = "expires_at"
        case respondedAt = "responded_at"
    }

    /// Who it went to: the email, or the person's name for a username invite.
    public var recipient: String {
        if let email, !email.isEmpty { return email }
        if let inviteeDisplayName, !inviteeDisplayName.isEmpty { return inviteeDisplayName }
        return "Invited player"
    }

    public func effectiveStatus(now: Date = Date()) -> InvitationStatus {
        if status == .pending, let expiresAt, expiresAt < now { return .expired }
        return status
    }

    /// Resend works on pending and expired invitations (it rotates the token
    /// and the expiry); accepted and declined ones can't be resent.
    public func canResend(now: Date = Date()) -> Bool {
        [.pending, .expired].contains(effectiveStatus(now: now))
    }

    public func canCancel(now: Date = Date()) -> Bool {
        effectiveStatus(now: now) == .pending
    }
}

/// A `search-users` match. `emailHint` is masked; the full email is never
/// sent to the owner for a username invitation.
public struct UserSearchResult: Decodable, Sendable, Hashable, Identifiable {
    public var userID: UserID
    public var displayName: String
    public var emailHint: String
    public var avatarURL: String?

    public var id: UserID { userID }

    public init(userID: UserID, displayName: String, emailHint: String, avatarURL: String? = nil) {
        self.userID = userID
        self.displayName = displayName
        self.emailHint = emailHint
        self.avatarURL = avatarURL
    }

    private enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case displayName = "display_name"
        case emailHint = "email_hint"
        case avatarURL = "avatar_url"
    }
}

/// Who `send-invite` invites.
public enum InviteRecipient: Sendable, Hashable {
    case email(String)
    case user(UserID)
}

/// `send-invite` / `resend-invitation`: the invitation link (also emailed)
/// and a sentence for the owner ("Invitation sent to …").
public struct InviteResult: Decodable, Sendable, Hashable {
    public var inviteURL: URL?
    public var emailSent: Bool
    public var message: String

    public init(inviteURL: URL? = nil, emailSent: Bool = true, message: String) {
        self.inviteURL = inviteURL
        self.emailSent = emailSent
        self.message = message
    }

    private enum CodingKeys: String, CodingKey {
        case inviteURL = "invite_url"
        case emailSent = "email_sent"
        case message
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        inviteURL = try c.decodeIfPresent(String.self, forKey: .inviteURL).flatMap(URL.init(string:))
        emailSent = try c.decode(Bool.self, forKey: .emailSent, default: true)
        message = try c.decode(String.self, forKey: .message, default: "Invitation sent")
    }
}
