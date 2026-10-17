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

/// The actions on a movie in the selected season, between ownership and the
/// projection on the detail screen: bid (or counterpick bid), propose a trade
/// for it, or drop it. Each opens its own sheet, which re-checks the rules.
///
/// Reads the season through `router.seasonStore`, since the detail screen can
/// also open outside the league tabs; with no matching season it shows nothing.
struct LeagueMovieActions: View {
    let context: LeagueMovieContext

    @Environment(ShellRouter.self) private var router

    var body: some View {
        if let store = router.seasonStore, store.season.id == context.selection.season.id {
            let actions = actions(store)
            if !actions.isEmpty {
                VStack(spacing: 10) {
                    ForEach(actions, id: \.title) { action in
                        Button(action.title, systemImage: action.systemImage) { router.present(action.sheet) }
                            .buttonStyle(.fr(action.kind, size: .medium, fullWidth: true))
                    }
                }
            }
        }
    }

    private struct Action {
        let title: String
        let systemImage: String
        let kind: FRButtonStyle.Kind
        let sheet: ShellSheet
    }

    private func actions(_ store: LeagueSeasonStore) -> [Action] {
        let season = store.season
        guard season.status == .active, let myTeam = store.myTeam else { return [] }
        let tmdbID = context.details.tmdbID
        let releaseDate = context.holding?.releaseDate ?? context.movie?.releaseDate ?? context.details.releaseDate
        let isScored = FantasyPoints.isScoreLocked(context.holding?.fantasyPoints ?? context.movie?.fantasyPoints)
        let biddable = !isScored && BidEligibility.isBiddable(releaseDate: releaseDate)
        var result: [Action] = []

        guard let holding = context.holding else {
            if biddable {
                let mine = store.bids.myPickupBids.contains { $0.tmdbID == tmdbID }
                result.append(Action(
                    title: mine ? "Raise Bid" : "Place Bid", systemImage: "tag",
                    kind: .primary, sheet: .placeBid(.pickup(tmdbID))
                ))
            }
            return result
        }

        if holding.teamID == myTeam.id {
            if season.dropLimit > 0, releaseDate.map({ $0 >= DateOnly.today() }) ?? true {
                result.append(Action(
                    title: "Drop Movie", systemImage: "minus.circle",
                    kind: .destructive, sheet: .dropMovie(holding.holdingID)
                ))
            }
            return result
        }

        if biddable, season.biddingCounterpickSlots > 0, holding.counterpickedByTeamID == nil {
            result.append(Action(
                title: "Counterpick Bid", systemImage: "arrow.uturn.down",
                kind: .secondary, sheet: .placeBid(.counterpick(holding.movieID))
            ))
        }
        if !isScored, store.canProposeTrade(to: holding.teamID) {
            result.append(Action(
                title: "Propose Trade", systemImage: "arrow.left.arrow.right",
                kind: .secondary, sheet: .proposeTrade(holding.teamID)
            ))
        }
        return result
    }
}
