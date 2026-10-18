import Foundation

// MARK: - Status and reasons

/// `bid_status`, shared by pickup and counterpick bids.
public enum BidStatus: Codable, Sendable, Hashable {
    /// Leading its contest.
    case active
    /// Beaten, but still a committed offer: it can win if higher bidders can't
    /// be honored, and it can be cancelled before the cutoff.
    case outbid
    case won
    case lost
    case cancelled
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "active": self = .active
        case "outbid": self = .outbid
        case "won": self = .won
        case "lost": self = .lost
        case "cancelled": self = .cancelled
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .active: "active"
        case .outbid: "outbid"
        case .won: "won"
        case .lost: "lost"
        case .cancelled: "cancelled"
        case .unknown(let value): value
        }
    }

    /// Still waiting for processing (`active` or `outbid`).
    public var isPending: Bool { self == .active || self == .outbid }

    public init(from decoder: any Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// Why a bid was lost or cancelled (`resolution_reason`). Nil on pending and
/// won bids, and on old outcomes with no recorded reason.
public enum BidResolutionReason: Codable, Sendable, Hashable {
    case outbid
    case noSlots
    case insufficientBudget
    case movieReleased
    case movieScored
    case movieDropped
    case targetOwned
    case targetMissing
    case userCancelled
    case seasonCompleted
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "outbid": self = .outbid
        case "no_slots": self = .noSlots
        case "insufficient_budget": self = .insufficientBudget
        case "movie_released": self = .movieReleased
        case "movie_scored": self = .movieScored
        case "movie_dropped": self = .movieDropped
        case "target_owned": self = .targetOwned
        case "target_missing": self = .targetMissing
        case "user_cancelled": self = .userCancelled
        case "season_completed": self = .seasonCompleted
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .outbid: "outbid"
        case .noSlots: "no_slots"
        case .insufficientBudget: "insufficient_budget"
        case .movieReleased: "movie_released"
        case .movieScored: "movie_scored"
        case .movieDropped: "movie_dropped"
        case .targetOwned: "target_owned"
        case .targetMissing: "target_missing"
        case .userCancelled: "user_cancelled"
        case .seasonCompleted: "season_completed"
        case .unknown(let value): value
        }
    }

    /// Short history wording, reusing the results post's phrasing. Nil for
    /// reasons with nothing useful to add.
    public func explanation(isCounterpick: Bool) -> String? {
        switch self {
        case .outbid: "Outbid"
        case .noSlots: isCounterpick ? "No counterpick slots left" : "No roster room"
        case .insufficientBudget: "Budget committed to higher-priority bids"
        case .movieReleased: "The movie released before processing"
        case .movieScored: "The movie got its score before processing"
        case .movieDropped: "The movie was dropped by its holder"
        case .targetOwned: "The movie was traded to the bidder"
        case .targetMissing: "The targeted holding no longer exists"
        case .userCancelled, .seasonCompleted, .unknown: nil
        }
    }

    public init(from decoder: any Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

// MARK: - Pickup bids

/// The server's movie snapshot on a pickup bid (`movie_data`). Nullable on old
/// rows; the movie may have no `movies` row yet.
public struct BidMovieData: Codable, Sendable, Hashable {
    public var title: String?
    public var overview: String?
    public var posterURL: String?
    public var releaseDate: DateOnly?

    public init(title: String?, overview: String? = nil, posterURL: String? = nil, releaseDate: DateOnly? = nil) {
        self.title = title
        self.overview = overview
        self.posterURL = posterURL
        self.releaseDate = releaseDate
    }

    enum CodingKeys: String, CodingKey {
        case title, overview
        case posterURL = "poster_url"
        case releaseDate = "release_date"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        overview = try c.decodeIfPresent(String.self, forKey: .overview)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        // A malformed date shouldn't drop the whole bid.
        releaseDate = (try? c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)) ?? nil
    }
}

/// A `pickup_bids` row: a bid on an available movie, by TMDb id.
public struct PickupBid: Codable, Sendable, Hashable, Identifiable {
    public var id: BidID
    public var leagueID: LeagueID
    public var teamID: TeamID
    public var tmdbID: TMDbID
    public var movieData: BidMovieData?
    public var amount: Int
    public var status: BidStatus
    public var resolutionReason: BidResolutionReason?
    public var createdAt: Date
    public var counteredAt: Date?
    /// The outbid team's counter-response deadline.
    public var responseDeadline: Date?
    /// Stamped at placement, never rewritten.
    public var processingDeadline: Date
    /// The team's own rank among its pending bids (1 = wanted most).
    public var priority: Int
    public var conditionalDropDraftPickID: HoldingID?
    public var conditionalDropPickupID: HoldingID?

    public init(
        id: BidID, leagueID: LeagueID, teamID: TeamID, tmdbID: TMDbID, movieData: BidMovieData?,
        amount: Int, status: BidStatus, resolutionReason: BidResolutionReason? = nil,
        createdAt: Date, counteredAt: Date? = nil, responseDeadline: Date? = nil,
        processingDeadline: Date, priority: Int = 1,
        conditionalDropDraftPickID: HoldingID? = nil, conditionalDropPickupID: HoldingID? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.teamID = teamID
        self.tmdbID = tmdbID
        self.movieData = movieData
        self.amount = amount
        self.status = status
        self.resolutionReason = resolutionReason
        self.createdAt = createdAt
        self.counteredAt = counteredAt
        self.responseDeadline = responseDeadline
        self.processingDeadline = processingDeadline
        self.priority = priority
        self.conditionalDropDraftPickID = conditionalDropDraftPickID
        self.conditionalDropPickupID = conditionalDropPickupID
    }

    enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case teamID = "team_id"
        case tmdbID = "tmdb_id"
        case movieData = "movie_data"
        case amount, status
        case resolutionReason = "resolution_reason"
        case createdAt = "created_at"
        case counteredAt = "countered_at"
        case responseDeadline = "response_deadline"
        case processingDeadline = "processing_deadline"
        case priority
        case conditionalDropDraftPickID = "conditional_drop_draft_pick_id"
        case conditionalDropPickupID = "conditional_drop_pickup_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(BidID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        teamID = try c.decode(TeamID.self, forKey: .teamID)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        movieData = try? c.decodeIfPresent(BidMovieData.self, forKey: .movieData)
        amount = try c.decodeInteger(forKey: .amount) ?? 0
        status = try c.decode(BidStatus.self, forKey: .status)
        resolutionReason = try c.decodeIfPresent(BidResolutionReason.self, forKey: .resolutionReason)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        counteredAt = try c.decodeIfPresent(Date.self, forKey: .counteredAt)
        responseDeadline = try c.decodeIfPresent(Date.self, forKey: .responseDeadline)
        processingDeadline = try c.decode(Date.self, forKey: .processingDeadline)
        priority = try c.decodeInteger(forKey: .priority) ?? 1
        conditionalDropDraftPickID = try c.decodeIfPresent(HoldingID.self, forKey: .conditionalDropDraftPickID)
        conditionalDropPickupID = try c.decodeIfPresent(HoldingID.self, forKey: .conditionalDropPickupID)
    }

    public var title: String { movieData?.title ?? "Movie #\(tmdbID.rawValue)" }
    public var releaseDate: DateOnly? { movieData?.releaseDate }
    public var posterURL: String? { movieData?.posterURL }

    /// The holding released if this bid wins, if any.
    public var conditionalDropHoldingID: HoldingID? { conditionalDropPickupID ?? conditionalDropDraftPickID }
}

// MARK: - Counterpick bids

/// A `counterpick_bids` row: a bid to counterpick another team's movie.
public struct CounterpickBid: Codable, Sendable, Hashable, Identifiable {
    /// The embedded `movies(title, poster_url, release_date, fantasy_points)`.
    public struct MovieSummary: Codable, Sendable, Hashable {
        public var title: String?
        public var posterURL: String?
        public var releaseDate: DateOnly?
        public var fantasyPoints: Double?

        public init(title: String?, posterURL: String? = nil, releaseDate: DateOnly? = nil, fantasyPoints: Double? = nil) {
            self.title = title
            self.posterURL = posterURL
            self.releaseDate = releaseDate
            self.fantasyPoints = fantasyPoints
        }

        enum CodingKeys: String, CodingKey {
            case title
            case posterURL = "poster_url"
            case releaseDate = "release_date"
            case fantasyPoints = "fantasy_points"
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            title = try c.decodeIfPresent(String.self, forKey: .title)
            posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
            releaseDate = try c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)
            fantasyPoints = try c.decodeNumeric(forKey: .fantasyPoints)
        }
    }

    public var id: BidID
    public var leagueID: LeagueID
    public var teamID: TeamID
    public var movieID: MovieID
    public var targetTeamID: TeamID
    public var draftPickID: HoldingID?
    public var pickupID: HoldingID?
    public var amount: Int
    public var priority: Int
    public var status: BidStatus
    public var resolutionReason: BidResolutionReason?
    public var createdAt: Date
    public var counteredAt: Date?
    public var responseDeadline: Date?
    public var processingDeadline: Date
    public var movie: MovieSummary?
    public var targetTeamName: String?

    public init(
        id: BidID, leagueID: LeagueID, teamID: TeamID, movieID: MovieID, targetTeamID: TeamID,
        draftPickID: HoldingID? = nil, pickupID: HoldingID? = nil, amount: Int, priority: Int = 1,
        status: BidStatus, resolutionReason: BidResolutionReason? = nil, createdAt: Date,
        counteredAt: Date? = nil, responseDeadline: Date? = nil, processingDeadline: Date,
        movie: MovieSummary? = nil, targetTeamName: String? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.teamID = teamID
        self.movieID = movieID
        self.targetTeamID = targetTeamID
        self.draftPickID = draftPickID
        self.pickupID = pickupID
        self.amount = amount
        self.priority = priority
        self.status = status
        self.resolutionReason = resolutionReason
        self.createdAt = createdAt
        self.counteredAt = counteredAt
        self.responseDeadline = responseDeadline
        self.processingDeadline = processingDeadline
        self.movie = movie
        self.targetTeamName = targetTeamName
    }

    enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case teamID = "team_id"
        case movieID = "movie_id"
        case targetTeamID = "target_team_id"
        case draftPickID = "draft_pick_id"
        case pickupID = "pickup_id"
        case amount, priority, status
        case resolutionReason = "resolution_reason"
        case createdAt = "created_at"
        case counteredAt = "countered_at"
        case responseDeadline = "response_deadline"
        case processingDeadline = "processing_deadline"
        case movie = "movies"
        case targetTeam = "target_team"
    }

    private struct TeamName: Codable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(BidID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        teamID = try c.decode(TeamID.self, forKey: .teamID)
        movieID = try c.decode(MovieID.self, forKey: .movieID)
        targetTeamID = try c.decode(TeamID.self, forKey: .targetTeamID)
        draftPickID = try c.decodeIfPresent(HoldingID.self, forKey: .draftPickID)
        pickupID = try c.decodeIfPresent(HoldingID.self, forKey: .pickupID)
        amount = try c.decodeInteger(forKey: .amount) ?? 0
        priority = try c.decodeInteger(forKey: .priority) ?? 1
        status = try c.decode(BidStatus.self, forKey: .status)
        resolutionReason = try c.decodeIfPresent(BidResolutionReason.self, forKey: .resolutionReason)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        counteredAt = try c.decodeIfPresent(Date.self, forKey: .counteredAt)
        responseDeadline = try c.decodeIfPresent(Date.self, forKey: .responseDeadline)
        processingDeadline = try c.decode(Date.self, forKey: .processingDeadline)
        movie = try c.decodeIfPresent(MovieSummary.self, forKey: .movie)
        targetTeamName = try c.decodeIfPresent(TeamName.self, forKey: .targetTeam)?.name
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(leagueID, forKey: .leagueID)
        try c.encode(teamID, forKey: .teamID)
        try c.encode(movieID, forKey: .movieID)
        try c.encode(targetTeamID, forKey: .targetTeamID)
        try c.encodeIfPresent(draftPickID, forKey: .draftPickID)
        try c.encodeIfPresent(pickupID, forKey: .pickupID)
        try c.encode(amount, forKey: .amount)
        try c.encode(priority, forKey: .priority)
        try c.encode(status, forKey: .status)
        try c.encodeIfPresent(resolutionReason, forKey: .resolutionReason)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(counteredAt, forKey: .counteredAt)
        try c.encodeIfPresent(responseDeadline, forKey: .responseDeadline)
        try c.encode(processingDeadline, forKey: .processingDeadline)
        try c.encodeIfPresent(movie, forKey: .movie)
        try c.encodeIfPresent(targetTeamName.map { TeamName(name: $0) }, forKey: .targetTeam)
    }

    public var title: String { movie?.title ?? "Unknown movie" }
    public var releaseDate: DateOnly? { movie?.releaseDate }
    /// Scored movies can't be counterpicked; a pending bid on one is cancelled
    /// uncharged at processing.
    public var isScoreLocked: Bool { FantasyPoints.isScoreLocked(movie?.fantasyPoints) }
}

/// A movie a pickup bid can target, from search or browse.
public struct BiddableMovie: Codable, Sendable, Hashable, Identifiable {
    public var tmdbID: TMDbID
    public var title: String
    public var overview: String?
    public var releaseDate: DateOnly?
    public var posterURL: String?

    public var id: TMDbID { tmdbID }

    public init(tmdbID: TMDbID, title: String, overview: String? = nil, releaseDate: DateOnly? = nil, posterURL: String? = nil) {
        self.tmdbID = tmdbID
        self.title = title
        self.overview = overview
        self.releaseDate = releaseDate
        self.posterURL = posterURL
    }

    enum CodingKeys: String, CodingKey {
        case tmdbID = "tmdb_id"
        case title, overview
        case releaseDate = "release_date"
        case posterURL = "poster_url"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        title = try c.decode(String.self, forKey: .title)
        overview = try c.decodeIfPresent(String.self, forKey: .overview)
        releaseDate = (try? c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)) ?? nil
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
    }
}
