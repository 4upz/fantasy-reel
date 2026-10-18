import Foundation

/// Projected standings (Beta, F-19), ported from the web's
/// `utils/projectedStandings.ts`: what each team has earned, plus what its
/// movies still to come are most likely worth, ranked.
///
/// A view, never a record. Real rank and champions come from
/// `league_standings` alone; nothing here feeds back into them.
public enum ProjectedStandings {
    public struct Team: Sendable, Hashable {
        public var teamID: TeamID
        public var teamName: String
        /// Points that count today, as `league_standings` reports them.
        public var earned: Double
        /// The real rank, kept so the projected table can say how far a team moves.
        public var rank: Int

        public init(teamID: TeamID, teamName: String, earned: Double, rank: Int) {
            self.teamID = teamID
            self.teamName = teamName
            self.earned = earned
            self.rank = rank
        }
    }

    /// A movie a team holds, or a counterpick it owns. Points are already under
    /// this season's rule (and inverted on a counterpick), as `team_holdings`
    /// and `counterpicks` carry them.
    public struct Source: Sendable, Hashable {
        public var teamID: TeamID
        public var tmdbID: TMDbID
        public var title: String
        public var releaseDate: DateOnly?
        public var posterURL: String?
        public var fantasyPoints: Double?
        public var counterpick: Bool

        public init(
            teamID: TeamID, tmdbID: TMDbID, title: String, releaseDate: DateOnly?,
            posterURL: String? = nil, fantasyPoints: Double?, counterpick: Bool = false
        ) {
            self.teamID = teamID
            self.tmdbID = tmdbID
            self.title = title
            self.releaseDate = releaseDate
            self.posterURL = posterURL
            self.fantasyPoints = fantasyPoints
            self.counterpick = counterpick
        }
    }

    public enum Basis: Sendable, Hashable {
        /// Released and scored: already inside `earned`.
        case earned
        /// Not counted yet; the projection's expected points stand in.
        case projection
        /// Not counted yet, no projection, but a pre-release score that will count at release.
        case preRelease
        /// Not counted yet and nothing to go on: adds nothing.
        case none
    }

    public struct Leg: Sendable, Hashable, Identifiable {
        public var tmdbID: TMDbID
        public var title: String
        public var releaseDate: DateOnly?
        public var posterURL: String?
        public var counterpick: Bool
        public var basis: Basis
        /// Points for this team: the real ones when earned, otherwise the most likely ones.
        public var points: Double
        public var projection: MovieProjection?

        public var id: String { "\(counterpick ? "cp" : "h")-\(tmdbID.rawValue)" }
    }

    public struct Standing: Sendable, Hashable, Identifiable {
        public var teamID: TeamID
        public var teamName: String
        public var earned: Double
        /// earned + the most likely points of everything not counted yet.
        public var projected: Double
        /// Competition rank on `projected` (1, 2, 2, 4).
        public var projectedRank: Int
        public var isTied: Bool
        public var currentRank: Int
        /// Places gained against the real rank: positive is up.
        public var rankChange: Int
        /// Movies whose points do not count yet.
        public var remaining: Int
        /// Standard deviation of the projected total, in points, from the 80% ranges.
        public var uncertainty: Double
        /// The gap to a neighbour is small next to the uncertainty in what's left.
        public var tossUp: Bool
        public var legs: [Leg]

        public var id: TeamID { teamID }

        /// Earned legs, then the rest by release date (unknown dates last), as
        /// "How it adds up" lists them.
        public var earnedLegs: [Leg] { legs.filter { $0.basis == .earned } }
        public var pendingLegs: [Leg] {
            legs.filter { $0.basis != .earned }.sorted {
                ($0.releaseDate?.isoString ?? "9999") < ($1.releaseDate?.isoString ?? "9999")
            }
        }
    }

    /// A normal distribution's 80% interval spans ±1.2816 standard deviations.
    static let z80 = 1.2816
    /// The gap to a neighbour, in combined standard deviations, under which the
    /// order is close to a coin flip (about a one-in-three chance it flips).
    static let tossUpGap = 0.5

    /// Totals equal to a tenth of a point are tied: below that is float noise.
    private static func roundTenth(_ value: Double) -> Double { JSMath.round(value * 10) / 10 }

    static func leg(_ source: Source, projections: [TMDbID: MovieProjection], now: Date) -> Leg {
        var leg = Leg(
            tmdbID: source.tmdbID, title: source.title, releaseDate: source.releaseDate,
            posterURL: source.posterURL, counterpick: source.counterpick,
            basis: .none, points: 0, projection: nil
        )
        // Counted exactly as team_scores counts it: released, with a score.
        if let points = source.fantasyPoints, DateOnly.hasReleased(source.releaseDate, now: now) {
            leg.basis = .earned
            leg.points = points
            return leg
        }
        let projection = projections[source.tmdbID]
        leg.projection = projection
        if let projection, !projection.insufficientHistory {
            leg.basis = .projection
            leg.points = ProjectionText.projectedPoints(projection, counterpick: source.counterpick)
        } else if let points = source.fantasyPoints {
            // Already inverted on a counterpick row.
            leg.basis = .preRelease
            leg.points = points
        }
        return leg
    }

    /// Points-space variance of one projected leg, read off its 80% Tomatometer range.
    static func variance(_ leg: Leg, doublePointsOver90: Bool) -> Double {
        guard leg.basis == .projection, let projection = leg.projection else { return 0 }
        let range = projection.range80Bounds
        let spread = FantasyPoints.fantasyPointsForTomatometer(range.high, doublePointsOver90: doublePointsOver90)
            - FantasyPoints.fantasyPointsForTomatometer(range.low, doublePointsOver90: doublePointsOver90)
        let sd = abs(spread) / (2 * z80)
        return sd * sd
    }

    /// Ranks every team by earned points plus the most likely points of what
    /// it still has to come: its own unreleased or unscored movies at their
    /// expected points, and its counterpicks at the negation of their target's.
    public static func compute(
        teams: [Team],
        sources: [Source],
        projections: [TMDbID: MovieProjection],
        doublePointsOver90: Bool = false,
        now: Date = Date()
    ) -> [Standing] {
        var legsByTeam: [TeamID: [Leg]] = [:]
        for source in sources {
            legsByTeam[source.teamID, default: []].append(leg(source, projections: projections, now: now))
        }

        let rows = teams.map { team -> Standing in
            let legs = legsByTeam[team.teamID] ?? []
            let pending = legs.filter { $0.basis != .earned }
            let projected = roundTenth(team.earned + pending.reduce(0) { $0 + $1.points })
            let variance = pending.reduce(0) { $0 + Self.variance($1, doublePointsOver90: doublePointsOver90) }
            return Standing(
                teamID: team.teamID, teamName: team.teamName, earned: team.earned, projected: projected,
                projectedRank: 0, isTied: false, currentRank: team.rank, rankChange: 0,
                remaining: pending.count, uncertainty: variance.squareRoot(), tossUp: false, legs: legs
            )
        }

        let ordered = rows.sorted { a, b in
            if a.projected != b.projected { return a.projected > b.projected }
            if a.currentRank != b.currentRank { return a.currentRank < b.currentRank }
            return a.teamName.localizedCompare(b.teamName) == .orderedAscending
        }

        return ordered.enumerated().map { index, row in
            var row = row
            row.projectedRank = (ordered.firstIndex { $0.projected == row.projected } ?? index) + 1
            row.isTied = ordered.contains { $0.teamID != row.teamID && $0.projected == row.projected }
            row.rankChange = row.currentRank - row.projectedRank
            let neighbours = [index - 1, index + 1].filter(ordered.indices.contains).map { ordered[$0] }
            row.tossUp = neighbours.contains { neighbour in
                let spread = (row.uncertainty * row.uncertainty + neighbour.uncertainty * neighbour.uncertainty).squareRoot()
                return spread > 0 && abs(row.projected - neighbour.projected) < tossUpGap * spread
            }
            return row
        }
    }

    /// Whether a projected table says anything the real one doesn't: some leg rests on a projection.
    public static func hasProjectedLegs(_ standings: [Standing]) -> Bool {
        standings.contains { $0.legs.contains { $0.basis == .projection } }
    }

    /// Distinct movies not yet counted across the table (own holdings only),
    /// for "N movies still to release".
    public static func moviesToRelease(_ standings: [Standing]) -> Int {
        Set(standings.flatMap { $0.legs.filter { $0.basis != .earned && !$0.counterpick }.map(\.tmdbID) }).count
    }

    /// "T-2nd" / "2nd".
    public static func positionLabel(_ standing: Standing) -> String {
        (standing.isTied ? "T-" : "") + CompetitionRank.ordinal(standing.projectedRank)
    }

    /// "Tied for 2nd" / "2nd".
    public static func spokenPosition(_ standing: Standing) -> String {
        (standing.isTied ? "Tied for " : "") + CompetitionRank.ordinal(standing.projectedRank)
    }
}
