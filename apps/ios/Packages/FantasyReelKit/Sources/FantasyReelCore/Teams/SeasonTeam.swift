import Foundation

/// A `team_scores` row: the server's totals for one team under the season's
/// rule. `totalPoints` counts only released movies (`movie_has_released`).
public struct TeamScore: Codable, Sendable, Hashable {
    public var totalPoints: Double
    public var moviesScored: Int
    public var moviesPending: Int
    public var draftPoints: Double
    public var pickupPoints: Double
    public var counterpickPoints: Double

    public init(
        totalPoints: Double = 0,
        moviesScored: Int = 0,
        moviesPending: Int = 0,
        draftPoints: Double = 0,
        pickupPoints: Double = 0,
        counterpickPoints: Double = 0
    ) {
        self.totalPoints = totalPoints
        self.moviesScored = moviesScored
        self.moviesPending = moviesPending
        self.draftPoints = draftPoints
        self.pickupPoints = pickupPoints
        self.counterpickPoints = counterpickPoints
    }

    public enum CodingKeys: String, CodingKey {
        case totalPoints = "total_points"
        case moviesScored = "movies_scored"
        case moviesPending = "movies_pending"
        case draftPoints = "draft_points"
        case pickupPoints = "pickup_points"
        case counterpickPoints = "counterpick_points"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        totalPoints = try c.decodeNumeric(forKey: .totalPoints) ?? 0
        moviesScored = try c.decodeInteger(forKey: .moviesScored) ?? 0
        moviesPending = try c.decodeInteger(forKey: .moviesPending) ?? 0
        draftPoints = try c.decodeNumeric(forKey: .draftPoints) ?? 0
        pickupPoints = try c.decodeNumeric(forKey: .pickupPoints) ?? 0
        counterpickPoints = try c.decodeNumeric(forKey: .counterpickPoints) ?? 0
    }
}

/// A `team_budgets` row: the team's Fantasy Budget. Rows appear when the
/// season goes active; before that there is none.
public struct TeamBudget: Codable, Sendable, Hashable {
    public var remainingBudget: Int
    public var totalSpent: Int

    public init(remainingBudget: Int, totalSpent: Int = 0) {
        self.remainingBudget = remainingBudget
        self.totalSpent = totalSpent
    }

    public enum CodingKeys: String, CodingKey {
        case remainingBudget = "remaining_budget"
        case totalSpent = "total_spent"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        remainingBudget = try c.decodeInteger(forKey: .remainingBudget) ?? 0
        totalSpent = try c.decodeInteger(forKey: .totalSpent) ?? 0
    }
}

/// One team in a season with everything the league screens show beside it:
/// owner, score and budget. Decodes the web's overview/standings read,
/// `league_participants.select('*, teams (*, team_scores (*), team_budgets (*)), profiles (*)')`.
///
/// The team row can be missing (a failed insert after a join); such people
/// have nothing to rank and are dropped by `SeasonTeam.decodeList`.
public struct SeasonTeam: Sendable, Hashable, Identifiable {
    public var team: Team
    public var participantID: ParticipantID
    public var userID: UserID
    public var participantStatus: ParticipantStatus
    public var draftOrder: Int?
    public var ownerName: String?
    public var wishlistPublic: Bool
    public var score: TeamScore?
    public var budget: TeamBudget?

    public var id: TeamID { team.id }

    public init(
        team: Team,
        participantID: ParticipantID,
        userID: UserID,
        participantStatus: ParticipantStatus = .active,
        draftOrder: Int? = nil,
        ownerName: String? = nil,
        wishlistPublic: Bool = false,
        score: TeamScore? = nil,
        budget: TeamBudget? = nil
    ) {
        self.team = team
        self.participantID = participantID
        self.userID = userID
        self.participantStatus = participantStatus
        self.draftOrder = draftOrder
        self.ownerName = ownerName
        self.wishlistPublic = wishlistPublic
        self.score = score
        self.budget = budget
    }

    public var name: String { team.name }
    public var avatarURL: String? { team.avatarURL }

    /// Counted points (`team_scores.total_points`), zero before the first score.
    public var totalPoints: Double { score?.totalPoints ?? 0 }

    /// The owner as the web prints them; a deleted account reads "Former member".
    public var ownerDisplayName: String {
        let name = ownerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Former member" : name
    }

    /// Budget left for display in standings: a missing row means the full
    /// starting budget, as on the web.
    public func remainingBudget(startingBudget: Int) -> Int {
        budget?.remainingBudget ?? startingBudget
    }
}

extension SeasonTeam: Decodable {
    private enum ParticipantKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case status
        case draftOrder = "draft_order"
        case teams
        case profiles
    }

    private enum TeamEmbedKeys: String, CodingKey {
        case teamScores = "team_scores"
        case teamBudgets = "team_budgets"
    }

    private enum ProfileKeys: String, CodingKey {
        case displayName = "display_name"
        case wishlistPublic = "wishlist_public"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: ParticipantKeys.self)
        participantID = try c.decode(ParticipantID.self, forKey: .id)
        userID = try c.decode(UserID.self, forKey: .userID)
        participantStatus = try c.decode(ParticipantStatus.self, forKey: .status, default: .active)
        draftOrder = try c.decodeInteger(forKey: .draftOrder)
        team = try c.decode(Team.self, forKey: .teams)
        let teamEmbeds = try c.nestedContainer(keyedBy: TeamEmbedKeys.self, forKey: .teams)
        score = try teamEmbeds.decodeOneToOne(TeamScore.self, forKey: .teamScores)
        budget = try teamEmbeds.decodeOneToOne(TeamBudget.self, forKey: .teamBudgets)
        if c.contains(.profiles), try !c.decodeNil(forKey: .profiles) {
            let profile = try c.nestedContainer(keyedBy: ProfileKeys.self, forKey: .profiles)
            ownerName = try profile.decodeIfPresent(String.self, forKey: .displayName)
            wishlistPublic = try profile.decode(Bool.self, forKey: .wishlistPublic, default: false)
        } else {
            ownerName = nil
            wishlistPublic = false
        }
    }

    /// Decodes a participants response, skipping people whose team row is
    /// missing instead of failing the whole list.
    public static func decodeList(_ data: Data) throws -> [SeasonTeam] {
        try FRJSON.decode([Lenient<SeasonTeam>].self, from: data).compactMap(\.value)
    }
}

/// Decodes `T`, or nil when the element doesn't fit (a participant with no team).
struct Lenient<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: any Decoder) throws {
        value = try? T(from: decoder)
    }
}

extension KeyedDecodingContainer {
    /// A one-to-one PostgREST embed: an object normally, but older relationship
    /// detection can send a one-element array. Accept both, and null.
    func decodeOneToOne<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        if let value = try? decode(T.self, forKey: key) { return value }
        return try decode([T].self, forKey: key).first
    }
}

/// A `counterpicks` row with its movie embedded
/// (`counterpicks.select('*, movies (*)')`).
///
/// `fantasyPoints` is already inverted under the season's rule: it is what the
/// counterpicker scores. The embedded `movie.fantasyPoints` is the default
/// curve; use `moviePoints` for the movie's own points in this season.
public struct Counterpick: Codable, Sendable, Hashable, Identifiable {
    public var id: CounterpickID
    public var leagueID: LeagueID
    public var counterpickerTeamID: TeamID
    public var targetTeamID: TeamID
    public var movieID: MovieID
    public var draftPickID: HoldingID?
    public var pickupID: HoldingID?
    public var pickOrder: Int?
    /// `draft` or `bidding`.
    public var phase: String?
    public var fantasyPoints: Double?
    public var movie: Movie?

    public init(
        id: CounterpickID,
        leagueID: LeagueID,
        counterpickerTeamID: TeamID,
        targetTeamID: TeamID,
        movieID: MovieID,
        draftPickID: HoldingID? = nil,
        pickupID: HoldingID? = nil,
        pickOrder: Int? = nil,
        phase: String? = nil,
        fantasyPoints: Double? = nil,
        movie: Movie? = nil
    ) {
        self.id = id
        self.leagueID = leagueID
        self.counterpickerTeamID = counterpickerTeamID
        self.targetTeamID = targetTeamID
        self.movieID = movieID
        self.draftPickID = draftPickID
        self.pickupID = pickupID
        self.pickOrder = pickOrder
        self.phase = phase
        self.fantasyPoints = fantasyPoints
        self.movie = movie
    }

    public enum CodingKeys: String, CodingKey {
        case id
        case leagueID = "league_id"
        case counterpickerTeamID = "counterpicker_team_id"
        case targetTeamID = "target_team_id"
        case movieID = "movie_id"
        case draftPickID = "draft_pick_id"
        case pickupID = "pickup_id"
        case pickOrder = "pick_order"
        case phase
        case fantasyPoints = "fantasy_points"
        case movie = "movies"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(CounterpickID.self, forKey: .id)
        leagueID = try c.decode(LeagueID.self, forKey: .leagueID)
        counterpickerTeamID = try c.decode(TeamID.self, forKey: .counterpickerTeamID)
        targetTeamID = try c.decode(TeamID.self, forKey: .targetTeamID)
        movieID = try c.decode(MovieID.self, forKey: .movieID)
        draftPickID = try c.decodeIfPresent(HoldingID.self, forKey: .draftPickID)
        pickupID = try c.decodeIfPresent(HoldingID.self, forKey: .pickupID)
        pickOrder = try c.decodeInteger(forKey: .pickOrder)
        phase = try c.decodeIfPresent(String.self, forKey: .phase)
        fantasyPoints = try c.decodeNumeric(forKey: .fantasyPoints)
        movie = try c.decodeOneToOne(Movie.self, forKey: .movie)
    }

    /// The movie's own points this season (the inverse of what the
    /// counterpicker scores).
    public var moviePoints: Double? { fantasyPoints.map { $0 == 0 ? 0 : -$0 } }

    public var title: String { movie?.title ?? "Unknown movie" }
    public var releaseDate: DateOnly? { movie?.releaseDate }

    /// Scored but unreleased: shown muted, "at release".
    public func isPreReleaseScore(now: Date = Date()) -> Bool {
        FantasyPoints.isPreReleaseScore(points: fantasyPoints, releaseDate: releaseDate, now: now)
    }

    /// "in the draft" / "in bidding".
    public var phaseDescription: String { phase == "draft" ? "in the draft" : "in bidding" }
}
