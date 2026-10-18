import Foundation

// Request and response bodies for the league lifecycle Edge Functions:
// `create-league`, `join-league`, `update-league` and `start-next-season`.
// Field names and limits mirror the functions; the server stays authoritative.

// MARK: - Create

/// `create-league`. The only way to create a league; the server also creates
/// the owner's participant row and team. Nil fields take the schema default.
public struct CreateLeagueRequest: Encodable, Sendable, Hashable {
    public static let maxNameLength = 255
    public static let maxTeamNameLength = 100

    public var name: String
    public var teamName: String?
    public var inviteOnly: Bool
    public var maxParticipants: Int?
    public var totalSlots: Int?
    public var draftSlots: Int?
    public var dropLimit: Int?
    public var counterbidHours: Int?
    public var newBidCutoffHours: Int?
    public var draftCounterpickSlots: Int?
    public var biddingCounterpickSlots: Int?
    public var counterpicksBlockDrops: Bool?

    public init(
        name: String,
        teamName: String? = nil,
        inviteOnly: Bool = false,
        maxParticipants: Int? = nil,
        totalSlots: Int? = nil,
        draftSlots: Int? = nil,
        dropLimit: Int? = nil,
        counterbidHours: Int? = nil,
        newBidCutoffHours: Int? = nil,
        draftCounterpickSlots: Int? = nil,
        biddingCounterpickSlots: Int? = nil,
        counterpicksBlockDrops: Bool? = nil
    ) {
        self.name = name
        self.teamName = teamName
        self.inviteOnly = inviteOnly
        self.maxParticipants = maxParticipants
        self.totalSlots = totalSlots
        self.draftSlots = draftSlots
        self.dropLimit = dropLimit
        self.counterbidHours = counterbidHours
        self.newBidCutoffHours = newBidCutoffHours
        self.draftCounterpickSlots = draftCounterpickSlots
        self.biddingCounterpickSlots = biddingCounterpickSlots
        self.counterpicksBlockDrops = counterpicksBlockDrops
    }

    public enum CodingKeys: String, CodingKey {
        case name
        case teamName = "team_name"
        case inviteOnly = "invite_only"
        case maxParticipants = "max_participants"
        case totalSlots = "total_slots"
        case draftSlots = "draft_slots"
        case dropLimit = "drop_limit"
        case counterbidHours = "counterbid_hours"
        case newBidCutoffHours = "new_bid_cutoff_hours"
        case draftCounterpickSlots = "draft_counterpick_slots"
        case biddingCounterpickSlots = "bidding_counterpick_slots"
        case counterpicksBlockDrops = "counterpicks_block_drops"
    }
}

/// `create-league` and `join-league` answer 201 with whatever they managed to
/// create. A `warning` means the league exists but the participant or team
/// step failed: re-read state and offer recovery, never create a second league.
public struct LeagueMembershipResult: Decodable, Sendable, Hashable {
    /// The season created or joined. `join-league` sends only its id and name.
    public var leagueID: LeagueID
    public var leagueName: String
    public var participant: LeagueParticipant?
    public var team: Team?
    public var warning: String?

    public init(
        leagueID: LeagueID,
        leagueName: String,
        participant: LeagueParticipant? = nil,
        team: Team? = nil,
        warning: String? = nil
    ) {
        self.leagueID = leagueID
        self.leagueName = leagueName
        self.participant = participant
        self.team = team
        self.warning = warning
    }

    private enum CodingKeys: String, CodingKey {
        case league
        case participant
        case team
        case warning
    }

    private struct LeagueStub: Decodable {
        let id: LeagueID
        let name: String
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let league = try c.decode(LeagueStub.self, forKey: .league)
        leagueID = league.id
        leagueName = league.name
        participant = try c.decodeIfPresent(LeagueParticipant.self, forKey: .participant)
        team = try c.decodeIfPresent(Team.self, forKey: .team)
        warning = try c.decodeIfPresent(String.self, forKey: .warning)
    }
}

// MARK: - Join

/// `join-league`: exactly one way in, plus an optional team name.
public struct JoinLeagueRequest: Encodable, Sendable, Hashable {
    public enum Route: Sendable, Hashable {
        /// A share code, already normalized (`JoinCode.normalize`).
        case code(String)
        /// An email invitation's token. Bound to the invited email address.
        case invitation(token: String)
        /// An open league by id (API capability; there is no public directory).
        case league(LeagueID)
    }

    public var route: Route
    public var teamName: String?

    public init(route: Route, teamName: String? = nil) {
        self.route = route
        self.teamName = teamName
    }

    private enum CodingKeys: String, CodingKey {
        case joinCode = "join_code"
        case invitationToken = "invitation_token"
        case leagueID = "league_id"
        case teamName = "team_name"
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch route {
        case .code(let code): try c.encode(code, forKey: .joinCode)
        case .invitation(let token): try c.encode(token, forKey: .invitationToken)
        case .league(let id): try c.encode(id, forKey: .leagueID)
        }
        try c.encodeIfPresent(teamName, forKey: .teamName)
    }
}

// MARK: - Update (commissioner)

/// The trade section of the settings, sent whole: `nil` deadline clears it,
/// and a `nil` expiry bound restores the app default.
public struct TradeSettings: Sendable, Hashable {
    public var tradesEnabled: Bool
    public var tradeDeadline: DateOnly?
    public var reviewEnabled: Bool
    public var reviewHours: Int
    public var expiryDefaultHours: Int?
    public var expiryMinHours: Int?
    public var expiryMaxDays: Int?

    public init(
        tradesEnabled: Bool,
        tradeDeadline: DateOnly?,
        reviewEnabled: Bool,
        reviewHours: Int,
        expiryDefaultHours: Int?,
        expiryMinHours: Int?,
        expiryMaxDays: Int?
    ) {
        self.tradesEnabled = tradesEnabled
        self.tradeDeadline = tradeDeadline
        self.reviewEnabled = reviewEnabled
        self.reviewHours = reviewHours
        self.expiryDefaultHours = expiryDefaultHours
        self.expiryMinHours = expiryMinHours
        self.expiryMaxDays = expiryMaxDays
    }

    public init(league: League) {
        self.init(
            tradesEnabled: league.tradesEnabled,
            tradeDeadline: league.tradeDeadline,
            reviewEnabled: league.tradeReviewEnabled,
            reviewHours: league.tradeVetoHours,
            expiryDefaultHours: league.tradeOfferExpiryDefaultHours,
            expiryMinHours: league.tradeOfferExpiryMinHours,
            expiryMaxDays: league.tradeOfferExpiryMaxDays
        )
    }
}

/// One `update-league` action. Every case is owner-only on the server, which
/// also enforces the phase each one is allowed in.
public enum LeagueUpdate: Sendable, Hashable {
    /// Series name (renames every season) and/or this season's invite-only.
    case info(name: String? = nil, inviteOnly: Bool? = nil)
    /// Setup only. 2–20 and not below the active count.
    case participantLimit(Int)
    /// Setup only.
    case roster(totalSlots: Int, draftSlots: Int, dropLimit: Int, counterbidHours: Int, newBidCutoffHours: Int)
    /// Setup only.
    case counterpicks(draftSlots: Int, biddingSlots: Int, blockDrops: Bool)
    /// Until completion.
    case trades(TradeSettings)
    /// Year in setup only (changing it alone resets the end to Dec 31); end until completion.
    case season(year: Int? = nil, end: DateOnly? = nil)
    /// Setup and drafting; the server rescores the season.
    case scoring(doublePointsOver90: Bool)
    /// Setup only.
    case randomizeDraftOrder
    /// Setup only. Every active participant exactly once, first pick first.
    case reorderDraft([ParticipantID])
    /// Setup only. Never the owner.
    case removeParticipant(ParticipantID)
    /// Setup only. Deletes this season.
    case deleteSeason
    /// Active only. Final scoring, champions, frozen gameplay.
    case completeSeason

    public var action: String {
        switch self {
        case .info: "update_info"
        case .participantLimit: "update_draft_config"
        case .roster: "update_bidding_config"
        case .counterpicks: "update_counterpick_config"
        case .trades: "update_trade_config"
        case .season: "update_season_config"
        case .scoring: "update_scoring_config"
        case .randomizeDraftOrder: "randomize_draft_order"
        case .reorderDraft: "reorder_participants"
        case .removeParticipant: "kick_participant"
        case .deleteSeason: "delete_league"
        case .completeSeason: "complete_league"
        }
    }
}

/// The JSON body for `update-league`: the action, the season, and its fields.
public struct LeagueUpdateRequest: Encodable, Sendable, Hashable {
    public var leagueID: LeagueID
    public var update: LeagueUpdate

    public init(leagueID: LeagueID, update: LeagueUpdate) {
        self.leagueID = leagueID
        self.update = update
    }

    private enum CodingKeys: String, CodingKey {
        case action
        case leagueID = "league_id"
        case name
        case inviteOnly = "invite_only"
        case maxParticipants = "max_participants"
        case totalSlots = "total_slots"
        case draftSlots = "draft_slots"
        case dropLimit = "drop_limit"
        case counterbidHours = "counterbid_hours"
        case newBidCutoffHours = "new_bid_cutoff_hours"
        case draftCounterpickSlots = "draft_counterpick_slots"
        case biddingCounterpickSlots = "bidding_counterpick_slots"
        case counterpicksBlockDrops = "counterpicks_block_drops"
        case tradesEnabled = "trades_enabled"
        case tradeDeadline = "trade_deadline"
        case tradeReviewEnabled = "trade_review_enabled"
        case tradeVetoHours = "trade_veto_hours"
        case expiryDefaultHours = "trade_offer_expiry_default_hours"
        case expiryMinHours = "trade_offer_expiry_min_hours"
        case expiryMaxDays = "trade_offer_expiry_max_days"
        case seasonYear = "season_year"
        case seasonEnd = "season_end"
        case doublePointsOver90 = "double_points_over_90"
        case participantOrder = "participant_order"
        case participantID = "participant_id"
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(update.action, forKey: .action)
        try c.encode(leagueID, forKey: .leagueID)
        switch update {
        case .info(let name, let inviteOnly):
            try c.encodeIfPresent(name, forKey: .name)
            try c.encodeIfPresent(inviteOnly, forKey: .inviteOnly)
        case .participantLimit(let limit):
            try c.encode(limit, forKey: .maxParticipants)
        case .roster(let totalSlots, let draftSlots, let dropLimit, let counterbidHours, let cutoff):
            try c.encode(totalSlots, forKey: .totalSlots)
            try c.encode(draftSlots, forKey: .draftSlots)
            try c.encode(dropLimit, forKey: .dropLimit)
            try c.encode(counterbidHours, forKey: .counterbidHours)
            try c.encode(cutoff, forKey: .newBidCutoffHours)
        case .counterpicks(let draftSlots, let biddingSlots, let blockDrops):
            try c.encode(draftSlots, forKey: .draftCounterpickSlots)
            try c.encode(biddingSlots, forKey: .biddingCounterpickSlots)
            try c.encode(blockDrops, forKey: .counterpicksBlockDrops)
        case .trades(let settings):
            // Explicit nulls matter here: they clear the deadline and restore
            // the default expiry bounds.
            try c.encode(settings.tradesEnabled, forKey: .tradesEnabled)
            try c.encode(settings.tradeDeadline, forKey: .tradeDeadline)
            try c.encode(settings.reviewEnabled, forKey: .tradeReviewEnabled)
            try c.encode(settings.reviewHours, forKey: .tradeVetoHours)
            try c.encode(settings.expiryDefaultHours, forKey: .expiryDefaultHours)
            try c.encode(settings.expiryMinHours, forKey: .expiryMinHours)
            try c.encode(settings.expiryMaxDays, forKey: .expiryMaxDays)
        case .season(let year, let end):
            try c.encodeIfPresent(year, forKey: .seasonYear)
            try c.encodeIfPresent(end, forKey: .seasonEnd)
        case .scoring(let double):
            try c.encode(double, forKey: .doublePointsOver90)
        case .randomizeDraftOrder, .deleteSeason, .completeSeason:
            break
        case .reorderDraft(let order):
            try c.encode(order, forKey: .participantOrder)
        case .removeParticipant(let id):
            try c.encode(id, forKey: .participantID)
        }
    }
}

/// What `update-league` answers: the updated season for config changes, and a
/// sentence for the rest ("Draft order updated successfully").
public struct LeagueUpdateResult: Decodable, Sendable, Hashable {
    public var league: League?
    public var message: String?

    public init(league: League? = nil, message: String? = nil) {
        self.league = league
        self.message = message
    }
}

// MARK: - Next season

/// `start-next-season`. A 409 means another device (or a second tap) already
/// rolled over; it carries that season's id, so open it instead of failing.
public struct NextSeason: Decodable, Sendable, Hashable {
    public var leagueID: LeagueID
    public var seasonYear: Int
    /// False when the season already existed (the 409 path).
    public var wasCreated: Bool

    public init(leagueID: LeagueID, seasonYear: Int, wasCreated: Bool = true) {
        self.leagueID = leagueID
        self.seasonYear = seasonYear
        self.wasCreated = wasCreated
    }

    private enum CodingKeys: String, CodingKey {
        case leagueID = "league_id"
        case seasonYear = "season_year"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        seasonYear = try c.decode(Int.self, forKey: .seasonYear)
        wasCreated = true
    }
}
