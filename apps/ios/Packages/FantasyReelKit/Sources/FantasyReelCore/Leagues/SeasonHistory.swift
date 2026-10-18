import Foundation

/// Champions and results across a series' seasons (F-16), read from the frozen
/// `final_standings` snapshots, never recomputed: a champion who later left
/// keeps their title.
public enum SeasonHistory {
    /// Every rank-1 row of a completed season (co-champions share the title).
    /// Falls back to `winner_team_ids` matched against the snapshot when an
    /// older row's ranks are missing.
    public static func champions(of season: League) -> [FinalStandingRow] {
        guard season.isCompleted, let table = season.finalStandings else { return [] }
        let byRank = table.filter { $0.rank == 1 }
        if !byRank.isEmpty { return byRank }
        let winners = Set(season.winnerTeamIDs ?? [])
        return table.filter { winners.contains($0.teamID) }
    }

    /// The final table, best first.
    public static func finalTable(of season: League) -> [FinalStandingRow] {
        (season.finalStandings ?? []).sorted { lhs, rhs in
            if lhs.rank != rhs.rank { return lhs.rank < rhs.rank }
            return lhs.teamName.localizedCaseInsensitiveCompare(rhs.teamName) == .orderedAscending
        }
    }

    /// `userID`'s row in a completed season, if they played it.
    public static func finish(of userID: UserID, in season: League) -> FinalStandingRow? {
        season.finalStandings?.first { $0.userID == userID }
    }

    /// The people who won the most recent completed season before `season`
    /// (the "reigning champion" crown). By user, because team ids are per
    /// season and mean nothing in the next one.
    public static func reigningChampionUserIDs(before season: League, in seasons: [League]) -> Set<UserID> {
        let previous = seasons
            .filter { $0.isCompleted && $0.seasonYear < season.seasonYear }
            .max { $0.seasonYear < $1.seasonYear }
        guard let previous else { return [] }
        return Set(champions(of: previous).map(\.userID))
    }

    /// One season won; `shared` when co-champions tied for it.
    public struct Win: Sendable, Hashable {
        public var year: Int
        public var shared: Bool

        public init(year: Int, shared: Bool) {
            self.year = year
            self.shared = shared
        }
    }

    /// One person's titles in the series, for the History "Titles" list.
    public struct Title: Sendable, Hashable, Identifiable {
        public var userID: UserID
        /// The team name they won with most recently.
        public var teamName: String
        public var displayName: String
        /// Seasons won, newest first.
        public var wins: [Win]

        public var id: UserID { userID }
        public var count: Int { wins.count }
    }

    /// Titles per person across the given seasons, most titles first, then
    /// most recent win.
    public static func titles(in seasons: [League]) -> [Title] {
        var byUser: [UserID: Title] = [:]
        for season in seasons.sorted(by: { $0.seasonYear > $1.seasonYear }) {
            let winners = champions(of: season)
            for row in winners {
                let shared = winners.count > 1
                if byUser[row.userID] == nil {
                    byUser[row.userID] = Title(
                        userID: row.userID,
                        teamName: row.teamName,
                        displayName: row.displayName ?? "Former member",
                        wins: []
                    )
                }
                byUser[row.userID]?.wins.append(Win(year: season.seasonYear, shared: shared))
            }
        }
        return byUser.values.sorted { lhs, rhs in
            if lhs.count != rhs.count { return lhs.count > rhs.count }
            let lhsLatest = lhs.wins.first?.year ?? 0
            let rhsLatest = rhs.wins.first?.year ?? 0
            if lhsLatest != rhsLatest { return lhsLatest > rhsLatest }
            return lhs.teamName < rhs.teamName
        }
    }
}
