import Foundation

/// One season: a `leagues` row, as `leagues.select('*')` returns it.
///
/// The name is a denormalized copy of `league_series.name` (the source of
/// truth); read it freely, never write it. Season config fields decode with
/// their schema defaults when a partial select leaves them out.
public struct League: Codable, Sendable, Hashable, Identifiable {
    public var id: LeagueID
    public var name: String
    public var ownerID: UserID
    public var inviteOnly: Bool
    public var status: LeagueStatus
    public var maxParticipants: Int
    /// `timestamptz`. Informational: there is no automatic draft start or end.
    public var draftStartDate: Date?
    public var draftEndDate: Date?

    // Bidding
    public var totalSlots: Int
    public var draftSlots: Int
    public var dropLimit: Int
    public var counterbidHours: Int
    /// Hours before the weekly processing deadline after which no new bids may
    /// be opened (raises and counters still allowed). 0 disables the cutoff.
    public var newBidCutoffHours: Int
    /// Starting Fantasy Budget per team (the column keeps its old `faab` name).
    public var faabBudget: Int

    // Trading
    public var tradesEnabled: Bool
    /// Last date a trade may happen. Nil: no deadline.
    public var tradeDeadline: DateOnly?
    public var tradeReviewEnabled: Bool
    public var tradeVetoHours: Int
    /// Nil means "use the app default", not "unbounded".
    public var tradeOfferExpiryDefaultHours: Int?
    public var tradeOfferExpiryMinHours: Int?
    public var tradeOfferExpiryMaxDays: Int?

    // Counterpicks
    public var draftCounterpickSlots: Int
    public var biddingCounterpickSlots: Int
    public var counterpicksBlockDrops: Bool

    /// The season's 90+ rule: 2 points per Tomatometer point above 90. Already
    /// applied in `team_holdings`/`counterpicks`/team totals; apply it by hand
    /// only to raw `movies` rows (`FantasyPoints.leagueFantasyPoints`).
    public var doublePointsOver90: Bool
    public var customDraftOrder: Bool
    /// Present when the caller may read it (owners share it as an invite code).
    public var joinCode: String?

    // Season identity
    public var seriesID: SeriesID
    /// The season label (e.g. 2026). Drives movie eligibility, not the wall clock.
    public var seasonYear: Int
    /// The day scores freeze and the champion is recorded.
    public var seasonEnd: DateOnly
    public var completedAt: Date?
    /// Every team tied at rank 1 at completion: co-champions, no tiebreak.
    public var winnerTeamIDs: [TeamID]?
    /// The frozen final table. Completed-season surfaces read this and fall back
    /// to `league_standings` only when it is nil (older seasons).
    public var finalStandings: [FinalStandingRow]?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: LeagueID,
        name: String,
        ownerID: UserID,
        inviteOnly: Bool = false,
        status: LeagueStatus,
        maxParticipants: Int = 8,
        draftStartDate: Date? = nil,
        draftEndDate: Date? = nil,
        totalSlots: Int = 8,
        draftSlots: Int = 5,
        dropLimit: Int = 2,
        counterbidHours: Int = 24,
        newBidCutoffHours: Int = 48,
        faabBudget: Int = 100,
        tradesEnabled: Bool = true,
        tradeDeadline: DateOnly? = nil,
        tradeReviewEnabled: Bool = true,
        tradeVetoHours: Int = 24,
        tradeOfferExpiryDefaultHours: Int? = nil,
        tradeOfferExpiryMinHours: Int? = nil,
        tradeOfferExpiryMaxDays: Int? = nil,
        draftCounterpickSlots: Int = 1,
        biddingCounterpickSlots: Int = 0,
        counterpicksBlockDrops: Bool = true,
        doublePointsOver90: Bool = false,
        customDraftOrder: Bool = false,
        joinCode: String? = nil,
        seriesID: SeriesID,
        seasonYear: Int,
        seasonEnd: DateOnly,
        completedAt: Date? = nil,
        winnerTeamIDs: [TeamID]? = nil,
        finalStandings: [FinalStandingRow]? = nil,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.name = name
        self.ownerID = ownerID
        self.inviteOnly = inviteOnly
        self.status = status
        self.maxParticipants = maxParticipants
        self.draftStartDate = draftStartDate
        self.draftEndDate = draftEndDate
        self.totalSlots = totalSlots
        self.draftSlots = draftSlots
        self.dropLimit = dropLimit
        self.counterbidHours = counterbidHours
        self.newBidCutoffHours = newBidCutoffHours
        self.faabBudget = faabBudget
        self.tradesEnabled = tradesEnabled
        self.tradeDeadline = tradeDeadline
        self.tradeReviewEnabled = tradeReviewEnabled
        self.tradeVetoHours = tradeVetoHours
        self.tradeOfferExpiryDefaultHours = tradeOfferExpiryDefaultHours
        self.tradeOfferExpiryMinHours = tradeOfferExpiryMinHours
        self.tradeOfferExpiryMaxDays = tradeOfferExpiryMaxDays
        self.draftCounterpickSlots = draftCounterpickSlots
        self.biddingCounterpickSlots = biddingCounterpickSlots
        self.counterpicksBlockDrops = counterpicksBlockDrops
        self.doublePointsOver90 = doublePointsOver90
        self.customDraftOrder = customDraftOrder
        self.joinCode = joinCode
        self.seriesID = seriesID
        self.seasonYear = seasonYear
        self.seasonEnd = seasonEnd
        self.completedAt = completedAt
        self.winnerTeamIDs = winnerTeamIDs
        self.finalStandings = finalStandings
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case name
        case ownerID = "owner_id"
        case inviteOnly = "invite_only"
        case status
        case maxParticipants = "max_participants"
        case draftStartDate = "draft_start_date"
        case draftEndDate = "draft_end_date"
        case totalSlots = "total_slots"
        case draftSlots = "draft_slots"
        case dropLimit = "drop_limit"
        case counterbidHours = "counterbid_hours"
        case newBidCutoffHours = "new_bid_cutoff_hours"
        case faabBudget = "faab_budget"
        case tradesEnabled = "trades_enabled"
        case tradeDeadline = "trade_deadline"
        case tradeReviewEnabled = "trade_review_enabled"
        case tradeVetoHours = "trade_veto_hours"
        case tradeOfferExpiryDefaultHours = "trade_offer_expiry_default_hours"
        case tradeOfferExpiryMinHours = "trade_offer_expiry_min_hours"
        case tradeOfferExpiryMaxDays = "trade_offer_expiry_max_days"
        case draftCounterpickSlots = "draft_counterpick_slots"
        case biddingCounterpickSlots = "bidding_counterpick_slots"
        case counterpicksBlockDrops = "counterpicks_block_drops"
        case doublePointsOver90 = "double_points_over_90"
        case customDraftOrder = "custom_draft_order"
        case joinCode = "join_code"
        case seriesID = "series_id"
        case seasonYear = "season_year"
        case seasonEnd = "season_end"
        case completedAt = "completed_at"
        case winnerTeamIDs = "winner_team_ids"
        case finalStandings = "final_standings"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(LeagueID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        ownerID = try c.decode(UserID.self, forKey: .ownerID)
        inviteOnly = try c.decode(Bool.self, forKey: .inviteOnly, default: false)
        status = try c.decode(LeagueStatus.self, forKey: .status)
        maxParticipants = try c.decodeInteger(forKey: .maxParticipants) ?? 8
        draftStartDate = try c.decodeIfPresent(Date.self, forKey: .draftStartDate)
        draftEndDate = try c.decodeIfPresent(Date.self, forKey: .draftEndDate)
        totalSlots = try c.decodeInteger(forKey: .totalSlots) ?? 8
        draftSlots = try c.decodeInteger(forKey: .draftSlots) ?? 5
        dropLimit = try c.decodeInteger(forKey: .dropLimit) ?? 2
        counterbidHours = try c.decodeInteger(forKey: .counterbidHours) ?? 24
        newBidCutoffHours = try c.decodeInteger(forKey: .newBidCutoffHours) ?? 48
        faabBudget = try c.decodeInteger(forKey: .faabBudget) ?? 100
        tradesEnabled = try c.decode(Bool.self, forKey: .tradesEnabled, default: true)
        tradeDeadline = try c.decodeIfPresent(DateOnly.self, forKey: .tradeDeadline)
        tradeReviewEnabled = try c.decode(Bool.self, forKey: .tradeReviewEnabled, default: true)
        tradeVetoHours = try c.decodeInteger(forKey: .tradeVetoHours) ?? 24
        tradeOfferExpiryDefaultHours = try c.decodeInteger(forKey: .tradeOfferExpiryDefaultHours)
        tradeOfferExpiryMinHours = try c.decodeInteger(forKey: .tradeOfferExpiryMinHours)
        tradeOfferExpiryMaxDays = try c.decodeInteger(forKey: .tradeOfferExpiryMaxDays)
        draftCounterpickSlots = try c.decodeInteger(forKey: .draftCounterpickSlots) ?? 1
        biddingCounterpickSlots = try c.decodeInteger(forKey: .biddingCounterpickSlots) ?? 0
        counterpicksBlockDrops = try c.decode(Bool.self, forKey: .counterpicksBlockDrops, default: true)
        doublePointsOver90 = try c.decode(Bool.self, forKey: .doublePointsOver90, default: false)
        customDraftOrder = try c.decode(Bool.self, forKey: .customDraftOrder, default: false)
        joinCode = try c.decodeIfPresent(String.self, forKey: .joinCode)
        seriesID = try c.decode(SeriesID.self, forKey: .seriesID)
        seasonYear = try c.decode(Int.self, forKey: .seasonYear)
        seasonEnd = try c.decode(DateOnly.self, forKey: .seasonEnd)
        completedAt = try c.decodeIfPresent(Date.self, forKey: .completedAt)
        winnerTeamIDs = try c.decodeIfPresent([TeamID].self, forKey: .winnerTeamIDs)
        finalStandings = try c.decodeIfPresent([FinalStandingRow].self, forKey: .finalStandings)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
    }

    public var isCompleted: Bool { status == .completed }

    public func isOwned(by userID: UserID?) -> Bool {
        guard let userID else { return false }
        return ownerID == userID
    }

    public var seasonSummary: SeasonSummary {
        SeasonSummary(
            id: id,
            seasonYear: seasonYear,
            status: status,
            completedAt: completedAt,
            winnerTeamIDs: winnerTeamIDs
        )
    }
}

/// One season of a series, as the switcher and history list them.
public struct SeasonSummary: Codable, Sendable, Hashable, Identifiable {
    public var id: LeagueID
    public var seasonYear: Int
    public var status: LeagueStatus
    public var completedAt: Date?
    public var winnerTeamIDs: [TeamID]?

    public init(
        id: LeagueID,
        seasonYear: Int,
        status: LeagueStatus,
        completedAt: Date? = nil,
        winnerTeamIDs: [TeamID]? = nil
    ) {
        self.id = id
        self.seasonYear = seasonYear
        self.status = status
        self.completedAt = completedAt
        self.winnerTeamIDs = winnerTeamIDs
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case seasonYear = "season_year"
        case status
        case completedAt = "completed_at"
        case winnerTeamIDs = "winner_team_ids"
    }
}

/// The durable league identity across seasons (`league_series`). In the UI this
/// is "the league"; a `League` row is "a season".
public struct LeagueSeries: Codable, Sendable, Hashable, Identifiable {
    public var id: SeriesID
    public var name: String
    public var ownerID: UserID
    /// Only filled when the caller joined `series_seasons`; empty otherwise.
    public var seasons: [SeasonSummary]

    public init(id: SeriesID, name: String, ownerID: UserID, seasons: [SeasonSummary] = []) {
        self.id = id
        self.name = name
        self.ownerID = ownerID
        self.seasons = seasons
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case name
        case ownerID = "owner_id"
        case seasons
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(SeriesID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        ownerID = try c.decode(UserID.self, forKey: .ownerID)
        seasons = try c.decode([SeasonSummary].self, forKey: .seasons, default: [])
    }
}

/// One row of the `league_standings(p_league_id)` RPC, the only source of rank.
/// Competition ranking (1, 2, 2, 4); `isTied` marks a shared rank.
///
/// `totalPoints` keeps server precision: compare and sum it, never the rounded
/// display value.
public struct StandingRow: Codable, Sendable, Hashable, Identifiable {
    public var teamID: TeamID
    public var teamName: String
    public var participantID: ParticipantID
    public var userID: UserID
    public var totalPoints: Double
    public var rank: Int
    public var isTied: Bool

    public var id: TeamID { teamID }

    public init(
        teamID: TeamID,
        teamName: String,
        participantID: ParticipantID,
        userID: UserID,
        totalPoints: Double,
        rank: Int,
        isTied: Bool
    ) {
        self.teamID = teamID
        self.teamName = teamName
        self.participantID = participantID
        self.userID = userID
        self.totalPoints = totalPoints
        self.rank = rank
        self.isTied = isTied
    }

    public enum CodingKeys: String, CodingKey {
        case teamID = "team_id"
        case teamName = "team_name"
        case participantID = "participant_id"
        case userID = "user_id"
        case totalPoints = "total_points"
        case rank
        case isTied = "is_tied"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        teamID = try c.decode(TeamID.self, forKey: .teamID)
        teamName = try c.decode(String.self, forKey: .teamName)
        participantID = try c.decode(ParticipantID.self, forKey: .participantID)
        userID = try c.decode(UserID.self, forKey: .userID)
        totalPoints = try c.decodeNumeric(forKey: .totalPoints) ?? 0
        rank = try c.decode(Int.self, forKey: .rank)
        isTied = try c.decode(Bool.self, forKey: .isTied, default: false)
    }
}

/// A `leagues.final_standings` element: a standings row frozen at completion
/// with the owner's name inline. It keeps teams whose owner later left (the
/// live RPC drops them); a deleted account reads "Former member".
public struct FinalStandingRow: Codable, Sendable, Hashable, Identifiable {
    public var teamID: TeamID
    public var teamName: String
    public var participantID: ParticipantID
    public var userID: UserID
    public var totalPoints: Double
    public var rank: Int
    public var isTied: Bool
    public var displayName: String?

    public var id: TeamID { teamID }

    public init(
        teamID: TeamID,
        teamName: String,
        participantID: ParticipantID,
        userID: UserID,
        totalPoints: Double,
        rank: Int,
        isTied: Bool,
        displayName: String?
    ) {
        self.teamID = teamID
        self.teamName = teamName
        self.participantID = participantID
        self.userID = userID
        self.totalPoints = totalPoints
        self.rank = rank
        self.isTied = isTied
        self.displayName = displayName
    }

    public enum CodingKeys: String, CodingKey {
        case teamID = "team_id"
        case teamName = "team_name"
        case participantID = "participant_id"
        case userID = "user_id"
        case totalPoints = "total_points"
        case rank
        case isTied = "is_tied"
        case displayName = "display_name"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        teamID = try c.decode(TeamID.self, forKey: .teamID)
        teamName = try c.decode(String.self, forKey: .teamName)
        participantID = try c.decode(ParticipantID.self, forKey: .participantID)
        userID = try c.decode(UserID.self, forKey: .userID)
        totalPoints = try c.decodeNumeric(forKey: .totalPoints) ?? 0
        rank = try c.decode(Int.self, forKey: .rank)
        isTied = try c.decode(Bool.self, forKey: .isTied, default: false)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
    }

    /// The row without the frozen name, for code shared with live standings.
    public var standing: StandingRow {
        StandingRow(
            teamID: teamID,
            teamName: teamName,
            participantID: participantID,
            userID: userID,
            totalPoints: totalPoints,
            rank: rank,
            isTied: isTied
        )
    }
}
