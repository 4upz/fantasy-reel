import Foundation

/// A `movies` row.
///
/// `combinedScore` is the Rotten Tomatoes Tomatometer (legacy name) and the only
/// scoring input. `fantasyPoints` is the **default** curve; in a league context
/// apply the season's rule with `FantasyPoints.leagueFantasyPoints`. Nil means
/// pending, never zero.
public struct Movie: Codable, Sendable, Hashable, Identifiable {
    public var id: MovieID
    public var tmdbID: TMDbID
    public var imdbID: String?
    public var title: String
    public var overview: String?
    public var releaseDate: DateOnly?
    public var posterURL: String?
    public var backdropURL: String?
    public var popularity: Double?
    public var voteAverage: Double?
    public var voteCount: Int?
    public var status: MovieStatus
    public var combinedScore: Double?
    public var fantasyPoints: Double?
    public var scoresUpdatedAt: Date?
    public var lastSyncedAt: Date?
    public var createdAt: Date?
    public var updatedAt: Date?

    public init(
        id: MovieID,
        tmdbID: TMDbID,
        imdbID: String? = nil,
        title: String,
        overview: String? = nil,
        releaseDate: DateOnly? = nil,
        posterURL: String? = nil,
        backdropURL: String? = nil,
        popularity: Double? = nil,
        voteAverage: Double? = nil,
        voteCount: Int? = nil,
        status: MovieStatus = .upcoming,
        combinedScore: Double? = nil,
        fantasyPoints: Double? = nil,
        scoresUpdatedAt: Date? = nil,
        lastSyncedAt: Date? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.tmdbID = tmdbID
        self.imdbID = imdbID
        self.title = title
        self.overview = overview
        self.releaseDate = releaseDate
        self.posterURL = posterURL
        self.backdropURL = backdropURL
        self.popularity = popularity
        self.voteAverage = voteAverage
        self.voteCount = voteCount
        self.status = status
        self.combinedScore = combinedScore
        self.fantasyPoints = fantasyPoints
        self.scoresUpdatedAt = scoresUpdatedAt
        self.lastSyncedAt = lastSyncedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case tmdbID = "tmdb_id"
        case imdbID = "imdb_id"
        case title
        case overview
        case releaseDate = "release_date"
        case posterURL = "poster_url"
        case backdropURL = "backdrop_url"
        case popularity
        case voteAverage = "vote_average"
        case voteCount = "vote_count"
        case status
        case combinedScore = "combined_score"
        case fantasyPoints = "fantasy_points"
        case scoresUpdatedAt = "scores_updated_at"
        case lastSyncedAt = "last_synced_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(MovieID.self, forKey: .id)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        imdbID = try c.decodeIfPresent(String.self, forKey: .imdbID)
        title = try c.decode(String.self, forKey: .title)
        overview = try c.decodeIfPresent(String.self, forKey: .overview)
        releaseDate = try c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        backdropURL = try c.decodeIfPresent(String.self, forKey: .backdropURL)
        popularity = try c.decodeNumeric(forKey: .popularity)
        voteAverage = try c.decodeNumeric(forKey: .voteAverage)
        voteCount = try c.decodeInteger(forKey: .voteCount)
        status = try c.decode(MovieStatus.self, forKey: .status, default: .upcoming)
        combinedScore = try c.decodeNumeric(forKey: .combinedScore)
        fantasyPoints = try c.decodeNumeric(forKey: .fantasyPoints)
        scoresUpdatedAt = try c.decodeIfPresent(Date.self, forKey: .scoresUpdatedAt)
        lastSyncedAt = try c.decodeIfPresent(Date.self, forKey: .lastSyncedAt)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
    }
}

/// One movie a team holds now: a row of the `team_holdings` view, the only read
/// surface for active rosters (it unions `draft_picks` and `pickups` and drops
/// dropped rows itself).
///
/// PostgREST can't embed through the UNION view, so team and movie columns are
/// flat. `fantasyPoints` already applies the season's 90+ rule; don't apply it
/// again.
public struct TeamHolding: Codable, Sendable, Hashable, Identifiable {
    /// The `draft_picks` / `pickups` row id: what drop-movie and trades take.
    public var holdingID: HoldingID
    public var source: HoldingSource
    public var leagueID: LeagueID
    public var teamID: TeamID
    public var movieID: MovieID
    public var acquiredAt: Date?
    public var counterpickedByTeamID: TeamID?
    public var counterpickedByName: String?
    /// Draft holdings only.
    public var round: Int?
    public var pickNumber: Int?
    /// Pickup holdings only.
    public var bidID: BidID?
    public var amountPaid: Int?
    public var teamName: String
    public var tmdbID: TMDbID
    public var title: String
    public var releaseDate: DateOnly?
    public var posterURL: String?
    public var movieStatus: MovieStatus
    public var imdbID: String?
    public var combinedScore: Double?
    public var fantasyPoints: Double?
    public var overview: String?
    public var backdropURL: String?
    public var voteAverage: Double?
    public var voteCount: Int?
    public var popularity: Double?
    public var scoringBonuses: JSONValue?
    public var scoresUpdatedAt: Date?

    public var id: HoldingID { holdingID }

    public init(
        holdingID: HoldingID,
        source: HoldingSource,
        leagueID: LeagueID,
        teamID: TeamID,
        movieID: MovieID,
        acquiredAt: Date? = nil,
        counterpickedByTeamID: TeamID? = nil,
        counterpickedByName: String? = nil,
        round: Int? = nil,
        pickNumber: Int? = nil,
        bidID: BidID? = nil,
        amountPaid: Int? = nil,
        teamName: String,
        tmdbID: TMDbID,
        title: String,
        releaseDate: DateOnly? = nil,
        posterURL: String? = nil,
        movieStatus: MovieStatus = .upcoming,
        imdbID: String? = nil,
        combinedScore: Double? = nil,
        fantasyPoints: Double? = nil,
        overview: String? = nil,
        backdropURL: String? = nil,
        voteAverage: Double? = nil,
        voteCount: Int? = nil,
        popularity: Double? = nil,
        scoringBonuses: JSONValue? = nil,
        scoresUpdatedAt: Date? = nil
    ) {
        self.holdingID = holdingID
        self.source = source
        self.leagueID = leagueID
        self.teamID = teamID
        self.movieID = movieID
        self.acquiredAt = acquiredAt
        self.counterpickedByTeamID = counterpickedByTeamID
        self.counterpickedByName = counterpickedByName
        self.round = round
        self.pickNumber = pickNumber
        self.bidID = bidID
        self.amountPaid = amountPaid
        self.teamName = teamName
        self.tmdbID = tmdbID
        self.title = title
        self.releaseDate = releaseDate
        self.posterURL = posterURL
        self.movieStatus = movieStatus
        self.imdbID = imdbID
        self.combinedScore = combinedScore
        self.fantasyPoints = fantasyPoints
        self.overview = overview
        self.backdropURL = backdropURL
        self.voteAverage = voteAverage
        self.voteCount = voteCount
        self.popularity = popularity
        self.scoringBonuses = scoringBonuses
        self.scoresUpdatedAt = scoresUpdatedAt
    }

    public enum CodingKeys: String, CodingKey {
        case holdingID = "holding_id"
        case source
        case leagueID = "league_id"
        case teamID = "team_id"
        case movieID = "movie_id"
        case acquiredAt = "acquired_at"
        case counterpickedByTeamID = "counterpicked_by_team_id"
        case counterpickedByName = "counterpicked_by_name"
        case round
        case pickNumber = "pick_number"
        case bidID = "bid_id"
        case amountPaid = "amount_paid"
        case teamName = "team_name"
        case tmdbID = "tmdb_id"
        case title
        case releaseDate = "release_date"
        case posterURL = "poster_url"
        case movieStatus = "movie_status"
        case imdbID = "imdb_id"
        case combinedScore = "combined_score"
        case fantasyPoints = "fantasy_points"
        case overview
        case backdropURL = "backdrop_url"
        case voteAverage = "vote_average"
        case voteCount = "vote_count"
        case popularity
        case scoringBonuses = "scoring_bonuses"
        case scoresUpdatedAt = "scores_updated_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        holdingID = try c.decode(HoldingID.self, forKey: .holdingID)
        source = try c.decode(HoldingSource.self, forKey: .source)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        teamID = try c.decode(TeamID.self, forKey: .teamID)
        movieID = try c.decode(MovieID.self, forKey: .movieID)
        acquiredAt = try c.decodeIfPresent(Date.self, forKey: .acquiredAt)
        counterpickedByTeamID = try c.decodeIfPresent(TeamID.self, forKey: .counterpickedByTeamID)
        counterpickedByName = try c.decodeIfPresent(String.self, forKey: .counterpickedByName)
        round = try c.decodeInteger(forKey: .round)
        pickNumber = try c.decodeInteger(forKey: .pickNumber)
        bidID = try c.decodeIfPresent(BidID.self, forKey: .bidID)
        amountPaid = try c.decodeInteger(forKey: .amountPaid)
        teamName = try c.decode(String.self, forKey: .teamName)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        title = try c.decode(String.self, forKey: .title)
        releaseDate = try c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        movieStatus = try c.decode(MovieStatus.self, forKey: .movieStatus, default: .upcoming)
        imdbID = try c.decodeIfPresent(String.self, forKey: .imdbID)
        combinedScore = try c.decodeNumeric(forKey: .combinedScore)
        fantasyPoints = try c.decodeNumeric(forKey: .fantasyPoints)
        overview = try c.decodeIfPresent(String.self, forKey: .overview)
        backdropURL = try c.decodeIfPresent(String.self, forKey: .backdropURL)
        voteAverage = try c.decodeNumeric(forKey: .voteAverage)
        voteCount = try c.decodeInteger(forKey: .voteCount)
        popularity = try c.decodeNumeric(forKey: .popularity)
        scoringBonuses = try c.decodeIfPresent(JSONValue.self, forKey: .scoringBonuses)
        scoresUpdatedAt = try c.decodeIfPresent(Date.self, forKey: .scoresUpdatedAt)
    }

    public var isCounterpicked: Bool { counterpickedByTeamID != nil }

    /// Scored but not yet released: shown muted, "at release", and not counted
    /// toward team totals yet.
    public func isPreReleaseScore(now: Date = Date()) -> Bool {
        FantasyPoints.isPreReleaseScore(points: fantasyPoints, releaseDate: releaseDate, now: now)
    }

    /// Scored movies no longer change hands (bids and trades refuse them).
    public var isScoreLocked: Bool { FantasyPoints.isScoreLocked(fantasyPoints) }
}
