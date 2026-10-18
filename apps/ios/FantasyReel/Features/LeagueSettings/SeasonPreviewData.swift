#if DEBUG
import FantasyReelCore
import Foundation

/// Preview-only seasons of one series (the mockups' Popcorn Syndicate), for
/// the completed-season home and League History previews.
enum SeasonPreviewData {
    static let alice: UserID = "user-alice"
    static let bob: UserID = "user-bob"
    static let carol: UserID = "user-carol"
    static let dave: UserID = "user-dave"
    static let series: SeriesID = "series-popcorn"

    static func completedSeason(year: Int, tied: Bool = false, owner: UserID = carol) -> League {
        let table: [FinalStandingRow] = [
            row("cc", "Coppola Cut", carol, "Carol Coppola", points: 147, rank: 1, tied: tied),
            row("rd", "Reel Deal", alice, "Alice Spielberg", points: tied ? 147 : 139, rank: tied ? 1 : 2, tied: tied),
            row("dk", "Kubrick's Cube", dave, "Dave Kubrick", points: 120, rank: 3, tied: false),
            row("bn", "Nolan's Notebook", bob, nil, points: -4, rank: 4, tied: false),
        ]
        return League(
            id: LeagueID(rawValue: "season-\(year)"),
            name: "Popcorn Syndicate",
            ownerID: owner,
            status: .completed,
            seriesID: series,
            seasonYear: year,
            seasonEnd: DateOnly(year: year, month: 12, day: 31)!,
            completedAt: Date(timeIntervalSince1970: 0),
            winnerTeamIDs: table.filter { $0.rank == 1 }.map(\.teamID),
            finalStandings: table,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    static func activeSeason(year: Int, owner: UserID = carol) -> League {
        League(
            id: LeagueID(rawValue: "season-\(year)"),
            name: "Popcorn Syndicate",
            ownerID: owner,
            status: .active,
            seriesID: series,
            seasonYear: year,
            seasonEnd: DateOnly(year: year, month: 12, day: 31)!,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// Four seasons, newest first: 2026 running, 2025 won by Carol, 2024 by
    /// Alice, 2023 shared by Bob and Dave.
    static var history: [League] {
        let shared = [
            row("bn23", "Nolan's Notebook", bob, "Bob Nolan", points: 131, rank: 1, tied: true),
            row("dk23", "Kubrick's Cube", dave, "Dave Kubrick", points: 131, rank: 1, tied: true),
            row("rd23", "Reel Deal", alice, "Alice Spielberg", points: 98, rank: 3, tied: false),
        ]
        let aliceWon = [
            row("rd24", "Reel Deal", alice, "Alice Spielberg", points: 151, rank: 1, tied: false),
            row("cc24", "Coppola Cut", carol, "Carol Coppola", points: 122, rank: 2, tied: false),
        ]
        var season2023 = completedSeason(year: 2023)
        season2023.finalStandings = shared
        season2023.winnerTeamIDs = shared.prefix(2).map(\.teamID)
        var season2024 = completedSeason(year: 2024)
        season2024.finalStandings = aliceWon
        season2024.winnerTeamIDs = [aliceWon[0].teamID]
        return [activeSeason(year: 2026), completedSeason(year: 2025), season2024, season2023]
    }

    private static func row(
        _ id: String,
        _ team: String,
        _ user: UserID,
        _ name: String?,
        points: Double,
        rank: Int,
        tied: Bool
    ) -> FinalStandingRow {
        FinalStandingRow(
            teamID: TeamID(rawValue: "team-\(id)"),
            teamName: team,
            participantID: ParticipantID(rawValue: "participant-\(id)"),
            userID: user,
            totalPoints: points,
            rank: rank,
            isTied: tied,
            displayName: name
        )
    }
}
#endif
