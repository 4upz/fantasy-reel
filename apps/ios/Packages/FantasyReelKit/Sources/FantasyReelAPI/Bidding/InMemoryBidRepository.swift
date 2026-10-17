import FantasyReelCore
import Foundation

/// An in-memory `BidRepository` for previews, screenshots and tests. Places,
/// raises, cancels and reorders against its own arrays with the server's
/// basic rules (outbid on a higher bid, new pickup bids at priority 1).
public actor InMemoryBidRepository: BidRepository {
    public var pickupBids: [PickupBid]
    public var counterpickBids: [CounterpickBid]
    public var settledPickupBids: [PickupBid]
    public var settledCounterpickBids: [CounterpickBid]
    public var week: BidWeek
    public var biddingCounterpickCount: Int
    public var scoredTMDbIDs: Set<TMDbID>
    public var counterpickOptions: [CounterpickOption]
    public var movies: [BiddableMovie]
    public var myTeamID: TeamID?
    public var failure: APIError?

    public init(
        pickupBids: [PickupBid] = [],
        counterpickBids: [CounterpickBid] = [],
        settledPickupBids: [PickupBid] = [],
        settledCounterpickBids: [CounterpickBid] = [],
        week: BidWeek = BidWeek(processingDeadline: nil, cutoffAt: nil),
        biddingCounterpickCount: Int = 0,
        scoredTMDbIDs: Set<TMDbID> = [],
        counterpickOptions: [CounterpickOption] = [],
        movies: [BiddableMovie] = [],
        myTeamID: TeamID? = nil
    ) {
        self.pickupBids = pickupBids
        self.counterpickBids = counterpickBids
        self.settledPickupBids = settledPickupBids
        self.settledCounterpickBids = settledCounterpickBids
        self.week = week
        self.biddingCounterpickCount = biddingCounterpickCount
        self.scoredTMDbIDs = scoredTMDbIDs
        self.counterpickOptions = counterpickOptions
        self.movies = movies
        self.myTeamID = myTeamID
    }

    public func setFailure(_ error: APIError?) { failure = error }

    private func check() throws(APIError) {
        if let failure { throw failure }
    }

    public func fetchPendingPickupBids(in leagueID: LeagueID) async throws(APIError) -> [PickupBid] {
        try check()
        return pickupBids.filter { $0.leagueID == leagueID && $0.status.isPending }
    }

    public func fetchPendingCounterpickBids(in leagueID: LeagueID) async throws(APIError) -> [CounterpickBid] {
        try check()
        return counterpickBids.filter { $0.leagueID == leagueID && $0.status.isPending }
    }

    public func fetchSettledBids(in leagueID: LeagueID) async throws(APIError) -> (pickups: [PickupBid], counterpicks: [CounterpickBid]) {
        try check()
        return (settledPickupBids.filter { $0.leagueID == leagueID }, settledCounterpickBids.filter { $0.leagueID == leagueID })
    }

    public func fetchBidWeek(for leagueID: LeagueID) async throws(APIError) -> BidWeek {
        try check()
        return week
    }

    public func fetchBiddingCounterpickCount(for teamID: TeamID) async throws(APIError) -> Int {
        try check()
        return biddingCounterpickCount
    }

    public func fetchScoredUpcomingTMDbIDs() async throws(APIError) -> Set<TMDbID> {
        try check()
        return scoredTMDbIDs
    }

    public func fetchCounterpickOptions(in leagueID: LeagueID, for teamID: TeamID) async throws(APIError) -> [CounterpickOption] {
        try check()
        return counterpickOptions.filter { $0.ownerTeamID != teamID }
    }

    public func placePickupBid(_ request: PlacePickupBid) async throws(APIError) -> PlaceBidResult {
        try check()
        guard let myTeamID else { throw .server(.init(status: 404, message: "Team not found")) }
        if let high = pickupBids.first(where: { $0.tmdbID == request.tmdbID && $0.status == .active }), high.amount >= request.amount {
            throw .server(.init(status: 400, message: "There is already a bid of $\(high.amount). You must bid higher."))
        }
        let now = Date()
        for index in pickupBids.indices where pickupBids[index].tmdbID == request.tmdbID && pickupBids[index].status == .active && pickupBids[index].teamID != myTeamID {
            pickupBids[index].status = .outbid
            pickupBids[index].responseDeadline = now.addingTimeInterval(24 * 3600)
        }
        let drop = request.conditionalDrop
        if let index = pickupBids.firstIndex(where: { $0.tmdbID == request.tmdbID && $0.teamID == myTeamID && $0.status.isPending }) {
            pickupBids[index].amount = request.amount
            pickupBids[index].status = .active
            pickupBids[index].responseDeadline = nil
            pickupBids[index].conditionalDropDraftPickID = drop?.source == .draft ? drop?.id : nil
            pickupBids[index].conditionalDropPickupID = drop?.source == .pickup ? drop?.id : nil
            return PlaceBidResult(message: "You are now the highest bidder", wasUpdate: true)
        }
        let movie = movies.first { $0.tmdbID == request.tmdbID }
        pickupBids.insert(PickupBid(
            id: BidID(UUID().uuidString.lowercased()), leagueID: request.leagueID, teamID: myTeamID, tmdbID: request.tmdbID,
            movieData: BidMovieData(title: movie?.title, posterURL: movie?.posterURL, releaseDate: movie?.releaseDate),
            amount: request.amount, status: .active, createdAt: now,
            processingDeadline: week.processingDeadline ?? now.addingTimeInterval(3 * 24 * 3600),
            conditionalDropDraftPickID: drop?.source == .draft ? drop?.id : nil,
            conditionalDropPickupID: drop?.source == .pickup ? drop?.id : nil
        ), at: 0)
        return PlaceBidResult(message: "Bid placed successfully")
    }

    public func placeCounterpickBid(league: LeagueID, movie: MovieID, amount: Int) async throws(APIError) -> PlaceBidResult {
        try check()
        guard let myTeamID else { throw .server(.init(status: 404, message: "Team not found")) }
        if let high = counterpickBids.first(where: { $0.movieID == movie && $0.status == .active }), high.amount >= amount {
            throw .server(.init(status: 400, message: "There is already a bid of $\(high.amount). You must bid higher."))
        }
        if let index = counterpickBids.firstIndex(where: { $0.movieID == movie && $0.teamID == myTeamID && $0.status.isPending }) {
            counterpickBids[index].amount = amount
            counterpickBids[index].status = .active
            return PlaceBidResult(message: "You are now the highest bidder", wasUpdate: true)
        }
        guard let option = counterpickOptions.first(where: { $0.movieID == movie }) else {
            throw .server(.init(status: 404, message: "Movie not found in this league draft"))
        }
        let now = Date()
        let mine = counterpickBids.filter { $0.teamID == myTeamID && $0.status.isPending }.count
        counterpickBids.insert(CounterpickBid(
            id: BidID(UUID().uuidString.lowercased()), leagueID: league, teamID: myTeamID, movieID: movie,
            targetTeamID: option.ownerTeamID, amount: amount, priority: mine + 1, status: .active, createdAt: now,
            processingDeadline: week.processingDeadline ?? now.addingTimeInterval(3 * 24 * 3600),
            movie: .init(title: option.title, posterURL: option.posterURL, releaseDate: option.releaseDate, fantasyPoints: option.fantasyPoints),
            targetTeamName: option.ownerTeamName
        ), at: 0)
        return PlaceBidResult(message: "Counterpick bid placed successfully")
    }

    public func cancelPickupBid(_ bidID: BidID) async throws(APIError) {
        try check()
        pickupBids.removeAll { $0.id == bidID }
    }

    public func cancelCounterpickBid(_ bidID: BidID) async throws(APIError) {
        try check()
        counterpickBids.removeAll { $0.id == bidID }
    }

    public func setPickupPriorities(league: LeagueID, bidIDs: [BidID]) async throws(APIError) {
        try check()
        for (offset, id) in bidIDs.enumerated() {
            if let index = pickupBids.firstIndex(where: { $0.id == id }) { pickupBids[index].priority = offset + 1 }
        }
    }

    public func setCounterpickPriorities(league: LeagueID, bidIDs: [BidID]) async throws(APIError) {
        try check()
        for (offset, id) in bidIDs.enumerated() {
            if let index = counterpickBids.firstIndex(where: { $0.id == id }) { counterpickBids[index].priority = offset + 1 }
        }
    }
}
