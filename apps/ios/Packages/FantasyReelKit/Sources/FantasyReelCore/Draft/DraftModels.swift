import Foundation

// Wire models for the draft room (F-08, F-09). They mirror the web's reads in
// `useDraftState`: every draft pick with its movie and every counterpick with
// its movie. Participants come from the shared `LeagueMember` read.

/// A `draft_picks` row with its movie (`select('*, movies(*)')`). Dropped picks
/// stay in the list: the board is the record of the draft as it happened.
public struct DraftPickRecord: Codable, Sendable, Hashable, Identifiable {
    /// The row id, which is also the holding id `team_holdings` reports.
    public var id: HoldingID
    public var leagueID: LeagueID
    public var teamID: TeamID
    public var movieID: MovieID
    public var round: Int
    /// One-based position within the round.
    public var pickNumber: Int
    public var pickedAt: Date?
    public var droppedAt: Date?
    public var counterpickedByTeamID: TeamID?
    public var movie: Movie?

    public init(
        id: HoldingID,
        leagueID: LeagueID,
        teamID: TeamID,
        movieID: MovieID,
        round: Int,
        pickNumber: Int,
        pickedAt: Date? = nil,
        droppedAt: Date? = nil,
        counterpickedByTeamID: TeamID? = nil,
        movie: Movie? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.teamID = teamID
        self.movieID = movieID
        self.round = round
        self.pickNumber = pickNumber
        self.pickedAt = pickedAt
        self.droppedAt = droppedAt
        self.counterpickedByTeamID = counterpickedByTeamID
        self.movie = movie
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case teamID = "team_id"
        case movieID = "movie_id"
        case round
        case pickNumber = "pick_number"
        case pickedAt = "picked_at"
        case droppedAt = "dropped_at"
        case counterpickedByTeamID = "counterpicked_by_team_id"
        case movie = "movies"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(HoldingID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        teamID = try c.decode(TeamID.self, forKey: .teamID)
        movieID = try c.decode(MovieID.self, forKey: .movieID)
        round = try c.decodeInteger(forKey: .round) ?? 1
        pickNumber = try c.decodeInteger(forKey: .pickNumber) ?? 1
        pickedAt = try c.decodeIfPresent(Date.self, forKey: .pickedAt)
        droppedAt = try c.decodeIfPresent(Date.self, forKey: .droppedAt)
        counterpickedByTeamID = try c.decodeIfPresent(TeamID.self, forKey: .counterpickedByTeamID)
        movie = try c.decodeToOne(Movie.self, forKey: .movie)
    }

    /// The absolute one-based slot, the `expected_pick` the server checks.
    public func overallPick(teamCount: Int) -> Int {
        (round - 1) * max(teamCount, 1) + pickNumber
    }
}

/// Which round produced a counterpick (`counterpicks.phase`).
public enum CounterpickPhase: Codable, Sendable, Hashable {
    /// The draft's own counterpick round.
    case draft
    /// Won at auction during the season.
    case bidding
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "draft": self = .draft
        case "bidding": self = .bidding
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .draft: "draft"
        case .bidding: "bidding"
        case .unknown(let value): value
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

/// A `counterpicks` row with its movie (`select('*, movies(*)')`): a bet
/// against another team's movie that scores the inverse of its points. It is
/// its own asset, not a roster holding, and uses no movie slot.
public struct DraftCounterpick: Codable, Sendable, Hashable, Identifiable {
    public var id: CounterpickID
    public var leagueID: LeagueID
    public var counterpickerTeamID: TeamID
    public var targetTeamID: TeamID
    public var movieID: MovieID
    /// The absolute one-based slot within its phase.
    public var pickOrder: Int
    public var phase: CounterpickPhase
    /// Already inverted and with the season's rule applied.
    public var fantasyPoints: Double?
    public var createdAt: Date?
    public var movie: Movie?

    public init(
        id: CounterpickID,
        leagueID: LeagueID,
        counterpickerTeamID: TeamID,
        targetTeamID: TeamID,
        movieID: MovieID,
        pickOrder: Int,
        phase: CounterpickPhase = .draft,
        fantasyPoints: Double? = nil,
        createdAt: Date? = nil,
        movie: Movie? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.counterpickerTeamID = counterpickerTeamID
        self.targetTeamID = targetTeamID
        self.movieID = movieID
        self.pickOrder = pickOrder
        self.phase = phase
        self.fantasyPoints = fantasyPoints
        self.createdAt = createdAt
        self.movie = movie
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case counterpickerTeamID = "counterpicker_team_id"
        case targetTeamID = "target_team_id"
        case movieID = "movie_id"
        case pickOrder = "pick_order"
        case phase
        case fantasyPoints = "fantasy_points"
        case createdAt = "created_at"
        case movie = "movies"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(CounterpickID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        counterpickerTeamID = try c.decode(TeamID.self, forKey: .counterpickerTeamID)
        targetTeamID = try c.decode(TeamID.self, forKey: .targetTeamID)
        movieID = try c.decode(MovieID.self, forKey: .movieID)
        pickOrder = try c.decodeInteger(forKey: .pickOrder) ?? 0
        phase = try c.decode(CounterpickPhase.self, forKey: .phase, default: .draft)
        fantasyPoints = try c.decodeNumeric(forKey: .fantasyPoints)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        movie = try c.decodeToOne(Movie.self, forKey: .movie)
    }
}

/// A row of `get_counterpick_options(p_league_id, p_team_id)`: an opponent's
/// unreleased, not-yet-counterpicked movie this team may counterpick.
public struct CounterpickOption: Codable, Sendable, Hashable, Identifiable {
    public var movieID: MovieID
    public var title: String
    public var posterURL: String?
    public var releaseDate: DateOnly?
    public var ownerTeamID: TeamID
    public var ownerTeamName: String
    /// The holding's points under the season's rule, before inversion; nil
    /// when unscored. A counterpick would score the negation.
    public var fantasyPoints: Double?
    public var source: HoldingSource
    public var draftPickID: HoldingID?
    public var pickupID: HoldingID?

    public var id: MovieID { movieID }

    public init(
        movieID: MovieID,
        title: String,
        posterURL: String? = nil,
        releaseDate: DateOnly? = nil,
        ownerTeamID: TeamID,
        ownerTeamName: String,
        fantasyPoints: Double? = nil,
        source: HoldingSource = .draft,
        draftPickID: HoldingID? = nil,
        pickupID: HoldingID? = nil
    ) {
        self.movieID = movieID
        self.title = title
        self.posterURL = posterURL
        self.releaseDate = releaseDate
        self.ownerTeamID = ownerTeamID
        self.ownerTeamName = ownerTeamName
        self.fantasyPoints = fantasyPoints
        self.source = source
        self.draftPickID = draftPickID
        self.pickupID = pickupID
    }

    public enum CodingKeys: String, CodingKey {
        case movieID = "movie_id"
        case title = "movie_title"
        case posterURL = "poster_url"
        case releaseDate = "release_date"
        case ownerTeamID = "owner_team_id"
        case ownerTeamName = "owner_team_name"
        case fantasyPoints = "fantasy_points"
        case source
        case draftPickID = "draft_pick_id"
        case pickupID = "pickup_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        movieID = try c.decode(MovieID.self, forKey: .movieID)
        title = try c.decode(String.self, forKey: .title)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        releaseDate = try c.decodeIfPresent(DateOnly.self, forKey: .releaseDate)
        ownerTeamID = try c.decode(TeamID.self, forKey: .ownerTeamID)
        ownerTeamName = try c.decode(String.self, forKey: .ownerTeamName)
        fantasyPoints = try c.decodeNumeric(forKey: .fantasyPoints)
        source = try c.decode(HoldingSource.self, forKey: .source, default: .draft)
        draftPickID = try c.decodeIfPresent(HoldingID.self, forKey: .draftPickID)
        pickupID = try c.decodeIfPresent(HoldingID.self, forKey: .pickupID)
    }
}

extension KeyedDecodingContainer {
    /// A to-one PostgREST embed. PostgREST renders it as an object, but as a
    /// one-element array when it can't prove the relationship is to-one; accept
    /// both, and nil for null or an empty array.
    func decodeToOne<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        if let array = try? decode([T].self, forKey: key) { return array.first }
        return try decode(T.self, forKey: key)
    }
}
