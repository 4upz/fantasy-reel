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
                // A bid, drop or trade may have changed who holds the movie.
                .onChange(of: router.sheet == nil) { _, closed in
                    if closed { Task { await context.reload() } }
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
        // The same gates as the Bids tab: a budget, and after the weekly cutoff
        // only movies that already have bids on them.
        let snapshot = store.bids.snapshot
        let counterPhase = snapshot?.week.isCounterBidPhase() ?? false
        let canBid = myTeam.budget != nil && !isScored && BidEligibility.isBiddable(releaseDate: releaseDate)
        var result: [Action] = []

        guard let holding = context.holding else {
            let contested = snapshot?.pickupBids.contains { $0.tmdbID == tmdbID } ?? false
            if canBid, !counterPhase || contested {
                let mine = store.bids.myPickupBids.contains { $0.tmdbID == tmdbID }
                let movie = BiddableMovie(
                    tmdbID: tmdbID, title: context.details.title, overview: context.details.overview,
                    releaseDate: releaseDate, posterURL: context.details.posterURL
                )
                result.append(Action(
                    title: mine ? "Raise Bid" : "Place Bid", systemImage: "tag",
                    kind: .primary, sheet: .placeBid(.pickup(movie))
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

        let contested = snapshot?.counterpickBids.contains { $0.movieID == holding.movieID } ?? false
        let alreadyBidding = store.bids.myCounterpickBids.contains { $0.movieID == holding.movieID }
        let slots = season.biddingCounterpickSlots
        let hasSlot = store.bids.hasFreeCounterpickSlot(slots: slots)
        if canBid, slots > 0, hasSlot, holding.counterpickedByTeamID == nil, !counterPhase || contested {
            let option = CounterpickOption(
                movieID: holding.movieID, title: holding.title, posterURL: holding.posterURL, releaseDate: releaseDate,
                ownerTeamID: holding.teamID, ownerTeamName: holding.teamName, fantasyPoints: holding.fantasyPoints
            )
            result.append(Action(
                title: alreadyBidding ? "Raise Counterpick Bid" : "Counterpick Bid", systemImage: "arrow.uturn.down",
                kind: .secondary, sheet: .placeBid(.counterpick(option))
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
