import FantasyReelCore
import SwiftUI

/// What the movie detail screen knows when it shows league actions.
struct LeagueMovieContext {
    let selection: LeagueSelection
    let details: MovieDetails
    /// The season's holding of the movie, or nil when no team has it.
    let holding: TeamHolding?
    /// Our score of record, nil until some league picks the movie.
    let movie: Movie?
    /// The signed-in person's team in this season, when the season has read it.
    let myTeamID: TeamID?
    /// Rereads the detail screen after an action changes the movie's holder.
    let reload: @MainActor () async -> Void

    var isMine: Bool { holding != nil && holding?.teamID == myTeamID }
}

/// The actions on a movie in the selected season (bid, propose a trade, drop,
/// counterpick), between ownership and the projection on the detail screen.
///
/// The Team and market feature (F-09, F-10, F-11) fills this in; until then it
/// shows nothing.
struct LeagueMovieActions: View {
    let context: LeagueMovieContext

    var body: some View {
        EmptyView()
    }
}
