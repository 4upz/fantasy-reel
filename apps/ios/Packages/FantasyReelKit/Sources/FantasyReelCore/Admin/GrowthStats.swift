import Foundation

/// `admin_growth_stats()`: everything the restricted growth dashboard shows
/// (F-18). The RPC itself is the access check; it refuses anyone not in
/// `app_admins`.
public struct GrowthStats: Decodable, Sendable, Hashable {
    public struct Users: Decodable, Sendable, Hashable {
        public var total: Int
        public var new30d: Int
        public var active7d: Int
        public var active30d: Int

        private enum CodingKeys: String, CodingKey {
            case total
            case new30d = "new_30d"
            case active7d = "active_7d"
            case active30d = "active_30d"
        }
    }

    public struct Leagues: Decodable, Sendable, Hashable {
        public var total: Int
        public var new30d: Int

        private enum CodingKeys: String, CodingKey {
            case total
            case new30d = "new_30d"
        }
    }

    public struct Rosters: Decodable, Sendable, Hashable {
        public var holdings: Int
        public var drafted: Int
        public var pickedUp: Int

        private enum CodingKeys: String, CodingKey {
            case holdings, drafted
            case pickedUp = "picked_up"
        }
    }

    /// New signups and leagues in one calendar month (UTC).
    public struct Month: Decodable, Sendable, Hashable, Identifiable {
        public var month: DateOnly
        public var signups: Int
        public var leagues: Int
        public var id: DateOnly { month }
    }

    /// Running totals at the end of a week (Monday, UTC).
    public struct Week: Decodable, Sendable, Hashable, Identifiable {
        public var week: DateOnly
        public var users: Int
        public var leagues: Int
        public var id: DateOnly { week }
    }

    public struct LeagueFunnel: Decodable, Sendable, Hashable {
        public var created: Int
        public var invited: Int
        public var secondPlayer: Int
        public var drafted: Int
        public var live: Int

        private enum CodingKeys: String, CodingKey {
            case created, invited, drafted, live
            case secondPlayer = "second_player"
        }
    }

    public struct UserFunnel: Decodable, Sendable, Hashable {
        public var inLeague: Int
        public var withOthers: Int
        public var drafted: Int

        private enum CodingKeys: String, CodingKey {
            case drafted
            case inLeague = "in_league"
            case withOthers = "with_others"
        }
    }

    public struct PeriodCount: Decodable, Sendable, Hashable {
        public var total: Int
        public var last30d: Int

        private enum CodingKeys: String, CodingKey {
            case total
            case last30d = "last_30d"
        }
    }

    public struct Activity: Decodable, Sendable, Hashable {
        public var draftPicks: PeriodCount
        public var pickups: PeriodCount
        public var bids: PeriodCount
        public var counterpicks: PeriodCount
        public var tradesProposed: PeriodCount
        public var tradesCompleted: PeriodCount

        private enum CodingKeys: String, CodingKey {
            case pickups, bids, counterpicks
            case draftPicks = "draft_picks"
            case tradesProposed = "trades_proposed"
            case tradesCompleted = "trades_completed"
        }

        /// The web's row order and labels.
        public var rows: [(label: String, count: PeriodCount)] {
            [
                ("Draft picks", draftPicks),
                ("Pickups won", pickups),
                ("Bids placed", bids),
                ("Counterpicks", counterpicks),
                ("Trades proposed", tradesProposed),
                ("Trades completed", tradesCompleted),
            ]
        }
    }

    /// A league's current season; `createdAt` is when its first season was.
    public struct LeagueRow: Decodable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var owner: String?
        public var status: LeagueStatus
        public var seasonYear: Int
        public var players: Int
        public var maxPlayers: Int
        public var invited: Bool
        public var createdAt: Date

        private enum CodingKeys: String, CodingKey {
            case id, name, owner, status, players, invited
            case seasonYear = "season_year"
            case maxPlayers = "max_players"
            case createdAt = "created_at"
        }
    }

    public struct UserRow: Decodable, Sendable, Hashable, Identifiable {
        public var id: String
        public var displayName: String?
        public var provider: String?
        public var signedUpAt: Date
        public var lastActiveAt: Date?
        public var leagues: Int

        private enum CodingKeys: String, CodingKey {
            case id, provider, leagues
            case displayName = "display_name"
            case signedUpAt = "signed_up_at"
            case lastActiveAt = "last_active_at"
        }
    }

    public var generatedAt: Date
    public var users: Users
    public var leagues: Leagues
    public var rosters: Rosters
    public var monthly: [Month]
    public var growth: [Week]
    public var leagueFunnel: LeagueFunnel
    public var userFunnel: UserFunnel
    public var activity: Activity
    public var leagueList: [LeagueRow]
    public var recentUsers: [UserRow]

    private enum CodingKeys: String, CodingKey {
        case users, leagues, rosters, monthly, growth, activity
        case generatedAt = "generated_at"
        case leagueFunnel = "league_funnel"
        case userFunnel = "user_funnel"
        case leagueList = "league_list"
        case recentUsers = "recent_users"
    }
}
