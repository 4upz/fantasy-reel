import FantasyReelCore
import Foundation
import Testing
@testable import FantasyReelAPI

struct LeagueLifecycleTests {
    @Test func alreadyStartedSeasonIsNotAnError() {
        let conflict = APIError.server(.init(
            status: 409,
            message: "The 2027 season has already been started",
            body: ["error": "The 2027 season has already been started", "league_id": "l2", "season_year": 2027]
        ))
        #expect(EdgeLeagueLifecycleRepository.existingSeason(in: conflict)
            == NextSeason(leagueID: "l2", seasonYear: 2027, wasCreated: false))
    }

    @Test func otherFailuresStayErrors() {
        let forbidden = APIError.server(.init(status: 403, message: "Only the league commissioner can start the next season"))
        #expect(EdgeLeagueLifecycleRepository.existingSeason(in: forbidden) == nil)
    }

    @Test func conflictWithoutSeasonStaysAnError() {
        let conflict = APIError.server(.init(status: 409, message: "Conflict", body: ["error": "Conflict"]))
        #expect(EdgeLeagueLifecycleRepository.existingSeason(in: conflict) == nil)
    }
}
