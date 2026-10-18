import Foundation

// MARK: - Enums

/// `trade_offers.status`.
public enum TradeStatus: Codable, Sendable, Hashable {
    case proposed
    case countered
    /// Agreed with no review; executes on the next `process-trades` run.
    case accepted
    /// Agreed, in the commissioner's review window.
    case review
    case completed
    case rejected
    case cancelled
    case vetoed
    case expired
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "proposed": self = .proposed
        case "countered": self = .countered
        case "accepted": self = .accepted
        case "review": self = .review
        case "completed": self = .completed
        case "rejected": self = .rejected
        case "cancelled": self = .cancelled
        case "vetoed": self = .vetoed
        case "expired": self = .expired
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .proposed: "proposed"
        case .countered: "countered"
        case .accepted: "accepted"
        case .review: "review"
        case .completed: "completed"
        case .rejected: "rejected"
        case .cancelled: "cancelled"
        case .vetoed: "vetoed"
        case .expired: "expired"
        case .unknown(let value): value
        }
    }

    public var displayName: String {
        switch self {
        case .proposed, .unknown: "Proposed"
        case .countered: "Countered"
        case .accepted: "Accepted"
        case .review: "In Review"
        case .completed: "Completed"
        case .rejected: "Rejected"
        case .cancelled: "Cancelled"
        case .vetoed: "Vetoed"
        case .expired: "Expired"
        }
    }

    /// Waiting on the recipient (`proposed` or `countered`).
    public var awaitsResponse: Bool { self == .proposed || self == .countered }

    /// Still able to execute: the statuses `get_contested_source_ids` counts.
    public var isOpen: Bool { awaitsResponse || self == .accepted || self == .review }

    /// Settled one way or another (the History list).
    public var isFinal: Bool {
        switch self {
        case .completed, .rejected, .cancelled, .vetoed, .expired: true
        default: false
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decoder.singleValueContainer().decode(String.self)) }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }
}

/// What a trade item is: a roster holding or a counterpick.
public enum TradeItemSource: String, Codable, Sendable, Hashable {
    case draftPick = "draft_pick"
    case pickup
    case counterpick

    public init?(holding: HoldingSource) {
        switch holding {
        case .draft: self = .draftPick
        case .pickup: self = .pickup
        case .unknown: return nil
        }
    }
}

/// Why an offer expired (`trade_offers.expired_reason`).
public enum TradeExpiredReason: Codable, Sendable, Hashable {
    case offerWindow
    case movieReleased
    case leagueDeadline
    case seasonCompleted
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "offer_window": self = .offerWindow
        case "movie_released": self = .movieReleased
        case "league_deadline": self = .leagueDeadline
        case "season_completed": self = .seasonCompleted
        default: self = .unknown(rawValue)
        }
    }

    public init(from decoder: any Decoder) throws { self.init(rawValue: try decoder.singleValueContainer().decode(String.self)) }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .offerWindow: try c.encode("offer_window")
        case .movieReleased: try c.encode("movie_released")
        case .leagueDeadline: try c.encode("league_deadline")
        case .seasonCompleted: try c.encode("season_completed")
        case .unknown(let value): try c.encode(value)
        }
    }

    /// The card's "Expired: …" line (`expiredReasonCopy`); nil falls back to
    /// `veto_reason`.
    public func copy(anchorMovieTitle: String?) -> String? {
        switch self {
        case .offerWindow: "The offer window closed"
        case .movieReleased: anchorMovieTitle.map { "\($0) released" } ?? "Its first movie released"
        case .leagueDeadline: "The league trade deadline passed"
        case .seasonCompleted: "The season ended"
        case .unknown: nil
        }
    }
}

// MARK: - Items

/// One movie or counterpick in an offer. The server adds the title, poster and
/// release date at propose/counter time (a snapshot); clients send only the ids.
public struct TradeMovieItem: Codable, Sendable, Hashable, Identifiable {
    public var movieID: MovieID
    public var source: TradeItemSource
    /// `draft_picks.id`, `pickups.id` or `counterpicks.id`.
    public var sourceID: String
    public var title: String?
    public var posterURL: String?
    public var releaseDate: DateOnly?

    public var id: String { sourceID }
    public var displayTitle: String { title ?? "Unknown Movie" }
    public var isCounterpick: Bool { source == .counterpick }

    public init(movieID: MovieID, source: TradeItemSource, sourceID: String, title: String? = nil, posterURL: String? = nil, releaseDate: DateOnly? = nil) {
        self.movieID = movieID
        self.source = source
        self.sourceID = sourceID
        self.title = title
        self.posterURL = posterURL
        self.releaseDate = releaseDate
    }

    enum CodingKeys: String, CodingKey {
        case movieID = "movie_id"
        case source
        case sourceID = "source_id"
        case title
        case posterURL = "poster_url"
        case releaseDate = "release_date"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        movieID = try c.decode(MovieID.self, forKey: .movieID)
        source = try c.decode(TradeItemSource.self, forKey: .source)
        sourceID = try c.decode(String.self, forKey: .sourceID)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        releaseDate = try? c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)
    }

    /// Requests carry only the three ids.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(movieID, forKey: .movieID)
        try c.encode(source, forKey: .source)
        try c.encode(sourceID, forKey: .sourceID)
    }
}

/// One side of an offer: movies plus budget dollars. The wire key for the
/// budget is `faab`, a schema name; the UI always says "Budget".
public struct TradeItems: Codable, Sendable, Hashable {
    public var movies: [TradeMovieItem]
    public var budget: Int

    public init(movies: [TradeMovieItem] = [], budget: Int = 0) {
        self.movies = movies
        self.budget = budget
    }

    public var isEmpty: Bool { movies.isEmpty && budget == 0 }

    enum CodingKeys: String, CodingKey {
        case movies
        case budget = "faab"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        movies = try c.decodeIfPresent([TradeMovieItem].self, forKey: .movies) ?? []
        budget = try c.decodeInteger(forKey: .budget) ?? 0
    }
}

// MARK: - Offer

/// A `trade_offers` row as get-trades returns it. A counter overwrites the same
/// row and swaps the sides, so `initiator` is always "who proposed this
/// version" and `recipient` "who must answer it".
public struct TradeOffer: Codable, Sendable, Hashable, Identifiable {
    public struct TeamRef: Codable, Sendable, Hashable {
        public var id: TeamID
        public var name: String
        public var avatarURL: String?

        public init(id: TeamID, name: String, avatarURL: String? = nil) {
            self.id = id
            self.name = name
            self.avatarURL = avatarURL
        }

        enum CodingKeys: String, CodingKey {
            case id, name
            case avatarURL = "avatar_url"
        }
    }

    public var id: TradeOfferID
    public var leagueID: LeagueID
    public var initiatorTeamID: TeamID
    public var recipientTeamID: TeamID
    public var initiatorItems: TradeItems
    public var recipientItems: TradeItems
    public var status: TradeStatus
    public var proposedAt: Date
    public var respondedAt: Date?
    public var reviewEndsAt: Date?
    public var completedAt: Date?
    public var initiatorMessage: String?
    public var responseMessage: String?
    public var vetoReason: String?
    public var expiresAt: Date?
    /// `fixed` or `movie_release`.
    public var expiryAnchor: String?
    public var expiredReason: TradeExpiredReason?
    public var createdAt: Date
    public var initiatorTeam: TeamRef?
    public var recipientTeam: TeamRef?
    /// Items of this offer that another open offer also names.
    public var contestedSourceIDs: Set<String>
    public var anchorMovieTitle: String?

    public init(
        id: TradeOfferID, leagueID: LeagueID, initiatorTeamID: TeamID, recipientTeamID: TeamID,
        initiatorItems: TradeItems, recipientItems: TradeItems, status: TradeStatus,
        proposedAt: Date, respondedAt: Date? = nil, reviewEndsAt: Date? = nil, completedAt: Date? = nil,
        initiatorMessage: String? = nil, responseMessage: String? = nil, vetoReason: String? = nil,
        expiresAt: Date? = nil, expiryAnchor: String? = nil, expiredReason: TradeExpiredReason? = nil,
        createdAt: Date? = nil, initiatorTeam: TeamRef? = nil, recipientTeam: TeamRef? = nil,
        contestedSourceIDs: Set<String> = [], anchorMovieTitle: String? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.initiatorTeamID = initiatorTeamID
        self.recipientTeamID = recipientTeamID
        self.initiatorItems = initiatorItems
        self.recipientItems = recipientItems
        self.status = status
        self.proposedAt = proposedAt
        self.respondedAt = respondedAt
        self.reviewEndsAt = reviewEndsAt
        self.completedAt = completedAt
        self.initiatorMessage = initiatorMessage
        self.responseMessage = responseMessage
        self.vetoReason = vetoReason
        self.expiresAt = expiresAt
        self.expiryAnchor = expiryAnchor
        self.expiredReason = expiredReason
        self.createdAt = createdAt ?? proposedAt
        self.initiatorTeam = initiatorTeam
        self.recipientTeam = recipientTeam
        self.contestedSourceIDs = contestedSourceIDs
        self.anchorMovieTitle = anchorMovieTitle
    }

    enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case initiatorTeamID = "initiator_team_id"
        case recipientTeamID = "recipient_team_id"
        case initiatorItems = "initiator_items"
        case recipientItems = "recipient_items"
        case status
        case proposedAt = "proposed_at"
        case respondedAt = "responded_at"
        case reviewEndsAt = "review_ends_at"
        case completedAt = "completed_at"
        case initiatorMessage = "initiator_message"
        case responseMessage = "response_message"
        case vetoReason = "veto_reason"
        case expiresAt = "expires_at"
        case expiryAnchor = "expiry_anchor"
        case expiredReason = "expired_reason"
        case createdAt = "created_at"
        case initiatorTeam = "initiator_team"
        case recipientTeam = "recipient_team"
        case contestedSourceIDs = "contested_source_ids"
        case anchorMovieTitle = "anchor_movie_title"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(TradeOfferID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        initiatorTeamID = try c.decode(TeamID.self, forKey: .initiatorTeamID)
        recipientTeamID = try c.decode(TeamID.self, forKey: .recipientTeamID)
        initiatorItems = try c.decode(TradeItems.self, forKey: .initiatorItems, default: TradeItems())
        recipientItems = try c.decode(TradeItems.self, forKey: .recipientItems, default: TradeItems())
        status = try c.decode(TradeStatus.self, forKey: .status)
        proposedAt = try c.decode(Date.self, forKey: .proposedAt)
        respondedAt = try c.decodeIfPresent(Date.self, forKey: .respondedAt)
        reviewEndsAt = try c.decodeIfPresent(Date.self, forKey: .reviewEndsAt)
        completedAt = try c.decodeIfPresent(Date.self, forKey: .completedAt)
        initiatorMessage = try c.decodeIfPresent(String.self, forKey: .initiatorMessage)
        responseMessage = try c.decodeIfPresent(String.self, forKey: .responseMessage)
        vetoReason = try c.decodeIfPresent(String.self, forKey: .vetoReason)
        expiresAt = try c.decodeIfPresent(Date.self, forKey: .expiresAt)
        expiryAnchor = try c.decodeIfPresent(String.self, forKey: .expiryAnchor)
        expiredReason = try c.decodeIfPresent(TradeExpiredReason.self, forKey: .expiredReason)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? proposedAt
        initiatorTeam = try c.decodeIfPresent(TeamRef.self, forKey: .initiatorTeam)
        recipientTeam = try c.decodeIfPresent(TeamRef.self, forKey: .recipientTeam)
        contestedSourceIDs = Set(try c.decodeIfPresent([String].self, forKey: .contestedSourceIDs) ?? [])
        anchorMovieTitle = try c.decodeIfPresent(String.self, forKey: .anchorMovieTitle)
    }

    public var initiatorName: String { initiatorTeam?.name ?? "Another team" }
    public var recipientName: String { recipientTeam?.name ?? "Another team" }

    public func involves(_ teamID: TeamID?) -> Bool {
        guard let teamID else { return false }
        return initiatorTeamID == teamID || recipientTeamID == teamID
    }

    /// Shows the Contested badge (another open offer names one of its items).
    public var isContested: Bool { !contestedSourceIDs.isEmpty && status.isOpen }

    /// Every movie on both sides, for release-anchored expiry.
    public var allMovies: [TradeMovieItem] { initiatorItems.movies + recipientItems.movies }
}

// MARK: - Permissions and lists

/// What the viewer can do with an offer (`TradeOfferCard`'s rules, from the
/// current row).
public struct TradePermissions: Sendable, Hashable {
    public let canRespond: Bool
    public let canCancel: Bool
    public let canExtend: Bool
    public let canReview: Bool

    public init(offer: TradeOffer, myTeamID: TeamID?, isCommissioner: Bool) {
        let isInitiator = myTeamID != nil && offer.initiatorTeamID == myTeamID
        let isRecipient = myTeamID != nil && offer.recipientTeamID == myTeamID
        canRespond = isRecipient && offer.status.awaitsResponse
        canCancel = isInitiator && offer.status.awaitsResponse
        canExtend = canCancel && offer.expiresAt != nil
        canReview = isCommissioner && offer.status == .review
    }

    public var hasAny: Bool { canRespond || canCancel || canExtend || canReview }
}

/// The Trades tab's lists, in get-trades order (newest first).
public enum TradeLists {
    /// Proposed, countered or in review: the Pending and League lists.
    public static func pending(_ trades: [TradeOffer]) -> [TradeOffer] {
        trades.filter { $0.status.awaitsResponse || $0.status == .review }
    }

    /// My open offers, either side.
    public static func mine(_ trades: [TradeOffer], teamID: TeamID?) -> [TradeOffer] {
        pending(trades).filter { $0.involves(teamID) }
    }

    public static func history(_ trades: [TradeOffer]) -> [TradeOffer] {
        trades.filter(\.status.isFinal)
    }

    /// Offers waiting on my answer: the tab badge and Home banner.
    public static func needingResponse(_ trades: [TradeOffer], teamID: TeamID?) -> [TradeOffer] {
        guard let teamID else { return [] }
        return trades.filter { $0.recipientTeamID == teamID && $0.status.awaitsResponse }
    }
}

// MARK: - Tradeable movies

/// A row of the composer's checklist: a holding or an owned counterpick
/// (`fetchTradeableMovies`). Scored rows stay listed but locked.
public struct TradeableMovie: Sendable, Hashable, Identifiable {
    public var movieID: MovieID
    public var source: TradeItemSource
    public var sourceID: String
    public var title: String
    public var posterURL: String?
    public var releaseDate: DateOnly?
    /// Counterpicks: the team holding the movie it bets against.
    public var counterpickTargetTeamName: String?
    public var combinedScore: Double?
    /// For a counterpick, the inverted value.
    public var fantasyPoints: Double?

    public var id: String { sourceID }
    public var isScoreLocked: Bool { FantasyPoints.isScoreLocked(fantasyPoints) }

    public init(
        movieID: MovieID, source: TradeItemSource, sourceID: String, title: String,
        posterURL: String? = nil, releaseDate: DateOnly? = nil, counterpickTargetTeamName: String? = nil,
        combinedScore: Double? = nil, fantasyPoints: Double? = nil
    ) {
        self.movieID = movieID
        self.source = source
        self.sourceID = sourceID
        self.title = title
        self.posterURL = posterURL
        self.releaseDate = releaseDate
        self.counterpickTargetTeamName = counterpickTargetTeamName
        self.combinedScore = combinedScore
        self.fantasyPoints = fantasyPoints
    }

    /// A team's tradeable assets: holdings, then the counterpicks it owns.
    public static func list(holdings: [TeamHolding], counterpicks: [Counterpick], teamNames: [TeamID: String]) -> [TradeableMovie] {
        let fromHoldings = holdings.compactMap { holding -> TradeableMovie? in
            guard let source = TradeItemSource(holding: holding.source) else { return nil }
            return TradeableMovie(
                movieID: holding.movieID, source: source, sourceID: holding.holdingID.rawValue,
                title: holding.title, posterURL: holding.posterURL, releaseDate: holding.releaseDate,
                combinedScore: holding.combinedScore, fantasyPoints: holding.fantasyPoints
            )
        }
        let fromCounterpicks = counterpicks.map { counterpick in
            TradeableMovie(
                movieID: counterpick.movieID, source: .counterpick, sourceID: counterpick.id.rawValue,
                title: counterpick.movie?.title ?? "Unknown Movie", posterURL: counterpick.movie?.posterURL,
                releaseDate: counterpick.movie?.releaseDate,
                counterpickTargetTeamName: teamNames[counterpick.targetTeamID],
                combinedScore: counterpick.movie?.combinedScore, fantasyPoints: counterpick.fantasyPoints
            )
        }
        return fromHoldings + fromCounterpicks
    }

    public var item: TradeMovieItem {
        TradeMovieItem(movieID: movieID, source: source, sourceID: sourceID, title: title, posterURL: posterURL, releaseDate: releaseDate)
    }
}
