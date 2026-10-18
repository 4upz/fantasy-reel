import Foundation

// League-wide rules the Home, Roster and Standings tabs share, ported from the
// web's dashboard, `roster/dropRules.ts` and `utils/seasons.ts`.

/// Competition ranking (1, 2, 2, 4) by counted points, the same order the
/// `league_standings` RPC produces. Ties compare full precision, never the
/// rounded display value.
public enum CompetitionRank {
    public struct Entry<ID: Hashable & Sendable>: Hashable, Sendable {
        public let id: ID
        public let rank: Int
        public let isTied: Bool
    }

    /// Ranks `items` by `points`, highest first. Equal points share a rank.
    public static func rank<ID: Hashable & Sendable>(_ items: [(id: ID, points: Double)]) -> [ID: Entry<ID>] {
        let sorted = items.sorted { $0.points > $1.points }
        var counts: [Double: Int] = [:]
        for item in sorted { counts[item.points, default: 0] += 1 }
        var result: [ID: Entry<ID>] = [:]
        var currentRank = 1
        for (index, item) in sorted.enumerated() {
            if index > 0, sorted[index - 1].points != item.points { currentRank = index + 1 }
            result[item.id] = Entry(id: item.id, rank: currentRank, isTied: (counts[item.points] ?? 0) > 1)
        }
        return result
    }

    /// The iOS rank label: "T-3" when tied (mockup v2), otherwise "3".
    public static func label(rank: Int, isTied: Bool) -> String {
        isTied ? "T-\(rank)" : String(rank)
    }

    /// What VoiceOver reads: "Tied for rank 3" / "Rank 3".
    public static func spokenLabel(rank: Int, isTied: Bool) -> String {
        isTied ? "Tied for rank \(rank)" : "Rank \(rank)"
    }

    /// "1st", "2nd", "T-3rd" for prose.
    public static func ordinal(_ rank: Int) -> String {
        let tens = rank % 100
        let suffix: String
        if (11...13).contains(tens) {
            suffix = "th"
        } else {
            switch rank % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(rank)\(suffix)"
    }
}

// MARK: - Champions

/// A season's champion as history shows it (`utils/seasons.ts` `Champion`).
public struct Champion: Hashable, Sendable {
    public let teamID: TeamID
    /// Nil when the team is no longer in the standings ("Team removed").
    public let teamName: String?
    public let ownerName: String?

    public init(teamID: TeamID, teamName: String?, ownerName: String?) {
        self.teamID = teamID
        self.teamName = teamName
        self.ownerName = ownerName
    }

    public var displayName: String { teamName ?? "Team removed" }
}

public enum SeasonResults {
    /// The frozen table when there is one, otherwise the live RPC rows.
    public static func standings(final: [FinalStandingRow]?, live: [StandingRow]) -> [FinalStandingRow] {
        if let final { return final }
        return live.map {
            FinalStandingRow(
                teamID: $0.teamID, teamName: $0.teamName, participantID: $0.participantID,
                userID: $0.userID, totalPoints: $0.totalPoints, rank: $0.rank, isTied: $0.isTied,
                displayName: nil
            )
        }
    }

    /// `resolveChampions`: every winner, named from the standings row (frozen
    /// name first, then the live owner map).
    public static func champions(
        winnerTeamIDs: [TeamID]?,
        standings: [FinalStandingRow],
        ownerNameByUserID: [UserID: String] = [:]
    ) -> [Champion] {
        guard let winnerTeamIDs, !winnerTeamIDs.isEmpty else { return [] }
        let byTeam = Dictionary(standings.map { ($0.teamID, $0) }, uniquingKeysWith: { first, _ in first })
        return winnerTeamIDs.map { teamID in
            guard let row = byTeam[teamID] else { return Champion(teamID: teamID, teamName: nil, ownerName: nil) }
            return Champion(
                teamID: teamID,
                teamName: row.teamName,
                ownerName: row.displayName ?? ownerNameByUserID[row.userID]
            )
        }
    }

    /// The first champion's frozen points, or nil.
    public static func championPoints(_ champions: [Champion], standings: [FinalStandingRow]) -> Double? {
        let ids = Set(champions.map(\.teamID))
        return standings.first { ids.contains($0.teamID) }?.totalPoints
    }

    /// "A", "A and B", "A, B and C", "A, B and 2 others".
    public static func joinNames(_ names: [String]) -> String {
        switch names.count {
        case 0: return ""
        case 1: return names[0]
        case 2: return "\(names[0]) and \(names[1])"
        case 3: return "\(names[0]), \(names[1]) and \(names[2])"
        default: return "\(names[0]), \(names[1]) and \(names.count - 2) others"
        }
    }
}

// MARK: - Drops

/// Why a held movie can't be dropped right now (`dropRules.ts`). Checked in
/// the `drop-movie` Edge Function's order, so the reason shown is the one the
/// server would give first.
public enum DropBlocker: Hashable, Sendable {
    case released
    case leagueInactive
    case counterpicked
    case contested
    case noDropsLeft

    public struct Context: Sendable {
        public var leagueStatus: LeagueStatus
        public var counterpicksBlockDrops: Bool
        /// Movies with an open (active/outbid) counterpick bid in the league.
        public var contestedMovieIDs: Set<MovieID>
        public var dropsRemaining: Int

        public init(leagueStatus: LeagueStatus, counterpicksBlockDrops: Bool, contestedMovieIDs: Set<MovieID>, dropsRemaining: Int) {
            self.leagueStatus = leagueStatus
            self.counterpicksBlockDrops = counterpicksBlockDrops
            self.contestedMovieIDs = contestedMovieIDs
            self.dropsRemaining = dropsRemaining
        }
    }

    /// The first refusal, or nil when the drop would go through. A movie can
    /// still be dropped on its release day (`release_date < today`, UTC).
    public static func find(
        movieID: MovieID,
        releaseDate: DateOnly?,
        counterpickedByTeamID: TeamID?,
        context: Context,
        now: Date = Date()
    ) -> DropBlocker? {
        if let releaseDate, releaseDate < DateOnly.today(now: now) { return .released }
        if context.leagueStatus != .active { return .leagueInactive }
        if context.counterpicksBlockDrops {
            if counterpickedByTeamID != nil { return .counterpicked }
            if context.contestedMovieIDs.contains(movieID) { return .contested }
        }
        if context.dropsRemaining <= 0 { return .noDropsLeft }
        return nil
    }

    public static func find(_ holding: TeamHolding, context: Context, now: Date = Date()) -> DropBlocker? {
        find(
            movieID: holding.movieID, releaseDate: holding.releaseDate,
            counterpickedByTeamID: holding.counterpickedByTeamID, context: context, now: now
        )
    }

    /// The player-facing explanation. Never names who holds an open
    /// counterpick bid: counterpick auctions mustn't leak through the roster.
    public func explanation(
        movieTitle: String,
        dropLimit: Int,
        leagueStatus: LeagueStatus,
        counterpickerName: String?
    ) -> (headline: String, detail: String) {
        switch self {
        case .released:
            return (
                "\(movieTitle) has already opened.",
                "Once a movie is out, its score is locked in and it stays on your roster for the rest of the season."
            )
        case .leagueInactive:
            if leagueStatus == .completed {
                return ("This league has finished.", "Rosters are final, so nothing can be dropped.")
            }
            return (
                "The season has not started yet.",
                "Drops open once the league goes active. Until then your roster is fixed."
            )
        case .counterpicked:
            return (
                counterpickerName.map { "\($0) counterpicked \(movieTitle)." } ?? "\(movieTitle) has been counterpicked.",
                "Your league does not allow dropping a movie another team is scoring against, so it stays on your roster for the rest of the season."
            )
        case .contested:
            return (
                "Another team has an open counterpick bid on \(movieTitle).",
                "It is locked while the auction runs. If the auction ends without anyone claiming it, you can drop it then."
            )
        case .noDropsLeft:
            return (
                "You have used all \(dropLimit) of your drops.",
                "Drops do not reset, so your roster is set for the rest of the season."
            )
        }
    }
}

// MARK: - Around the league

/// One upcoming release on the overview's "Around the league" board.
public struct LeagueRelease: Hashable, Sendable, Identifiable {
    public let movieID: MovieID
    public let tmdbID: TMDbID
    public let title: String
    public let posterURL: String?
    public let releaseDate: DateOnly
    public let teamID: TeamID
    public let teamName: String
    public let ownerName: String?
    public let isMine: Bool

    public var id: MovieID { movieID }

    /// "Nolan's Notebook", or "Nolan's Notebook · Bob Nolan".
    public var holderLine: String {
        guard let ownerName, !ownerName.isEmpty, ownerName != teamName else { return teamName }
        return "\(teamName) · \(ownerName)"
    }
}

public enum LeagueOverview {
    /// `buildLeagueUpcoming`: every held movie releasing today or later, one row
    /// per movie (the draft holding wins), by date then title.
    public static func upcomingReleases(
        holdings: [TeamHolding],
        teams: [SeasonTeam],
        myTeamID: TeamID?,
        now: Date = Date()
    ) -> [LeagueRelease] {
        let today = DateOnly.today(now: now)
        let teamByID = Dictionary(teams.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let ordered = holdings.sorted { lhs, rhs in
            (lhs.source == .draft ? 0 : 1) < (rhs.source == .draft ? 0 : 1)
        }
        var seen: Set<MovieID> = []
        var releases: [LeagueRelease] = []
        for holding in ordered {
            guard let date = holding.releaseDate, date >= today, !seen.contains(holding.movieID) else { continue }
            seen.insert(holding.movieID)
            let team = teamByID[holding.teamID]
            releases.append(LeagueRelease(
                movieID: holding.movieID,
                tmdbID: holding.tmdbID,
                title: holding.title,
                posterURL: holding.posterURL,
                releaseDate: date,
                teamID: holding.teamID,
                teamName: team?.team.name ?? (holding.teamName.isEmpty ? "Former team" : holding.teamName),
                ownerName: team?.ownerName,
                isMine: holding.teamID == myTeamID
            ))
        }
        return releases.sorted { lhs, rhs in
            if lhs.releaseDate != rhs.releaseDate { return lhs.releaseDate < rhs.releaseDate }
            return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
        }
    }

    /// My movies for the Home timeline: unreleased first by date (no date
    /// last), then released ones by points, highest first.
    public static func timeline(_ holdings: [TeamHolding], now: Date = Date()) -> [TeamHolding] {
        let unreleased = holdings.filter { !DateOnly.hasReleased($0.releaseDate, now: now) }
            .sorted { lhs, rhs in
                switch (lhs.releaseDate, rhs.releaseDate) {
                case let (l?, r?) where l != r: return l < r
                case (.some, nil): return true
                case (nil, .some): return false
                default: return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
                }
            }
        let released = holdings.filter { DateOnly.hasReleased($0.releaseDate, now: now) }
            .sorted { ($0.fantasyPoints ?? -.infinity) > ($1.fantasyPoints ?? -.infinity) }
        return unreleased + released
    }

    /// The shared-wishlist banner's count: other active members sharing.
    public static func sharedWishlistCount(teams: [SeasonTeam], me: UserID) -> Int {
        teams.filter { $0.userID != me && $0.wishlistPublic && $0.participantStatus == .active }.count
    }
}

// MARK: - Standings summary

public struct StandingsSummary: Hashable, Sendable {
    public let movies: Int
    public let scored: Int
    public let pending: Int

    /// League-wide, counterpicks included (a counterpicked movie counts twice,
    /// as on the web). Scored means an RT score and released (UTC).
    public static func make(holdings: [TeamHolding], counterpicks: [Counterpick], now: Date = Date()) -> StandingsSummary {
        var total = 0
        var scored = 0
        for holding in holdings {
            total += 1
            if holding.combinedScore != nil, DateOnly.hasReleased(holding.releaseDate, now: now) { scored += 1 }
        }
        for counterpick in counterpicks {
            total += 1
            if counterpick.movie?.combinedScore != nil, DateOnly.hasReleased(counterpick.releaseDate, now: now) { scored += 1 }
        }
        return StandingsSummary(movies: total, scored: scored, pending: total - scored)
    }
}
